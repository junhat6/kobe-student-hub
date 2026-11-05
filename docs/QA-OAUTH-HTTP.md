# Independent QA: OAuth HTTP adapter and closed release gate (Cycle40)

No blocking finding remains in the tested fictional local HTTP scope. This is HTTP glue around existing verified login, pending registration and current-session boundaries. The production source gate remains false, including with complete configuration and enable-like runtime input. No real authentication or posting was activated.

## Final independent execution

After the developer freeze and completion of the root fixture build, independently ran Vitest only against those final built fixtures:

```sh
npx vitest run tests/oauth-http.test.ts tests/oauth-http-independent.test.ts tests/browser-flow.test.ts tests/google-login.test.ts tests/pending-registration.test.ts tests/pending-registration-independent.test.ts tests/session-http.test.ts tests/sessions.test.ts
```

73 tests passed in11.11 seconds across8 files: new adapter10, independent adapter3, existing browser-flow13, Google broker10, pending-registration12 plus independent pending3, session HTTP10 and session store12. Critical positives use actual JOSE ephemeral RSA signatures, fixed-endpoint provider/JWKS stubs and real local Miniflare/D1 stores. No decoded-identity shortcut is exposed by production.

Every independent OAuth HTTP dispatch used redirect:manual before its first execution; authorization redirects were inspected without following them. The developer earlier corrected a cookie-flag ordering assertion and an invalid named Worker export, then passed the final17 adapter/production-Worker cases. A developer's earlier dispatch helper had allowed following redirects; its external outcome was not independently established here, and all inputs were synthetic. This report does not claim that earlier run made no external request. No such redirect-follow run occurred in the independent HTTP tests.

The parent's separate378-test/public48/types/build/dry-run success is separate evidence. No user-facing UI changed, so no new browser/screenshot or repeat of the unchanged local editor164 was undertaken. Raw HTTP cookie assertions are not evidence of real browser storage or SameSite/cross-site behavior.

## Source review

parseOAuthConfig accepts optional request-scoped inputs only: an exact canonical HTTPS origin, bounded dedicated Web client format, printable bounded secret and canonical base64url encoding of exactly32 key bytes. Noncanonical padding/unused pad bits, absent/partial/null/wrongly typed values fail closed. The parser runs before adapter DB/provider work. No process environment lookup, shared mutable request configuration, installed secret declaration or actual secret-store creation was added.

The production entry's local source constant is false; it is not an exported Worker handler or a runtime setting. With the gate false the previous sample fallback remains in charge, rather than exposing a configuration probe. The adapter's enabled option is for source/test composition and does not create an environment-controlled release path. Config and generated Env remain unchanged.

For the explicitly enabled fictional adapter, starts require exact configured request origin and same-origin POST through existing broker checks. Registration starts the distinct sealed purpose. The shared callback tries ordinary login first and registration only when the claim is unmatched/null; a consumed matched failure never starts another exchange. All handled callback outcomes return an empty303 to the same fixed clean configured root and clear the attempt cookie. Only an authenticated existing active account adds a session cookie. No caller-selected next/return URL, identity, provider payload, token or broker actor is serialized.

Session GET delegates to the existing handler and exposes only CSRF. Logout reuses Origin/CSRF, empty-body and final-write checks and revokes only the current token. Matched enabled-adapter responses have private/no-store, Cookie variance, no-referrer, nosniff and noindex; malformed configuration and origins fail generically without secret reflection. Callback status/landing alone is not a visible pending approval or successful admission result.

## Executed evidence

The developer cases independently rerun here verify both actual active login and pending registration through the adapter, malformed config/origin/routes, invalid signature/nonce/domain/provider refusal, clean denial/unmatched handling, replay without a new session, twelve concurrent callbacks yielding one exchange/session, and CSRF logout leaving an earlier independent session valid.

Raw response getSetCookie checks verify two separate values for active login: attempt removal and the opaque HttpOnly/Secure/SameSite=Lax session. No comma splitting or browser-masked Set-Cookie check is used. This is consistent with Workers' append semantics, but the actual runtime response is the execution evidence. [Cloudflare Headers](https://developers.cloudflare.com/workers/runtime-apis/headers/).

Independent additions cover:

- A valid active session cookie accompanies a new subject's registration callback. The response has only attempt removal, creates no new session and does not clear the existing session. The new account is pending, cannot log in and cannot obtain a session without the preexisting active cookie. The existing session still returns a CSRF-only response.
- Each optional binding is absent, null or wrongly typed, plus a wholly empty configuration, across start/register/callback/session/logout. Every response is generic503 with no Set-Cookie/Location; no OAuth attempt or provider exchange is created. Source inspection establishes early parser rejection; this is not a platform telemetry audit.
- Complete fictional bindings plus enable-like bindings/header/option cannot open production routes. A test-only DB proxy throws from prepare/batch/exec/withSession/dump; all five production auth/session/logout requests still return405 with no cookies/redirect and health retains writesEnabled:false, without an outbound exchange. This demonstrates the source gate before tested database operations, rather than relying only on unchanged row counts.

Existing pending tests retain invalid-identity refusal, first-registration competition, email collision, ignored SQL writes and current-status boundaries. Pending receipt remains separate from eligibility, session issuance, promotion and recovery.

## Source and production separation

Byte-compared all existing broker/browser/pending/session implementation and test files, source configuration, generated Env and application entry listed below with HEAD `df18220398cd2e3b7bab037042857793d4f502b6`; they match. The new production Worker middleware/gate is an intentional source change and remains disabled in runtime tests. It does not expose test JSON identity/fault handlers.

Independently compared all three local production frontend asset names and bytes with the existing sample515 archive; they match. No rebuild, remote request or deployment was needed for this comparison. Source-gate behavior was verified in local Workers, not on a newly deployed live Worker.

| Canonical frontend asset | SHA-256 |
| --- | --- |
| `MarkdownRenderer-DKi9-iI6.js` | `2a728fd3efc9582ed35259fa257da40ab18e775fac427c4005d4e640384119d5` |
| `index-BDO7j6qF.js` | `82cd7568d3a316425d58f8ebb2c91ec8c1fbbf0b865ab000bcc0caa0a41b4512` |
| `index-TfhgnYfT.css` | `693f21fae8bde088ee95499e2fb2ee5dd9a1aa6891d734e40c171555b5d5ce2d` |

## Documentation and limits

OAUTH-HTTP.md distinguishes optional validation types from installed secrets, fixed protocol authorization/exchange values from public response disclosure, and local HTTP integration from a live release. It keeps origin/provider ownership, safe custody/configuration, deployment/database targets, real callback log/transport protection and enrollment/operating policy as separate gates.

No live credential, real Google callback, actual account provisioning, remote SQL/configuration, resource, grant, contract, deployment or GitHub approval operation was performed. Actual browser redirects/cookie enforcement, physical devices, platform/CDN/browser logging, admission/graduation/recovery, operations/notifications/contact/appeal/retention and student value remain unverified. Application response omission and source silence do not prove secrecy of actual platform logs. Previously issued sessions retain their existing lifetime; logout is current-token only and does not undo completed writes. No screenshots were produced.

## Final source fingerprints

The table includes new HTTP integration and the unchanged runtime/test/configuration boundaries checked above.

| File | SHA-256 |
| --- | --- |
| `worker/auth/oauth-http.ts` | `3da2f6df44e5161dfb4ce79212dc772612c3ea753d99924b92da240fce5b4aad` |
| `worker/index.ts` | `03841336c978198149e144619fbae35c6a0d0f97c13ef5ac105f620c00531f89` |
| `tests/oauth-http.test.ts` | `d97d0ccdb30310d5872be9f6480c1156282e15be1dd004d8ba060894a70f53c9` |
| `tests/oauth-http-independent.test.ts` | `705ff2238f2b9ffa30c402f5d31ee3bcaa3c3a573c054ad291ccd23b5ea46b0d` |
| `tests/fixtures/oauth-http-worker.ts` | `ea519ed3ae145f489be17f364a329c1eb61c1ab6cee0a236a4aadc0ed2ce25bf` |
| `scripts/build-test-fixtures.mjs` | `04e53f1e9e7d37ce7568481fd108f1bc3820270cdaf4043547989ffef374c000` |
| `tests/google-login.test.ts` | `a92272c0a9a07c03a1d9d469ddafdb4fd7a96ec518e2ee4880ded579dd9139d3` |
| `tests/browser-flow.test.ts` | `0f408bb419d96ed62d899cde07f3e0a3f76014c26beff0ee8cf901d55263b937` |
| `tests/pending-registration.test.ts` | `873681dbc96994e90e8ee018fd14d921ff2a8dc835c91870285af013de4ec268` |
| `tests/pending-registration-independent.test.ts` | `6bf1f93cdb62eafce3f3cda0ab68ba2745c60200f8be7642826a12f345e17a79` |
| `tests/session-http.test.ts` | `716707c3186c3543f7374c77ce7a84b66159dfccc6ecb0e274487ffec95392b8` |
| `tests/sessions.test.ts` | `771ece54457d693679fa10f0d26033d944c8378a41e0aa77405ca542c4aeb286` |
| `worker/auth/google-login.ts` | `c5e1217a2c78b6069b2d20de0c0c57470671fd8b95715c0419b8a1642859be11` |
| `worker/auth/browser-flow.ts` | `8441c45c1e4709e1009981256b61cba1168ef3b71d8739e61007b9b17f5b30d1` |
| `worker/auth/pending-registration.ts` | `3a767a391c73c4ea435a56822c205410140b48e9c777ede7459908d73bfbf294` |
| `worker/auth/sessions.ts` | `4faa88bca74b5e6cefd1efbc2792b42faff0d8949aae67573f23a3b6910a411b` |
| `worker/session-http.ts` | `843123a342d74109e4bc8b10d76250fab6bafbc3fb15350bba217037f5fcab98` |
| `wrangler.jsonc` | `f003f0183150fd04ff5d7f53c324d2fcd9d42d5dc7821af840525d5e27147445` |
| `worker-configuration.d.ts` | `08b59a4d724472420029ca94ae266c406cfe65d12f40308befd43b630a197764` |
| `src/main.tsx` | `ce4c8523c65ecf3352f2705e3181fe1dbad737d4504fe16fe59ebdf1a7b5ec26` |
