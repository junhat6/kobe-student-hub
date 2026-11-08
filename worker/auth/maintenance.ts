import { BrowserSessionCoordinator } from './browser-session';
import { OAuthAttemptStore } from './oauth-attempts';

/** Server-owned choices, not request input. There is deliberately no retention default. */
export interface AuthMaintenancePolicy {
  expiredGraceMs: number;
  minimumIntervalMs: number;
  batchLimit: 100;
}
export type AuthMaintenanceResult =
  | {
      kind: 'completed';
      deleted: {
        attempts: number;
        commands: number;
        sessions: number;
        contexts: number;
        subjectFloors: number;
      };
    }
  | { kind: 'throttled' }
  | { kind: 'unavailable' };
const safe = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= 253402300799999;

/** Explicit local/server-only housekeeping. No route, scheduler, account erasure or admission authority.
 * One call deletes at most 100 rows per category. The persisted reservation limits invocation
 * frequency; it is not a lease or an automatic retry mechanism after an uncertain failure. */
export class AuthMaintenanceStore {
  constructor(
    private readonly db: D1Database,
    private readonly origin: string,
    private readonly policy: AuthMaintenancePolicy,
    private readonly clock: () => number,
  ) {}
  async run(): Promise<AuthMaintenanceResult> {
    const p = this.policy;
    try {
      if (
        !p ||
        p.batchLimit !== 100 ||
        !safe(p.expiredGraceMs) ||
        !safe(p.minimumIntervalMs) ||
        p.minimumIntervalMs < 1000 ||
        new URL(this.origin).protocol !== 'https:' ||
        new URL(this.origin).origin !== this.origin
      )
        return { kind: 'unavailable' };
      const now = this.clock();
      if (!safe(now) || now < p.expiredGraceMs) return { kind: 'unavailable' };
      // One conditional write chooses the winner, including simultaneous job starts at equal time.
      const reservation = await this.db
        .prepare(
          `UPDATE auth_maintenance_state SET last_started_at_ms=? WHERE id=1 AND (last_started_at_ms IS NULL OR (last_started_at_ms<=? AND last_started_at_ms<=?)) RETURNING id`,
        )
        .bind(now, now, now - p.minimumIntervalMs)
        .first();
      if (!reservation) {
        const state = await this.db
          .prepare('SELECT id FROM auth_maintenance_state WHERE id=1')
          .first();
        return { kind: state ? 'throttled' : 'unavailable' };
      }
      // A fixed conservative cutoff makes long/overlapping jobs delete no newer data than planned.
      // Later backwards or malformed time aborts remaining work; already committed deletions stay final.
      const cutoff = now - p.expiredGraceMs;
      const check = () => {
        const current = this.clock();
        if (!safe(current) || current < now) throw Error('unavailable maintenance clock');
        return cutoff;
      };
      const attempts = await new OAuthAttemptStore(this.db, check).cleanupExpired();
      if (attempts === null) return { kind: 'unavailable' };
      const remove = async (sql: string) => {
        const result = await this.db.prepare(sql).bind(check()).all();
        if (!result.success) throw Error('unavailable maintenance storage');
        return result.results.length;
      };
      const commands = await remove(
        'DELETE FROM auth_browser_commands WHERE command_hash IN (SELECT command_hash FROM auth_browser_commands WHERE expires_at_ms<=? ORDER BY expires_at_ms,command_hash LIMIT 100) RETURNING command_hash',
      );
      const sessions = await remove(
        'DELETE FROM auth_sessions WHERE token_hash IN (SELECT token_hash FROM auth_sessions WHERE expires_at_ms<=? ORDER BY expires_at_ms,token_hash LIMIT 100) RETURNING token_hash',
      );
      // Child references may outlive this batch. Keep those contexts for a later explicit run.
      const contexts = await remove(
        `DELETE FROM auth_browser_contexts WHERE context_hash IN (SELECT c.context_hash FROM auth_browser_contexts c WHERE c.expires_at_ms<=? AND NOT EXISTS(SELECT 1 FROM oauth_attempts a WHERE a.context_hash=c.context_hash) AND NOT EXISTS(SELECT 1 FROM auth_browser_commands q WHERE q.context_hash=c.context_hash) AND NOT EXISTS(SELECT 1 FROM auth_sessions s WHERE s.context_hash=c.context_hash) ORDER BY c.expires_at_ms,c.context_hash LIMIT 100) RETURNING context_hash`,
      );
      const subjectFloors = await new BrowserSessionCoordinator(
        this.db,
        this.origin,
        check,
      ).cleanupRevocations();
      if (subjectFloors === null) return { kind: 'unavailable' };
      return {
        kind: 'completed',
        deleted: { attempts, commands, sessions, contexts, subjectFloors },
      };
    } catch {
      return { kind: 'unavailable' };
    }
  }
}
