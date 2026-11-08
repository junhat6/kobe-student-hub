# One-time OAuth attempt preparation — Cycle 04

## Scope

The Cycle 04 evidence below describes the original unconnected repository. The current ordinary account candidate composes one-time claim, browser binding, S256 PKCE, server Google verification, session/CSRF and self-declared academic years. Its code-flow response arrives in a fragment, is cleaned before a bounded same-origin POST and is passed to the broker only in RAM; query GET does not consume an attempt. Authoring remains closed. This candidate has not connected real Google or granted an operator role.

Originally no production route started/consumed attempts. After explicit user authorization, migration 0003 was applied to the dedicated preview D1 and independently checked; see [remote migration evidence](QA-AUTH-MIGRATION.md). Historical migrations must not be replayed or reset; Worker deployment still does not implicitly run remote SQL.

`OAuthAttemptStore.start()` generates fresh 256-bit state, browser-binding and nonce values using Web Crypto. Only SHA-256 digests of state/browser-binding go into the private table; the nonce remains private transient verification context. No authorization code, access/ID/refresh token, PKCE verifier or client secret is stored. Return values must never be logged or placed in public data. Future callers must bind browserBinding to a secure server-owned browser context, not accept it as an arbitrary callback JSON field. Cookie transport and parallel-tab behavior are not designed by this primitive.

## Atomic consumption and limits

Consumption is one prepared conditional `UPDATE ... RETURNING nonce`, requiring the state digest, matching browser digest, no previous consumption, and `created_at <= trusted_server_now < expires_at`. There is no SELECT-then-UPDATE race. At most one successful consumer receives the stored nonce. A wrong browser/state does not burn the valid attempt. Clock values are trusted server inputs; test fixture clock injection is not a production API.

Validity is 10 minutes. This is **not a ten-minute database-retention guarantee**. Rows and nonce remain until cleanup executes. The current server policy uses a 24-hour grace after stored expiry, a persisted minimum interval of 15 minutes and at most 100 deletions per category per run; only expired authentication transport records are eligible. The OAuth-gated scheduled handler emits fixed outcomes and bounded counts, never identifiers or exceptions. Production activation must install `*/15 * * * *` in the dedicated private production configuration and verify execution; the public preview template and sample-only prepare guards remain unchanged. Existing server issuance limits bound live contexts and per-context commands. There is no immediate retry or physical-deletion/backup SLA. Never reuse state intentionally or recreate an attempt during callback handling. See [maintenance behavior and limits](AUTH-MAINTENANCE.md).

The future flow should claim an attempt before code exchange/verification/session side effects. A failed verification, provider outage, lost response after a committed claim or other ambiguous result requires a fresh start; do not reset consumed markers to retry. This trades retry convenience for a clear single-winner boundary. The helper does not provide atomic session issuance or cross-service rollback.

One-time **attempt** consumption does not make every JWT globally single-use. The stateless verifier still accepts the same valid token when called separately with the same expected nonce. Every future callback must use the repository and stored nonce; bypassing it would bypass this protection. PKCE, state/browser transport, registered redirect URI, actual provider code exchange, session lifecycle, CSRF, enrollment and moderation remain separate gates.

## Evidence

Local Workers/D1 tests exercise fresh secrets/digest storage, sequential replay, 20 concurrent claimants with exactly one winner, wrong browser/state without burning the real attempt, malformed input, exact expiry/before-creation, bounded cleanup and missing storage. A test-only entry composes the actual repository with the existing real-signature verifier and proves first completion succeeds/second fails, and failed verification consumes the attempt. This entry is not the production callback.

The real app's public-catalog test now applies all local migrations and includes a private attempt row, verifying no nonce/hash/table fields enter the public catalog. No remote or real-account test is inferred from these fixtures. Independent execution is recorded separately in QA-OAUTH-ATTEMPTS.md.

## Callback log gate

[LOGGING-GATE.md](LOGGING-GATE.md) remains mandatory before connecting a real callback. Its latest scoped actual-platform audit covers the fragment/POST transport and eight synthetic-provider branches; it also records the old query transport's synthetic exposure and the stored-status/correlation limits. No real credential or Google login was used. App log silence alone is not the evidence for this result.

## References

- [D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/) and [D1 SQL](https://developers.cloudflare.com/d1/sql-api/sql-statements/).
- [SQLite RETURNING](https://www.sqlite.org/lang_returning.html): returns rows changed by the statement. The local runtime tests exercise the conditional-write behavior directly.
- [OAuth security BCP, RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html) and [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect).
