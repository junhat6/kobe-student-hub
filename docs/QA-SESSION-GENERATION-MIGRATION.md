# Independent migration QA — Cycle 49

Verified 2026-11-05 against working tree based on `45695799596e42304c8a61369a97d3e18980648f`. This report supersedes the initial global-equality-fence QA result. Changes to fingerprinted files require revalidation before treating this as freeze evidence.

## Actual results

- `npx vitest run tests/session-generation-migration.test.ts tests/oauth-attempts.test.ts tests/browser-flow.test.ts`: **38 passed across 3 files**, duration 4.07 seconds; the migration suite contains 15 tests.
- `npx tsc --noEmit`: **passed** after the final test changes.
- Miniflare requires loopback binding; sandbox-only execution initially failed with `EPERM`. Authorized local-loopback runs passed. No remote database, real identity, Google service, secret, gate or runtime configuration was used.

The suite independently applies real migrations 0003/0004 and marker-delimited 0012 to fresh ephemeral Miniflare D1 databases. It does not invoke the coordinated fixture schema installer. Fictional fixture OAuth uses a public deterministic local cookie key.

## Evidence scope

1. A populated legacy session receives `revoked_at_ms=created_at_ms`; its matching opaque cookie is rejected after upgrade. Account rows remain equivalent. Synthetic private-draft/public-content sentinel rows survive. This is bounded unrelated-table preservation evidence, not an end-to-end test of the real draft/public schema.
2. An unmigrated database fails closed for authentication and session creation. A late migration collision rolls the entire D1 batch back, including tables and added columns.
3. Wrong claim owner cannot complete; correct completion marks its attempt; replay cannot issue another session; direct duplicate `attempt_hash` insertion violates the unique index.
4. Each actual epoch/status/delete transition advances the global ordering revision. Old target-subject completions fail, including after status reactivation and deletion followed by recreation. Unclaimed callbacks can be claimed before identity is known, but final verified-subject completion rejects the revoked subject. Unrelated claimed/unclaimed login completions succeed.
5. Two existing devices of an unrelated account stay authenticated. Fresh target and unrelated logins work. Same-millisecond operations demonstrate revision ordering independent of timestamp equality.
6. An old registration attempt cannot recreate a deleted subject; an unrelated new subject can register; a newly started target-subject registration succeeds as pending; completed registration replay fails.
7. An outstanding old unexecuted command blocks floor cleanup. Executing it after revocation retains its original stamp rather than refreshing its authority.
8. With 105 floors and live old snapshots, cleanup removes none. After snapshots expire, successive cleanup calls remove 100 then 5 and permanently advance the watermark. Rolling application time back does not revive an old unclaimed callback, claimed login completion, claimed registration completion or raw unexecuted command. A newly issued attempt at the rollback time still succeeds using the current stamp.
9. A fixture trigger forces subject-floor deletion to fail; the D1 batch rolls watermark advancement back and preserves its floor.
10. Three actual-D1 draft repository tests advance a controlled clock only when the final SQL references `private_article_drafts`, after successful session preflight. At the absolute deadline, idle deadline and a backward-clock transition, both read and versioned update return null. The preexisting valid draft is readable before interception and remains unchanged afterward. The proxy delegates to real Miniflare D1; it does not fake query results. This verifies that final binding re-reads time instead of authorizing with the earlier proof timestamp.

11. Actual `OAuthAttemptStore.cleanupExpired()` at start plus 600001 ms deletes the expired attempt and clears the live session’s `attempt_hash` via `ON DELETE SET NULL`. That session still authenticates inside its idle/absolute window. The original callback cannot claim even at the earlier clock; the broker performs no provider fetch, the old proof cannot issue another session, and session count stays one. Deleting its account afterward still cascades the session. Cleanup returns exactly one deleted attempt despite the FK nulling update. The implementation uses `DELETE ... RETURNING state_hash` and counts returned rows, preserving the numeric contract of at most 100 deleted attempts per call.

## Independent assessment

The narrower implementation removes the earlier cross-student login interruption caused by equality with the global revision. The global value is now an ordering stamp; final identity-known writes consult the subject-specific floor plus a permanent minimum generation. A subject can trigger revocation only for its own older attempts under the modeled policy. Existing sessions continue to use account epoch/status and browser generation.

Cleanup's safety argument holds in the inspected SQL: the watermark can advance to a floor only when no older-stamp attempt remains unexpired and no older-stamp unexecuted command remains unexpired. The two checks and deletion occur in one batch. After deletion, the permanent watermark rejects retired stamps even if the clock moves backward, so deleting the subject tombstone does not restore its old authority. A concurrent successful completion before revocation is subsequently revoked by account epoch/status/deletion; revocation before final completion is rejected by the floor. The tests cover sequential commit orders implicitly via preexisting sessions and post-revocation completions, not a parallel scheduling stress test.

The attempt/session FK lifetime mismatch is resolved by `ON DELETE SET NULL`: an eight-hour session no longer pins its ten-minute attempt row. Current session authority intentionally does not require that transient attempt row. Deleting the row cannot revive the callback because claim/completion require its existence. Attempt cleanup uses a maximum of 100 deleted attempt rows. Its returned numeric count excludes FK side effects by counting returned deleted rows rather than D1 `meta.changes`.

Lower-bound cleanup safety remains intact when attempt rows disappear: an absent attempt cannot be claimed or completed even after clock rollback, and any still-live unexecuted command continues to block retirement of its older stamp. The permanent minimum generation guards retained expired capabilities when floors are purged. A forward application-clock jump can irreversibly expire/delete capabilities early; rolling time back does not restore them. This is fail-closed availability behavior, not time-source robustness evidence.

No major correctness defect was found within this bounded review. Cleanup is bounded to 100 deleted subject identifiers per call, but the query's work is not necessarily bounded: correlated checks can scan accumulated attempts/commands and floors. Profile/query-plan/load validation is still needed before claiming scalability. Completed or superseded attempts conservatively delay floor cleanup until their expiry.

There is no scheduled cleanup: retained identifiers are physically purged on later bootstrap/command activity. A quiet service may retain them indefinitely until that activity. The retained identifier purpose and cleanup behavior must remain explicit in deletion/privacy policy. This is a remaining production privacy/operations limit, not an authorization bypass. These performance/retention limits do not block gated local source preparation. Auth remains gated; these checks do not authorize real-user enablement, remote migration or deletion claims.

## Reviewed fingerprints

```
7b392d1eda741cba23e48fd0f7704cf5021723586852ccd599e792f120f9b381  migrations/0012_browser_session_order.sql
51852efab79a83f13818969eb9670c42b7db08cdd7549f5a62c249667d117a04  worker/auth/browser-session.ts
5433cf2e2280356bddc6a6a418a615e2a9e207ee528652362e21265923312d5b  worker/auth/sessions.ts
2115c770d8cf3cef6422a658860d6c08997414ba320ebf6545dd85b09c567f4d  worker/auth/pending-registration.ts
479a01042cac34a20b7b17416e1f9f6b4556fc0df09eb86f0039d4c0bbd1d0d7  worker/auth/session-guard.ts
e47368a792f19ccf1430572afca56240e6842b2dfda58744e4c45259a2a5c822  worker/drafts.ts
2a8c87b3418e6fc7183d0016e3472b375d3b16ba617cbbb9d6ddfa1db5f9e895  worker/auth/oauth-attempts.ts
c177ba345e8491197c0b17f274d64b6eb7318288d45f378600ab188429525d88  worker/auth/google-login.ts
6d16cc3eba7e94e3cc988be167b814b36328378b2be4811734ea3dd25886b39a  tests/session-generation-migration.test.ts
```
