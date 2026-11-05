import { base64url } from 'jose';

export const OAUTH_ATTEMPT_TTL_MS = 600_000;
const validSecret = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const freshSecret = () => base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Private transient values for a future server-owned OAuth start flow. Never log or publish. */
export interface OAuthAttemptSecrets { state: string; browserBinding: string; nonce: string; }
export interface ConsumedOAuthAttempt { nonce: string; }

/** Unconnected repository. The production app does not expose start/consume endpoints. */
export class OAuthAttemptStore {
  constructor(private readonly db: D1Database, private readonly clock: () => number = Date.now) {}
  private now(): number | null {
    const value = this.clock();
    return Number.isSafeInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER - OAUTH_ATTEMPT_TTL_MS ? value : null;
  }

  async start(): Promise<OAuthAttemptSecrets | null> {
    try {
      const now = this.now(); if (now === null) return null;
      const secrets = { state: freshSecret(), browserBinding: freshSecret(), nonce: freshSecret() };
      const result = await this.db.prepare(`INSERT INTO oauth_attempts
        (state_hash, browser_hash, nonce, created_at_ms, expires_at_ms)
        VALUES (?, ?, ?, ?, ?)`).bind(
          await digest(secrets.state), await digest(secrets.browserBinding), secrets.nonce,
          now, now + OAUTH_ATTEMPT_TTL_MS,
        ).run();
      return result.success ? secrets : null;
    } catch { return null; }
  }

  async consume(input: { state?: string; browserBinding?: string }): Promise<ConsumedOAuthAttempt | null> {
    if (!validSecret(input.state) || !validSecret(input.browserBinding)) return null;
    try {
      const now = this.now(); if (now === null) return null;
      // One conditional write, not a read-then-write race. Only the winning update returns nonce.
      const row = await this.db.prepare(`UPDATE oauth_attempts SET consumed_at_ms = ?
        WHERE state_hash = ? AND browser_hash = ? AND consumed_at_ms IS NULL
          AND created_at_ms <= ? AND expires_at_ms > ?
        RETURNING nonce`).bind(
          now, await digest(input.state), await digest(input.browserBinding), now, now,
        ).first<{ nonce: string }>();
      return row && validSecret(row.nonce) ? { nonce: row.nonce } : null;
    } catch { return null; }
  }

  /** Explicit bounded cleanup; no scheduler/production job is created in this cycle. */
  async cleanupExpired(): Promise<number | null> {
    try {
      const now = this.now(); if (now === null) return null;
      const result = await this.db.prepare(`DELETE FROM oauth_attempts WHERE state_hash IN
        (SELECT state_hash FROM oauth_attempts WHERE expires_at_ms <= ? ORDER BY expires_at_ms LIMIT 100) RETURNING state_hash`)
        .bind(now).all<{state_hash:string}>();
      // meta.changes also counts FK SET NULL side effects; report deleted attempts only.
      return result.success ? result.results.length : null;
    } catch { return null; }
  }
}
