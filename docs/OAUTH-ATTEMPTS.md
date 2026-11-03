# One-time OAuth attempt preparation — Cycle 04

## Scope

An unconnected D1-backed attempt repository, not a working OAuth callback. No route starts/consumes attempts in the production Worker. The remote auth-state table migration has not been applied; it remains a separate authorization gate, and Worker deployment does not implicitly run it. No real Google setting, user, session, code exchange, PKCE storage, permission grant or publication gate is enabled here.

`OAuthAttemptStore.start()` generates fresh 256-bit state, browser-binding and nonce values using Web Crypto. Only SHA-256 digests of state/browser-binding go into the private table; the nonce remains private transient verification context. No authorization code, access/ID/refresh token, PKCE verifier or client secret is stored. Return values must never be logged or placed in public data. Future callers must bind browserBinding to a secure server-owned browser context, not accept it as an arbitrary callback JSON field. Cookie transport and parallel-tab behavior are not designed by this primitive.

## Atomic consumption and limits

Consumption is one prepared conditional `UPDATE ... RETURNING nonce`, requiring the state digest, matching browser digest, no previous consumption, and `created_at <= trusted_server_now < expires_at`. There is no SELECT-then-UPDATE race. At most one successful consumer receives the stored nonce. A wrong browser/state does not burn the valid attempt. Clock values are trusted server inputs; test fixture clock injection is not a production API.

Validity is 10 minutes, a local implementation choice. This is **not a ten-minute database-retention guarantee**. Rows and nonce remain until explicit cleanup executes. `cleanupExpired()` removes only expired rows, at most 100 per call; no scheduler or production job was added. Before real use, implement bounded cleanup operation/monitoring, abuse limits and an approved retention policy. Never reuse state intentionally or recreate an attempt during callback handling.

The future flow should claim an attempt before code exchange/verification/session side effects. A failed verification, provider outage, lost response after a committed claim or other ambiguous result requires a fresh start; do not reset consumed markers to retry. This trades retry convenience for a clear single-winner boundary. The helper does not provide atomic session issuance or cross-service rollback.

One-time **attempt** consumption does not make every JWT globally single-use. The stateless verifier still accepts the same valid token when called separately with the same expected nonce. Every future callback must use the repository and stored nonce; bypassing it would bypass this protection. PKCE, state/browser transport, registered redirect URI, actual provider code exchange, session lifecycle, CSRF, enrollment and moderation remain separate gates.

## Evidence

Local Workers/D1 tests exercise fresh secrets/digest storage, sequential replay, 20 concurrent claimants with exactly one winner, wrong browser/state without burning the real attempt, malformed input, exact expiry/before-creation, bounded cleanup and missing storage. A test-only entry composes the actual repository with the existing real-signature verifier and proves first completion succeeds/second fails, and failed verification consumes the attempt. This entry is not the production callback.

The real app's public-catalog test now applies all local migrations and includes a private attempt row, verifying no nonce/hash/table fields enter the public catalog. No remote or real-account test is inferred from these fixtures. Independent execution is recorded separately in QA-OAUTH-ATTEMPTS.md.

## Callback log gate

[LOGGING-GATE.md](LOGGING-GATE.md) is mandatory before connecting any real callback. Not printing tokens in application code does not prove that request URLs, query parameters, cookies, bodies or traces are absent from platform/access logs. No real leakage was observed or asserted in this cycle; the deployed logging configuration and actual logs have not been audited for OAuth.

## References

- [D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/) and [D1 SQL](https://developers.cloudflare.com/d1/sql-api/sql-statements/).
- [SQLite RETURNING](https://www.sqlite.org/lang_returning.html): returns rows changed by the statement. The local runtime tests exercise the conditional-write behavior directly.
- [OAuth security BCP, RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html) and [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect).
