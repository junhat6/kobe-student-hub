# OAuth late callback response — independent QA

2026-11-05. Separate QA context reviewed AGENTS, README, WORK, DECISIONS, DESIGN, the adapter, browser claim, attempt store, broker, production entry and candidate OAuth/release documentation. QA changed only this record. No real Google request, credential, operational encryption key, remote database, configuration, grant or deployment was used.

## Finding

The bounded attempt-cookie correction is supported: callback responses never write `__Host-kobe-oauth`; start remains its only HTTP writer. The held-provider-failure test establishes that A was already consumed before B starts, then applies A's late response and completes B. This addresses the response-order defect that request-time matching alone could not prevent. Lower-layer clearCookie fields remain unchanged and are intentionally ignored by this adapter.

This is **not authentication release approval**. The separate successful-response reproduction passes by observing the unsafe result: B is the current identity, then applying the saved A response changes the session identity to A. It is an executable hazard record, not a safe acceptance assertion. Server generation/coordination and recovery still require design and verification before enabling real authentication. The candidate documentation accurately identifies this distinction, and its finalize proposal correctly warns that a finalization CAS alone cannot prevent an already-authorized late header.

## Retention and security review

The start cookie uses encrypted JWE (`dir` / `A256GCM`), a host-only `__Host-` name, Path=/, Secure, HttpOnly, SameSite=Lax and Max-Age=600. Its sealed payload contains state, browser binding, PKCE verifier and issuer/audience/time context. It excludes code, provider token, client secret and session token. Issuer, purpose-specific audience, algorithm, expiry and bounded input checks remain intact. Callback handling does not renew its browser lifetime or JWT expiry.

Retaining ciphertext until the original expiry increases the time it accompanies same-origin requests after consumption. HttpOnly prevents ordinary script reading but does not establish platform-log secrecy or protect ciphertext captured with a compromised encryption key. Source review found no application log calls in the four reviewed OAuth modules; actual platform/header/trace logging remains an unresolved operational gate, as documented in LOGGING-GATE.md.

Retained cookie material does not bypass atomic one-time DB consumption. Consumed retries do not exchange again. An unconsumed attempt is refused at expiry even when the fixture keeps its cookie beyond browser Max-Age. DB rows/nonces are not guaranteed deleted after ten minutes: explicit bounded cleanup remains distinct from authorization expiry. None of these local checks proves actual browser cookie expiry, SameSite behavior or real provider transport.

## Executed checks

Rebuilt fixtures with `node scripts/build-test-fixtures.mjs`, then independently ran the final stable source/tests with local Miniflare listener authorization:

```text
npx vitest run tests/oauth-late-response.test.ts tests/oauth-http-cookie.test.ts tests/oauth-http.test.ts tests/oauth-http-independent.test.ts tests/browser-flow.test.ts tests/oauth-attempts.test.ts tests/google-login.test.ts
7 files / 60 tests passed; 10.96s
```

The final late-response file has five cases: held consumed-A failure versus B; unresolved A-after-B session identity replacement; sealed retained fields/original expiry/no retry exchange; retained-but-expired unconsumed refusal; and exact bounded host-only secure cookie attributes. Other focused files cover stale request matching, denial/failure, registration separation, malformed/duplicate/oversized cookies, DB refusal, concurrent claim/replay, PKCE, expiry and source-gate refusal. An earlier overlapping run also passed60 in11.00s; the final run above is the authoritative checkpoint.

Production `worker/index.ts` still declares `const OAUTH_HTTP_RELEASE_ENABLED=false`; the independent complete-configuration test confirms enable-like input cannot expose auth routes or touch the forbidden DB, and production health remains writesEnabled:false. QA did not execute full build/browser/deployment checks; those remain the root task's responsibility. No UI or actual-browser evidence is claimed.

## Verified fingerprints

| File | SHA-256 |
| --- | --- |
| worker/auth/oauth-http.ts | b7b5d272e8968256c5af77ff7341c98ff5c49d66dc4d9693486104c2d700013e |
| worker/auth/browser-flow.ts | 8441c45c1e4709e1009981256b61cba1168ef3b71d8739e61007b9b17f5b30d1 |
| worker/auth/oauth-attempts.ts | 44d02fb46f260a90da3a0846d4a4a45d8f888be3206892b291603c8e98fdb2c9 |
| worker/auth/google-login.ts | c5e1217a2c78b6069b2d20de0c0c57470671fd8b95715c0419b8a1642859be11 |
| tests/oauth-late-response.test.ts | c71b043b37905b8082a60de3f5aebfa9d12ecd586488bbc694b48e209c6288e9 |
| worker/index.ts | 03841336c978198149e144619fbae35c6a0d0f97c13ef5ac105f620c00531f89 |
