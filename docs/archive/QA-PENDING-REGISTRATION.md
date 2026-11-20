# Independent QA: verified pending registration

No blocking finding remains within the server-private local scope. The new path records pending registration after actual signature verification; it does not approve enrollment, issue a session, link accounts by email or open signup/login in production.

## Independent execution

After the final source freeze and parent required checks, independently ran the final built Worker fixtures:

```sh
npx vitest run tests/pending-registration.test.ts tests/pending-registration-independent.test.ts tests/google-login.test.ts tests/browser-flow.test.ts tests/sessions.test.ts
```

50 tests passed in10.83 seconds: pending registration12, independent additions3, unchanged Google broker10, browser flow13 and sessions12. These are actual local Workers/Miniflare-D1 operations with ephemeral in-memory RSA signing keys and fixed-endpoint provider/JWKS stubs. Critical registration cases enter through the broker and actual JOSE signature verifier, rather than trusting decoded identity JSON. The isolated raw-store fixture is used only for explicit negative validation tests.

The parent's separate365-test/public48/build/dry-run success is separate evidence. There is no UI/HTTP change, so no independent browser run or screenshot was added, and unchanged editor164 was deliberately not rerun locally. The CI policy can still run its complete configured checks.

## Source and contract review

Trusted server methods explicitly select login or pending registration. The runtime enum fails closed, and the encrypted cookie audience binds that purpose before one-time attempt consumption. Default login retains its prior audience bytes. Cross-purpose callbacks fail before consumption, allowing the intended callback to proceed once; invalid purpose/configuration cannot create or claim attempts.

The broker reuses the fixed Google token endpoint, stored PKCE verifier, bounded no-follow exchange and actual RS256 Google JWKS/issuer/audience/nonce/verified-email/domain validation. Invalid signatures, nonce/domain failures and provider/storage failures stay generic and cannot create pending accounts. Registration returns only pending-receipt plus the cleared attempt cookie; it does not reach SessionStore.create or return an account ID, email, actor, session cookie or CSRF. The attempt-cookie removal is not a login session.

The atomic pending statement is keyed by Google subject. A new subject receives a random private ID, pending status and epoch0. Existing pending records require the exact stored email and retain ID/email/creation time/epoch. Active/suspended/deleted accounts, changed email, invalid time/input and another subject's ASCII-case-insensitive email collision are rejected. Email is a conservative collision check, never an account-linking or recovery key. Current status is checked by the final SQL; a pending receipt describes that statement's recorded result, not permanent eligibility or immunity from a later authorized status change.

The old login path remains distinct: unknown subjects are not inserted, pending accounts cannot log in, and only an existing active account may receive a session. No enrollment approval or automatic activation was added. Source inspection found no production import/route, no schema/UI change and no new permanent key, secret or permission.

## Independent additional evidence

The developer's12 cases include purpose separation before consumption, default-audience compatibility, invalid runtime enum, same-subject immutable reconfirmation, suspended/deleted/active refusal, signed invalid identity, provider/storage failures, current-status races, raw identity/time bounds and configuration failures.

Independent additions address separate gaps:

- Twelve fresh, independently signed OAuth callbacks for the same previously absent subject run concurrently. All return the exact generic pending receipt, one private pending account is stored and no session is created. This is first insertion, not only reconfirmation of a preexisting pending row.
- Two distinct fresh signed subjects concurrently present ASCII-case variants of the same email. Exactly one pending record and one generic failure result; the stored email remains paired with the winning subject and no session exists. Neither request is linked to the other subject.
- Actual SQLite BEFORE INSERT and BEFORE UPDATE triggers using RAISE(IGNORE) suppress first creation or reconfirmation. Both callbacks fail generically without a false pending receipt. The ignored insert leaves no account; the ignored update preserves the preexisting row. These are actual local D1 trigger effects, not a fabricated success-shaped adapter result.

The existing status-race fixture changes account status immediately before the final statement and confirms refusal; it does not claim a later status can never change after a receipt. Generic response-key and stored-row assertions check secret/private-field omission in their tested outputs. This is not a platform-log secrecy test.

## Regression and production separation

Byte-compared the unchanged Google broker/browser-flow/session test files, production Worker entry, source application entry and Wrangler configuration with source HEAD `5e6ad0e26df140d24eb8d23eae6f662d466a99cb`; all matched. Old test assertions were not weakened.

Independently compared the complete local production asset directory with the existing release515 archive: all three filenames and bytes matched. This used existing local files, without a new build/deployment or remote request. Production still imports no registration broker and retains sample-only read APIs plus closed auth/write fallback. File identity is not a live-auth test.

| Canonical local production asset | SHA-256 |
| --- | --- |
| `MarkdownRenderer-DKi9-iI6.js` | `2a728fd3efc9582ed35259fa257da40ab18e775fac427c4005d4e640384119d5` |
| `index-BDO7j6qF.js` | `82cd7568d3a316425d58f8ebb2c91ec8c1fbbf0b865ab000bcc0caa0a41b4512` |
| `index-TfhgnYfT.css` | `693f21fae8bde088ee95499e2fb2ee5dd9a1aa6891d734e40c171555b5d5ce2d` |

## Documentation and real activation limits

PENDING-REGISTRATION.md, GOOGLE-LOGIN.md and FIRST-RELEASE.md distinguish pending storage from school admission, session issuance and production activation. Google's current Audience guidance exempts requests limited to openid/email/profile equivalents from the Testing trusted-user-list restriction. Testing is therefore not an application enrollment allowlist; Workspace or account restrictions may still prevent authorization. [Google: Manage App Audience](https://support.google.com/cloud/answer/15549945?hl=en).

No live Google request, real callback, browser Cookie-policy trial, actual school account or remote pending write occurred. Dedicated-client ownership, target origin/registered redirect, safe configuration placement, current-enrollment/admission/recovery decisions and actual callback logging/transport protections remain separate inputs/gates. This review does not inspect private external account configuration or claim to discover whether a client exists there. No schema, production activation, role grant, paid contract or new permanent credential was created. Student usefulness and physical-device behavior remain unverified.

## Final source fingerprints

Hashes cover affected modules, actual signature/session boundaries, final fixtures/build entry, new/unchanged tests and production separation.

| File | SHA-256 |
| --- | --- |
| `worker/auth/pending-registration.ts` | `3a767a391c73c4ea435a56822c205410140b48e9c777ede7459908d73bfbf294` |
| `worker/auth/browser-flow.ts` | `8441c45c1e4709e1009981256b61cba1168ef3b71d8739e61007b9b17f5b30d1` |
| `worker/auth/google-login.ts` | `c5e1217a2c78b6069b2d20de0c0c57470671fd8b95715c0419b8a1642859be11` |
| `worker/auth/google-identity.ts` | `9c79b18e228fb34caf02adcc1e11cd2bfd60cdd9537450086f192d1176c922a4` |
| `worker/auth/sessions.ts` | `4faa88bca74b5e6cefd1efbc2792b42faff0d8949aae67573f23a3b6910a411b` |
| `tests/pending-registration.test.ts` | `873681dbc96994e90e8ee018fd14d921ff2a8dc835c91870285af013de4ec268` |
| `tests/pending-registration-independent.test.ts` | `6bf1f93cdb62eafce3f3cda0ab68ba2745c60200f8be7642826a12f345e17a79` |
| `tests/fixtures/pending-registration-worker.ts` | `3b4297632d4a46bd81d321ea409ea69a0acb802a802e1614950e433d601a44a8` |
| `scripts/build-test-fixtures.mjs` | `b5337e15b9423a3a43077d6fa6367d255dfebedb2f8aada7f4171353f94410ea` |
| `tests/google-login.test.ts` | `a92272c0a9a07c03a1d9d469ddafdb4fd7a96ec518e2ee4880ded579dd9139d3` |
| `tests/browser-flow.test.ts` | `0f408bb419d96ed62d899cde07f3e0a3f76014c26beff0ee8cf901d55263b937` |
| `tests/sessions.test.ts` | `771ece54457d693679fa10f0d26033d944c8378a41e0aa77405ca542c4aeb286` |
| `worker/index.ts` | `ced34e0eeb8e5489bfa19657dbf7426ad23771b0ea9854c3d94dd98c68bc16a5` |
| `wrangler.jsonc` | `f003f0183150fd04ff5d7f53c324d2fcd9d42d5dc7821af840525d5e27147445` |
| `src/main.tsx` | `ce4c8523c65ecf3352f2705e3181fe1dbad737d4504fe16fe59ebdf1a7b5ec26` |
