import {
  canonicalEnrollmentYears,
  enrollmentWindow,
  ENROLLMENT_POLICY_VERSION,
} from '../../src/shared/enrollment';
import type { BrowserClaim } from './browser-session';
import type { VerifiedSchoolIdentity } from './google-identity';
import { newSessionMaterial, SESSION_ABSOLUTE_MS } from './sessions';

const clean = (v: unknown, max: number): v is string =>
  typeof v === 'string' &&
  !!v.trim() &&
  v.length <= max &&
  !/[\p{Cc}\p{Cf}]/u.test(v) &&
  new TextDecoder().decode(new TextEncoder().encode(v)) === v;

/** Server-private terminal registration. Identity must follow actual Google verification.
 * The temporary commit authorizes only its own exact pending -> active epoch/fence transition.
 * All statements share one D1 transaction; a missing final session rolls back every change. */
export class SelfRegistrationStore {
  constructor(
    private readonly db: D1Database,
    private readonly clock: () => number = Date.now,
  ) {}
  async complete(identity: VerifiedSchoolIdentity, claim: BrowserClaim) {
    if (
      !claim ||
      identity?.provider !== 'google' ||
      !clean(identity.subject, 255) ||
      !clean(identity.email, 320) ||
      !/^[^@\s]+@st\.kobedenshi\.ac\.jp$/i.test(identity.email)
    )
      return null;
    try {
      const declaration = await this.db
        .prepare(
          'SELECT admission_year,graduation_year,policy_version FROM auth_self_registration_attempts WHERE state_hash=?',
        )
        .bind(claim.stateHash)
        .first<{ admission_year: number; graduation_year: number; policy_version: number }>();
      const years =
        declaration && declaration.policy_version === ENROLLMENT_POLICY_VERSION
          ? canonicalEnrollmentYears({
              admissionYear: declaration.admission_year,
              graduationYear: declaration.graduation_year,
            })
          : null;
      const window = years && enrollmentWindow(years);
      if (!years || !window) return null;
      const material = await newSessionMaterial(),
        now = this.clock();
      if (
        !Number.isSafeInteger(now) ||
        now < 0 ||
        now >= Number.MAX_SAFE_INTEGER - SESSION_ABSOLUTE_MS
      )
        return null;
      // Stable numbered parameters keep every predicate tied to the same server claim/material.
      const parameters = [
        now,
        claim.stateHash,
        claim.owner,
        claim.contextHash,
        claim.generation,
        claim.fence,
        identity.subject,
        identity.email,
        crypto.randomUUID(),
        crypto.randomUUID(),
        years.admissionYear,
        years.graduationYear,
        window.startsAtMs,
        window.endsAtMs,
        ENROLLMENT_POLICY_VERSION,
        material.tokenHash,
        now + SESSION_ABSOLUTE_MS,
      ];
      const statement = (sql: string, count: number) =>
        this.db.prepare(sql).bind(...parameters.slice(0, count));
      const originalClaim = `EXISTS(SELECT 1 FROM oauth_attempts t JOIN auth_browser_contexts c ON c.context_hash=t.context_hash JOIN auth_revocation_fence f ON f.id=1 JOIN auth_self_registration_attempts m ON m.state_hash=t.state_hash WHERE t.state_hash=?2 AND t.claim_owner=?3 AND t.intent='login' AND t.completed_at_ms IS NULL AND t.consumed_at_ms<=?1 AND t.created_at_ms<=?1 AND t.expires_at_ms>?1 AND t.context_hash=?4 AND t.context_generation=?5 AND c.generation=t.context_generation AND c.created_at_ms<=?1 AND c.expires_at_ms>?1 AND t.revocation_fence=?6 AND t.revocation_fence>=f.minimum_generation AND m.policy_version=1 AND NOT EXISTS(SELECT 1 FROM auth_subject_fences b WHERE b.google_subject=?7 AND b.generation>t.revocation_fence))`;
      // No operation can interleave within the batch. An activation must produce precisely the
      // epoch/fence recorded by this commit; an unrelated suspension/activation cannot satisfy it.
      const committed = `EXISTS(SELECT 1 FROM auth_self_registration_commits receipt JOIN private_accounts account ON account.id=receipt.account_id JOIN oauth_attempts attempt ON attempt.state_hash=receipt.state_hash JOIN auth_browser_contexts context ON context.context_hash=attempt.context_hash JOIN auth_revocation_fence fence ON fence.id=1 WHERE receipt.commit_id=?10 AND receipt.state_hash=?2 AND receipt.created_at_ms=?1 AND account.google_subject=?7 AND account.email=?8 AND account.status='active' AND account.session_epoch=receipt.resulting_epoch AND attempt.intent='login' AND attempt.claim_owner=?3 AND attempt.completed_at_ms IS NULL AND attempt.created_at_ms<=?1 AND attempt.consumed_at_ms<=?1 AND attempt.expires_at_ms>?1 AND attempt.context_hash=?4 AND attempt.context_generation=?5 AND context.generation=attempt.context_generation AND context.created_at_ms<=?1 AND context.expires_at_ms>?1 AND attempt.revocation_fence=?6 AND attempt.revocation_fence>=fence.minimum_generation AND fence.generation=receipt.resulting_fence AND ((receipt.prior_status='pending' AND EXISTS(SELECT 1 FROM auth_subject_fences subject_floor WHERE subject_floor.google_subject=account.google_subject AND subject_floor.generation=receipt.resulting_fence)) OR (receipt.prior_status='active' AND NOT EXISTS(SELECT 1 FROM auth_subject_fences subject_floor WHERE subject_floor.google_subject=account.google_subject AND subject_floor.generation>attempt.revocation_fence))))`;
      const rows = await this.db.batch([
        statement(
          `INSERT INTO private_accounts(id,google_subject,email,status,session_epoch,created_at_ms) SELECT ?9,?7,?8,'pending',0,?1 WHERE ${originalClaim} AND NOT EXISTS(SELECT 1 FROM private_accounts other WHERE other.google_subject<>?7 AND lower(other.email)=lower(?8)) ON CONFLICT(google_subject) DO NOTHING`,
          9,
        ),
        statement(
          `INSERT INTO auth_self_registration_commits(state_hash,commit_id,account_id,expected_epoch,prior_status,resulting_epoch,resulting_fence,created_at_ms) SELECT ?2,?10,a.id,a.session_epoch,a.status,a.session_epoch+CASE a.status WHEN 'pending' THEN 1 ELSE 0 END,f.generation+CASE a.status WHEN 'pending' THEN 1 ELSE 0 END,?1 FROM private_accounts a JOIN auth_revocation_fence f ON f.id=1 WHERE a.google_subject=?7 AND a.email=?8 AND a.status IN ('pending','active') AND a.created_at_ms<=?1 AND a.session_epoch<=9007199254740991 AND (a.status='active' OR a.session_epoch<9007199254740991 AND f.generation<9007199254740991) AND NOT EXISTS(SELECT 1 FROM private_accounts other WHERE other.google_subject<>?7 AND lower(other.email)=lower(?8)) AND ${originalClaim}`,
          10,
        ),
        statement(
          `UPDATE private_accounts SET status='active' WHERE status='pending' AND EXISTS(SELECT 1 FROM auth_self_registration_commits receipt WHERE receipt.commit_id=?10 AND receipt.state_hash=?2 AND receipt.created_at_ms=?1 AND receipt.account_id=private_accounts.id AND receipt.prior_status='pending' AND receipt.expected_epoch=private_accounts.session_epoch)`,
          10,
        ),
        statement(
          `INSERT INTO private_enrollment_periods(owner_account_id,admission_year,graduation_year,starts_at_ms,ends_at_ms,policy_version,version,updated_at_ms) SELECT receipt.account_id,m.admission_year,m.graduation_year,?13,?14,?15,1,?1 FROM auth_self_registration_commits receipt JOIN auth_self_registration_attempts m ON m.state_hash=receipt.state_hash WHERE receipt.commit_id=?10 AND m.admission_year=?11 AND m.graduation_year=?12 AND m.policy_version=?15 AND ${committed} ON CONFLICT(owner_account_id) DO NOTHING`,
          15,
        ),
        statement(
          `INSERT INTO auth_sessions(token_hash,account_id,account_epoch,created_at_ms,last_seen_ms,expires_at_ms,context_hash,context_generation,attempt_hash) SELECT ?16,receipt.account_id,receipt.resulting_epoch,?1,?1,min(?17,context.expires_at_ms),context.context_hash,context.generation,receipt.state_hash FROM auth_self_registration_commits receipt JOIN auth_browser_contexts context ON context.context_hash=?4 WHERE receipt.commit_id=?10 AND EXISTS(SELECT 1 FROM private_enrollment_periods period WHERE period.owner_account_id=receipt.account_id) AND ${committed} RETURNING account_id`,
          17,
        ),
        // A failed/no-op intermediate statement must not commit an orphan account, declaration or receipt.
        statement(
          `SELECT CASE WHEN EXISTS(SELECT 1 FROM auth_sessions session JOIN auth_self_registration_commits receipt ON receipt.state_hash=session.attempt_hash JOIN oauth_attempts attempt ON attempt.state_hash=receipt.state_hash JOIN private_accounts account ON account.id=receipt.account_id WHERE session.token_hash=?16 AND receipt.commit_id=?10 AND session.account_id=account.id AND account.status='active' AND session.account_epoch=account.session_epoch AND session.account_epoch=receipt.resulting_epoch AND session.context_hash=?4 AND session.context_generation=?5 AND attempt.completed_at_ms=?1 AND EXISTS(SELECT 1 FROM private_enrollment_periods period WHERE period.owner_account_id=account.id)) THEN 1 ELSE json('') END AS guarded`,
          16,
        ),
      ]);
      const row = rows[4].results[0] as { account_id: string } | undefined;
      return row
        ? {
            setCookie: material.setCookie,
            csrfToken: material.csrfToken,
            actor: { accountId: row.account_id, accountStatus: 'active' as const },
          }
        : null;
    } catch {
      return null;
    }
  }
}
