# Independent QA — Cycle 04 one-time OAuth attempts

Date: 2026-11-03. Reviewer: independent QA agent, separate task/context from implementation. Reviewed `feat/one-time-auth-attempts`, working-tree changes based on `6e82dfbd70669c3bc869fd5cc35e8cfe5c5b80fd`. The base SHA does not include the uncommitted implementation or imply a final release.

## Source and SQL review

No blocking defect found for this unconnected private repository foundation.

- State, browser-binding secret and nonce are independently generated with 32 cryptographically random bytes. State/browser secrets are SHA-256 hashed before persistence; the store returns their raw values only to its future server-owned start caller. Nonce is stored as private transient context for later token verification.
- Consumption is a single conditional `UPDATE … RETURNING nonce`, rather than separate read/write steps. The primary-key state hash, browser hash, unconsumed status and `created_at <= now < expires_at` predicates are evaluated in the same write. Only the winning update receives a nonce.
- Wrong state/browser binding does not match a row and cannot consume the legitimate attempt. Exact expiry and times before creation are rejected. Server clock inputs must be nonnegative safe integers with room for the ten-minute TTL; malformed secret values are rejected before querying.
- Schema constraints bound expiry and valid consumed timestamps. State hash is a primary key; expiry has an index. Cleanup selects expired rows only and caps each deletion batch at 100.
- The ten-minute TTL is a consumption-validity bound, **not automatic deletion or a guaranteed storage-retention period**. Cleanup is explicit; no scheduler is created. Rows, including nonce, remain stored until cleanup actually runs. A real flow needs an operational retention/cleanup plan.
- Store failures return null and do not log input/state/nonce. This source property is not verification of platform, proxy, browser or third-party log redaction.
- The separate fixture Worker exposes start/consume/completion only inside tests. Its completion consumes the attempt then calls the real JWT verifier with the stored nonce; it performs no code exchange, enrollment or session issuance. A failed token burns that test attempt, requiring a fresh start.
- Production Worker, Wrangler configuration and UI were independently checked against the base and have no diff. The fixture entry is not the production callback; existing authentication/writes remain closed.

## Independent execution

After the implementer confirmed its final run was complete, this reviewer independently rebuilt both test fixtures and ran the requested two-file subset. Results below are from this reviewer's own execution.

## Acceptance boundary

Atomic attempt consumption is one component of a future OAuth flow. It does not establish PKCE, browser-cookie delivery, OAuth state/redirect validation, code exchange, opaque-session lifecycle, global ID-token replay prevention, enrollment, log secrecy or real callback safety. No remote D1, credential, permission or actual authentication setup is part of this review. No real student-value test has been performed.

### Final independent run

```text
node scripts/build-test-fixtures.mjs
npx vitest run tests/oauth-attempts.test.ts tests/worker.test.ts

Test Files  2 passed (2)
Tests      14 passed (14)
Duration   595ms
```

Executed against local Miniflare/Workers/D1 with required sandbox escalation for localhost/runtime access. Both test-only fixture bundles were regenerated. The production Worker bundle had been prepared by the implementer's completed final run; production Worker source/config/UI were independently rechecked and remain unchanged from the base. No remote D1 or real callback/login was accessed by this reviewer.

| Independent coverage | Result |
| --- | --- |
| Three fresh random secrets; state/browser raw values excluded from stored row | Pass |
| Sequential consumption replay denied | Pass |
| Twenty concurrent consumers produce exactly one non-null winner | Pass |
| Wrong state/browser does not burn the valid attempt | Pass |
| Missing/malformed/oversized state rejected without burning valid state | Pass |
| Before-creation and exact-expiry rejection; last valid millisecond allowed | Pass |
| Stored nonce composed with real RSA/JWT verification in test-only Worker; repeat completion denied | Pass |
| Failed verification burns attempt; same-attempt retry denied | Pass |
| Expired-only cleanup capped at 100; live attempt preserved | Pass |
| Invalid clock and missing storage fail closed | Pass |
| All local migrations applied; private attempt row and private/non-sample content excluded from public catalog | Pass |
| Production write/callback refusal, no session cookie, writes disabled, safe missing-storage response | Pass |

The 14 tests are this independent subset. The implementer's reported 47-test full run is distinct evidence, not an independent full-suite run by this reviewer. The composition fixture demonstrates local attempt consumption plus signature validation, not a production callback/code exchange/session flow. No browser/E2E rerun was required for unchanged UI, and none is claimed in this cycle's independent run.

## Documentation recheck

Reviewed final `OAUTH-ATTEMPTS.md` and `LOGGING-GATE.md`. No blocking contradiction found:

- The validity TTL is explicitly separated from database retention. Rows/nonce remain until explicit cleanup; no cron is claimed.
- Single-winner consumption is attempt-scoped, not global JWT single-use. Failure or an uncertain committed result requires a fresh attempt, not resetting consumption.
- Browser binding, cookie transport, PKCE, redirect/state handling, actual provider code exchange and sessions remain future gates.
- Logging audit is explicitly **NOT RUN / NOT SATISFIED**. Application silence, source observability settings, no-referrer or sampled absence are not described as proof of platform log secrecy.
- Actual-log verification is a future authorized isolated-preview procedure using synthetic canaries and positive capture-coverage checks. No actual credential leakage is claimed, no raw private logs are requested in public GitHub, and monitoring must not be silently disabled globally.

## Reviewed source identity

Final SHA-256 at independent execution:

```text
worker/auth/oauth-attempts.ts          44d02fb46f260a90da3a0846d4a4a45d8f888be3206892b291603c8e98fdb2c9
migrations/0003_oauth_attempts.sql      403eb50fdd28feee1cba1038c2ccc6eb9dae1d501a421f3d3a3e7531b606a9c4
tests/oauth-attempts.test.ts           c32f57d4911b9e952be719cd686ad98ba98441eeaa907b7b8615425e5892e991
tests/worker.test.ts                   432e4f15c6cca4bc6316a5ff1d9404053a0e3d2686cd16270a69a37a9a221e1e
tests/fixtures/oauth-attempt-worker.ts 3207620c6043f00f2b064e9dae10ea021e4613cf1499d85a6c2b0aa60a59c6db
scripts/build-test-fixtures.mjs        f92efd06ba6cbb084f8c0a3f043f9911efc05d8a5bfb7390e875dd76272c32fc
docs/OAUTH-ATTEMPTS.md                 fc37b5a81b0416c3df422f5dbdd6e460fd89a39d8f9d10f4701d85fa647ad5b0
docs/LOGGING-GATE.md                   2cfc403ae04a53b936dea0bcc0a229f0faf9acfa9a42cc7789b4928f7ae50052
```

## Disposition

No blocking finding remains for this unconnected internal foundation. Only this QA report was edited by the reviewer. Real callback/session security, actual deployed logging/redaction, full-flow replay defense, enrollment and student usefulness remain unverified; the passing helper tests do not release those gates.
