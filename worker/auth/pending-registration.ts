import type { VerifiedSchoolIdentity } from './google-identity';
import type { BrowserClaim } from './browser-session';
const clean = (v: unknown, max: number): v is string =>
  typeof v === 'string' &&
  v.length <= max &&
  !!v.trim() &&
  !/[\p{Cc}\p{Cf}]/u.test(v) &&
  new TextDecoder().decode(new TextEncoder().encode(v)) === v;
/** Server-only pending receipt, not enrollment, email identity/recovery, or permission to log in.
 * Callers must obtain identity through actual provider signature verification. */
export class PendingRegistrationStore {
  constructor(
    private readonly db: D1Database,
    private readonly clock: () => number = Date.now,
  ) {}
  async record(
    identity: VerifiedSchoolIdentity,
    claim: BrowserClaim,
  ): Promise<{ recorded: true } | null> {
    if (
      !claim ||
      identity?.provider !== 'google' ||
      !clean(identity.subject, 255) ||
      !clean(identity.email, 320) ||
      !/^[^@\s]+@st\.kobedenshi\.ac\.jp$/i.test(identity.email)
    )
      return null;
    try {
      const now = this.clock();
      if (!Number.isSafeInteger(now) || now < 0 || now > 253402300799999) return null;
      // Email collision refusal is conservative: it never links subjects or changes stored contact.
      const guard = `EXISTS(SELECT 1 FROM oauth_attempts t JOIN auth_browser_contexts c ON c.context_hash=t.context_hash JOIN auth_revocation_fence f ON f.id=1 WHERE t.state_hash=? AND t.claim_owner=? AND t.intent='pending-registration' AND t.completed_at_ms IS NULL AND t.consumed_at_ms<=? AND t.expires_at_ms>? AND t.context_hash=? AND t.context_generation=? AND c.generation=t.context_generation AND c.created_at_ms<=? AND c.expires_at_ms>? AND t.revocation_fence=? AND t.revocation_fence>=f.minimum_generation AND NOT EXISTS(SELECT 1 FROM auth_subject_fences b WHERE b.google_subject=? AND b.generation>t.revocation_fence))`;
      const args = [
        claim.stateHash,
        claim.owner,
        now,
        now,
        claim.contextHash,
        claim.generation,
        now,
        now,
        claim.fence,
        identity.subject,
      ];
      const rows = await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO private_accounts(id,google_subject,email,status,session_epoch,created_at_ms)
    SELECT ?,?,?,'pending',0,? WHERE NOT EXISTS(SELECT 1 FROM private_accounts other WHERE other.google_subject<>? AND lower(other.email)=lower(?)) AND ${guard}
    ON CONFLICT(google_subject) DO UPDATE SET google_subject=private_accounts.google_subject
    WHERE private_accounts.status='pending' AND private_accounts.email=excluded.email AND private_accounts.created_at_ms<=excluded.created_at_ms RETURNING id`,
          )
          .bind(
            crypto.randomUUID(),
            identity.subject,
            identity.email,
            now,
            identity.subject,
            identity.email,
            ...args,
          ),
        this.db
          .prepare(
            `UPDATE oauth_attempts SET completed_at_ms=? WHERE state_hash=? AND claim_owner=? AND completed_at_ms IS NULL`,
          )
          .bind(now, claim.stateHash, claim.owner),
      ]);
      return rows[0].results.length ? { recorded: true } : null;
    } catch {
      return null;
    }
  }
}
