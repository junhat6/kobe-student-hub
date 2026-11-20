# Independent QA — Cycle 03 identity boundary

Date: 2026-11-03. Reviewer: independent QA agent, separate task/context from the implementer. Reviewed `feat/school-identity-boundary`, working-tree implementation based on `e74d822f5d558b211472090c314979598ebc193e`. The base SHA is not a claim that uncommitted changes were already included in a final release.

## Scope and disposition

No blocking defect found in this narrow **unconnected internal verifier and ownership-policy foundation**. This is not a completed authentication system or permission to accept real student content. No UI/login route was added by this cycle.

Independent source review confirmed:

- JOSE verifies the actual RS256 signature with a fixed HTTPS Google JWKS URL. Key caching contains public signing keys, not request tokens or identities. The verifier does not trust a token-supplied key source.
- Google issuer, configured single audience and optional presenter (`azp`) are checked; multi-audience trust is intentionally rejected. Expiry, issued-at/max-age, required claims and matching expected nonce are verified. The 600-second max age has the configured five-second clock tolerance; it is not a zero-tolerance cutoff.
- Verified email flag must be boolean `true`, hosted domain must exactly match the school domain, and the email's domain is also checked. Domain hints or a client-supplied email string alone do not establish identity.
- Return value contains only private provider/subject/email fields; Google name, picture and the original token are deliberately omitted. No route returns this identity as a public profile.
- Missing configuration, malformed/oversized tokens and signature/claims/JWKS failures return null. The code does not log tokens or identity values.
- `mayReadPrivateRecord` allows only an active matching owner. Its actor is an explicit trusted-server-session input, not an authenticator; passing request JSON as that actor would be a future integration bug. No administrator override is silently provided.
- Production `worker/index.ts` and `wrangler.jsonc` have no diff from the base commit. The test-only Worker entry is referenced by the test bundle command and tests, not production configuration. The existing write gate remains closed.

## Independent tests actually executed

Rebuilt the test-only Worker bundle before executing tests to avoid relying on a stale `.worker/auth-test.js`:

```text
npx esbuild tests/fixtures/auth-worker.ts --bundle --format=esm --platform=browser --outfile=.worker/auth-test.js
npx vitest run tests/google-identity.test.ts tests/google-identity-worker.test.ts tests/private-access.test.ts

Test Files  3 passed (3)
Tests      28 passed (28)
Duration   337ms
```

The command was run by this reviewer with required sandbox escalation for the local Miniflare/Workers runtime. No real Google endpoint/account login, Cloudflare provisioning, account permission change or remote D1 retry was performed.

The fixtures generate RSA key pairs in memory and sign JWTs using JOSE. Only the public-key fetch response is replaced with a generated JWKS fixture. The Node tests exercise signature tampering, foreign signing keys, unknown key ID, HMAC algorithm confusion, issuer/audience/presenter, expiry/old/future timestamps, school-domain/email checks, nonce mismatch, malformed/missing configuration and key-fetch failure. Miniflare executes the same verifier against signed/forged/non-school/wrong-nonce fixtures. Ownership tests cover missing actor, another account, empty identity, suspended/deleted actor and the active owner.

These 28 tests are this independent subset; an implementer-reported larger suite is separate evidence.

## Additional independent boundary checks

Using a separate ephemeral Node process, generated another in-memory RSA fixture and substituted only the fixed JWKS fetch response. No source/test file was changed for these checks.

- Missing `iat`: rejected.
- Expiry before issued-at: rejected.
- Fractional issued-at: rejected.
- Missing email: rejected.
- The same correctly signed token with the same supplied expected nonce was accepted twice. This is **expected for this stateless verifier** and confirms that replay prevention has not been implemented here. One fixed Google JWKS fetch occurred; the public key cache was reused.

The repeated-token result is deliberately retained as evidence of the integration boundary, not described as a successful replay defense.

## Not implemented or established

This verifier checks a token against a server-supplied expected nonce; it does not create an OAuth attempt, bind it to a browser, validate/consume OAuth state, atomically consume the nonce, issue/rotate a session, prevent session fixation, enforce CSRF, enroll/provision a user, prove current enrollment, implement graduation rules or protect a real draft endpoint. These must be designed and tested together before real sign-in or writes are enabled.

The in-memory RSA fixture is not a real Google-issued token or live OAuth end-to-end flow. School-domain membership is not proof of current enrollment. The ownership helper's unit tests are not evidence that a future session loader/database endpoint derives actor identity securely. No real student value trial or real deployment was part of this QA.

## Reviewed source identity

SHA-256 at independent execution:

```text
worker/auth/google-identity.ts       9c79b18e228fb34caf02adcc1e11cd2bfd60cdd9537450086f192d1176c922a4
worker/auth/private-access.ts        2002d9c86d718c9b645af99862d5e690fd8e31f78e09ae7f04cc9a5ce56acd2a
tests/google-identity.test.ts        322e39b1f2e41f5dae387b950a729c0c2d054a6b84cc5c3e32fd46e3505c3833
tests/google-identity-worker.test.ts b2e7fa534096d03811a89e3d917052dbbfa96143698691f08d6286b2cb9398b9
tests/private-access.test.ts         a2b3a79de483bf6121894de792ac7a0a8b4f0a8e5f63acdf0f1f27ac3a7e3318
```

## Final documentation and closed-route recheck

Independently reviewed `docs/AUTH-BOUNDARY.md` and the Cycle 03 section of `docs/WORK.md` after the implementer's final additions. Their wording correctly distinguishes signature verification from token decoding, fixed-key fixtures from live Google sign-in, hosted-domain identity from enrollment, nonce equality from one-time consumption, and the pure ownership policy from real endpoint/session enforcement. The plan leaves #4 open and does not claim that posting, OAuth callbacks or sessions are implemented. No blocking contradiction found.

Additional independent execution rebuilt the **production** Worker bundle in dry-run mode before testing the newly added real-app negative case:

```text
npx wrangler deploy --dry-run --outdir .worker
npx vitest run tests/worker.test.ts

--dry-run: exiting now.
Test Files  1 passed (1)
Tests       4 passed (4)
Duration    412ms
```

The new negative test sends a client-supplied bearer token plus school-email/verified/admin/account claims to `POST /api/auth/callback`. The real Worker returns 405, issues no `Set-Cookie`, and health still reports `writesEnabled:false`. This is a denial test, not a mock login. The same independent test run also rechecked the sample-only/public-status projection, all content-write method denials and safe storage-failure response on the local Workers/D1 runtime. No remote deployment or database creation occurred.

Independent suite total in this review: **32 passing tests across four files** (28 identity/owner tests plus four production-boundary tests). The implementer's 37-test full-suite result is distinct evidence; this reviewer did not independently claim to execute every test in that larger suite.

Final additional SHA-256 identities:

```text
docs/AUTH-BOUNDARY.md b326badf0e2ddc97434aaba4e409c5f2b8a74f58f41e1d82050429d7a051c087
tests/worker.test.ts  11f3223e1d89c03f57ce722dc46e9db750527cffa67008a40b51b551c23d23ee
```

No source or test files were changed by this reviewer. Only this QA report was edited. No blocking finding remains for the unconnected internal foundation; all real-authentication/session/enrollment/publication limitations above remain in force.

## Narrow independent check of Cycle 02 evidence correction

Reviewed the consolidated Cycle 02 section in `EVIDENCE.md`. There is exactly one level-two `Cycle 02` section; the provenance correction is a subsection rather than a duplicated result section. It now distinguishes the implementer's earlier full run, the final wording/heading rebuild, this reviewer's final mobile subset, and the implementer's final desktop comparison run. It explicitly says transient test-results/report outputs were replaced by later runs; retained hashes and recorded executions are the basis, not a claim that the old raw report remains locally.

Independently compared all four retained card-study PNG files byte-for-byte with their blobs in base/main `e74d822f5d558b211472090c314979598ebc193e`. All four are identical. Independently computed SHA-256 values match the values recorded in `EVIDENCE.md` for `a-desktop`, `a-mobile`, `b-desktop` and `b-mobile`.

Opened retained `b-desktop.png` at original resolution and visually confirmed the final disclosure: ordinary page-loading communication still occurs, while comparison-answer collection, selection-event transmission and viewing-history storage are not implemented. No image was regenerated or edited for this check. This is verification of the retained image/content and documentation consistency; the implementer's historical desktop execution remains its recorded execution evidence, not a new independent desktop test run. No authentication tests were rerun, and the nonce/session/live-Google limitations above are unchanged.
