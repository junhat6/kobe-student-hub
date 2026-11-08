import {
  liveSessionSql,
  liveRestrictedSessionSql,
  liveSessionBindings,
  type SessionStorageProof,
} from './session-guard';

// Identity/session authority and participation are distinct. Never use public year labels.
const periodSql = `EXISTS(SELECT 1 FROM private_enrollment_periods e WHERE e.owner_account_id=? AND e.policy_version=1 AND e.starts_at_ms<=? AND e.ends_at_ms>? AND e.updated_at_ms<=?)`;
export const liveStudentSessionSql = `(${liveSessionSql} AND ${periodSql})`;
export function liveStudentRestrictedSessionSql(p: SessionStorageProof) {
  return `(${liveRestrictedSessionSql(p)} AND ${periodSql})`;
}
/** One freshly sampled server time is bound to both final session and enrollment predicates. */
export function liveStudentSessionBindings(p: SessionStorageProof) {
  const now = p.clock();
  // liveSessionBindings validates the same timestamp against the inspected proof.
  return [...liveSessionBindings({ ...p, clock: () => now }), p.accountId, now, now, now];
}
