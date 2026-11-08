import { SessionStore } from './sessions';
import { liveSessionSql, liveSessionBindings } from './session-guard';

/** Explicit server policy for local preparation. No production defaults or enrollment criteria. */
export interface AdmissionRetentionPolicy {
  pendingRetentionMs: number;
  auditRetentionMs: number;
  maintenanceIntervalMs: number;
}
const sqlIdentifier = (v: string) => '"' + v.replaceAll('"', '""') + '"';
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const validPolicy = (p: AdmissionRetentionPolicy) =>
  p &&
  [p.pendingRetentionMs, p.auditRetentionMs, p.maintenanceIntervalMs].every(
    (n) => Number.isSafeInteger(n) && n > 0,
  );

/** Server-private only: not mounted, no operator provisioning or self-admission.
 * An opaque reference records an external review; it does not prove enrollment. */
export class AdmissionStore {
  constructor(
    private readonly db: D1Database,
    private readonly origin: string,
    private readonly policy: AdmissionRetentionPolicy,
    private readonly clock: () => number = Date.now,
  ) {}
  private now() {
    const now = this.clock();
    return validPolicy(this.policy) &&
      Number.isSafeInteger(now) &&
      now >= 0 &&
      now <
        Number.MAX_SAFE_INTEGER -
          Math.max(
            this.policy.auditRetentionMs,
            this.policy.pendingRetentionMs,
            this.policy.maintenanceIntervalMs,
          )
      ? now
      : null;
  }
  async decide(
    request: Request,
    input: {
      targetId: string;
      expectedEpoch: number;
      action: 'approve' | 'withdraw';
      reviewReference: string;
    },
  ): Promise<{ recorded: true } | null> {
    if (
      request.method !== 'POST' ||
      !input ||
      !id(input.targetId) ||
      !uuid(input.reviewReference) ||
      !['approve', 'withdraw'].includes(input.action) ||
      !Number.isSafeInteger(input.expectedEpoch) ||
      input.expectedEpoch < 0
    )
      return null;
    try {
      const proof = await new SessionStore(this.db, this.origin, this.clock).storageAuthorization(
        request,
      );
      if (!proof || proof.accountId === input.targetId) return null;
      // The final predicate resamples authority/time after preflight. No client actor or grant is accepted.
      const bindings = liveSessionBindings(proof),
        now = bindings[3] as number;
      if (
        !validPolicy(this.policy) ||
        now >= Number.MAX_SAFE_INTEGER - this.policy.auditRetentionMs
      )
        return null;
      const row = await this.db
        .prepare(
          `INSERT INTO private_admission_audit(id,actor_account_id,target_account_id,action,expected_epoch,review_reference,occurred_at_ms,expires_at_ms)
    SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM private_admission_operators o WHERE o.account_id=? AND o.granted_at_ms<=? AND o.expires_at_ms>? AND o.revoked_at_ms IS NULL)
    AND EXISTS(SELECT 1 FROM private_accounts target WHERE target.id=? AND target.session_epoch=? AND target.created_at_ms<=? AND target.status=?) AND ${liveSessionSql} RETURNING id`,
        )
        .bind(
          crypto.randomUUID(),
          proof.accountId,
          input.targetId,
          input.action,
          input.expectedEpoch,
          input.reviewReference,
          now,
          now + this.policy.auditRetentionMs,
          proof.accountId,
          now,
          now,
          input.targetId,
          input.expectedEpoch,
          now,
          input.action === 'approve' ? 'pending' : 'active',
          ...bindings,
        )
        .first();
      return row ? { recorded: true } : null;
    } catch {
      return null;
    }
  }
  /** Privileged maintenance entry, never an HTTP endpoint. Policy is trusted server configuration.
   * Only never-active pending accounts without sessions/role and expired minimal audits are removed.
   * Existing account-delete trigger preserves revocation floors; publication/private content is untouched. */
  async purge(): Promise<{ pending: number; audits: number } | null> {
    try {
      const now = this.now();
      if (now === null) return null;
      // Schema is server-owned. Refuse deletion for every actual FK reference, including
      // CASCADE/SET NULL children and legacy inconsistent pending rows. Never run with migrations.
      const tables = await this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND lower(name) NOT IN('_cf_metadata','_cf_kv') AND name NOT GLOB 'sqlite_*' LIMIT 101",
        )
        .all<{ name: string }>();
      if (!tables.success || tables.results.length > 100 || !tables.results.length) return null;
      // D1 permits individual PRAGMA statements, but not table-valued PRAGMA functions.
      const schemas = await this.db.batch(
        tables.results.map((t) =>
          this.db.prepare(`PRAGMA foreign_key_list(${sqlIdentifier(t.name)})`),
        ),
      );
      const references: { table_name: string; column_name: string; target_column: string }[] = [];
      for (let n = 0; n < schemas.length; n++) {
        if (!schemas[n].success) return null;
        for (const row of schemas[n].results as {
          table: string;
          from: string;
          to: string | null;
        }[])
          if (row.table.toLowerCase() === 'private_accounts')
            references.push({
              table_name: tables.results[n].name,
              column_name: row.from,
              target_column: row.to ?? 'id',
            });
      }
      if (references.length > 100) return null;
      const noReferences =
        references
          .map(
            (r) =>
              `NOT EXISTS(SELECT 1 FROM ${sqlIdentifier(r.table_name)} child WHERE child.${sqlIdentifier(r.column_name)}=a.${sqlIdentifier(r.target_column)})`,
          )
          .join(' AND ') || '1';
      const run = crypto.randomUUID();
      const guard = 'EXISTS(SELECT 1 FROM private_admission_maintenance WHERE id=1 AND run_id=?)';
      const rs = await this.db.batch([
        this.db
          .prepare(
            'UPDATE private_admission_maintenance SET last_run_ms=?,run_id=? WHERE id=1 AND last_run_ms<=? AND (run_id IS NULL OR last_run_ms<=?) RETURNING id',
          )
          .bind(now, run, now, now - this.policy.maintenanceIntervalMs),
        this.db
          .prepare(
            `DELETE FROM private_accounts WHERE id IN(SELECT a.id FROM private_accounts a WHERE a.status='pending' AND a.session_epoch=0 AND a.created_at_ms<=? AND NOT EXISTS(SELECT 1 FROM auth_sessions s WHERE s.account_id=a.id) AND NOT EXISTS(SELECT 1 FROM private_admission_operators o WHERE o.account_id=a.id) AND ${noReferences} ORDER BY a.created_at_ms,a.id LIMIT 100) AND ${guard} RETURNING id`,
          )
          .bind(now - this.policy.pendingRetentionMs, run),
        this.db
          .prepare(
            `DELETE FROM private_admission_audit WHERE id IN(SELECT id FROM private_admission_audit WHERE expires_at_ms<=? ORDER BY expires_at_ms,id LIMIT 100) AND ${guard} RETURNING id`,
          )
          .bind(now, run),
      ]);
      return rs[0].results.length
        ? { pending: rs[1].results.length, audits: rs[2].results.length }
        : null;
    } catch {
      return null;
    }
  }
}
