# Independent QA — retired draft trial

2026-11-08. Separate context from the implementers, reviewing the uncommitted retirement based on main `dc0d007af5b0a653f0c68e8dedfeab33511732e9`. The working sources were copied into an isolated temporary directory without Git metadata, runtime configuration, credentials, `.wrangler`, or environment files. Dependencies were shared; builds, ephemeral D1, browser processes and output were isolated. No production, identity, grant, setting, SQL, deployment or GitHub mutation was performed.

## Result

No blocking finding in the bounded source retirement. This result does not prove that live runtime bindings, grants or existing sessions have been removed/revoked; those are separate operational checks. It also does not establish student value, physical-device compatibility, real Google behavior or erasure of backups/logs.

Static review confirmed:

- The production entry no longer imports the limited draft handler or trial asset adapter, reads `OAUTH_DRAFT_TRIAL`, or mounts a trial login/private-draft route. The general OAuth source release gate stays false.
- Retired page and asset paths return 404 with private no-store headers before OAuth or ASSETS access. Both the base and generated production configuration retain worker-first denial for `/trial-assets` and descendants, so stale files and the public SPA fallback do not revive the feature.
- Dedicated trial UI, login client, Vite entries, packaging/preview scripts and positive trial browser tests are removed. CI replaces the removed product flow with the retirement denial suite; unrelated public, authentication and editor suites remain.
- The shared editor/session component changes remove trial-only branches and deletion UI. Their ordinary local publishing/session paths and visibility-generation checks remain. This QA reviewed those differences statically and ran related transport/session tests; it did not rerun the entire shared editor browser suite.
- The old restricted server composition is now a test-only compatibility fixture. Generic auth/private-store guards and applied migration history remain, rather than deleting shared accounts or rewriting all private authorization SQL.
- Late canonical callbacks remove their query parameters through the existing clean redirect, without issuing a session Cookie or restoring the retired trial destination.

## Executed checks

The isolated `npm run build` passed, including TypeScript. Test fixture bundling completed. Independently ran:

```sh
npx vitest run tests/production-retired-trial.test.ts tests/production-config.test.ts tests/oauth-http.test.ts tests/session-http.test.ts tests/sessions.test.ts tests/limited-draft.test.ts tests/draft-client.test.ts
```

All **7 files / 67 tests passed**, 2.08s. An additional QA-only unit case installed a throwing getter for the retired runtime binding and verified that retired routes and closed private paths never read it: **1 file / 1 test passed**, 95ms.

An isolated Playwright configuration reran the eight developer retirement cases and two additional QA cases against the real production entry, local HTTPS, ephemeral public sample D1 and actual ASSETS routing. The fixture deliberately contained a stale trial JavaScript file. **10 cases passed**, 3.4s, with Desktop Chrome and iPhone 13 viewport emulation using Chromium:

- Developer cases cover the removed page, public home → Git article → author, stale static-file/SPA denial, closed private/auth routes with old Cookies and a formerly valid runtime setting, health write gate, and clean late callbacks.
- Independent cases send GET and HEAD for an encoded asset separator, encoded prefix separators, encoded `t`, encoded `-`, and repeated leading slash. All 20 diagnostic responses were 404 with private no-store and no stale sentinel bytes. No product change was needed.

Four local screenshots were individually inspected: retired page and public author on both viewport classes. The retired page contains only the expected not-found response, with no login/editor UI. Public author content remains legible without visible clipping. Screenshots and QA-only diagnostic sources remain local and are not added to the public repository.

The owned Playwright server completed normally, its fixture process was absent and port 8792 had no listener after execution. No unrelated server was stopped.

## Source fingerprints

The following SHA-256 values matched the shared implementation after the isolated execution:

| File | SHA-256 |
| --- | --- |
| `worker/index.ts` | `461c73e8c60cb27b395ea0fa862f11bb27b7773c41c5c6536d7e61efe6e9df6a` |
| `worker/auth/oauth-http.ts` | `d5f05e4de2e1e2605543ea68a4a2782d9e73d4f702edeb3a7fcdffe2a5c3de1c` |
| `wrangler.jsonc` | `0867967b9e4d72c03f731e4e688f3ba5eea2afc51e5d61614f6a25cfe2296053` |
| `scripts/production-config.mjs` | `33f7a34e429be37b74ac997df1bc009afdee4c1565013536359607ee5e2be60c` |
| `scripts/retired-trial-preview.mjs` | `030c1c591e629fa473568585b0843d5c6f08c2449ec01c0254ce0b1a076b3ca7` |
| `src/editor/AccountSessionLab.tsx` | `13813a2febfee34dd55f9e33e44b804e24991fa96f5f7732d127cd5869d355cd` |
| `src/editor/DraftEditor.tsx` | `59da6969bf075963ebf6de005df9885660621787af9ba86a3f63c362848945be` |
| `src/editor/draft-client.ts` | `34b48bc913643c82ed929c997a27cae0b75e1aabe5e911c97338eec219d63737` |
| `src/editor/editor.css` | `b0b5cb092736212818ec0aa17ed0906f32e0da93b5e85cc04b4f26aa2fba51c5` |
| `tests/helpers/legacy-restricted-fixture.ts` | `20f692b328e4f480e56cb7914a55b07da92f255ecb582df71220557f2e683cfc` |
| `tests/fixtures/limited-draft-worker.ts` | `1ac4fe8a28c37014d55000e36afe92d2a4834f5d0fd210ae815d2be8c8967ef5` |
| `tests/fixtures/retired-trial-worker.ts` | `d9e4395bc922d0d315d956a201e254b6dad97bd5a185dd4a8109b2074e494799` |
| `tests/production-retired-trial.test.ts` | `d91868c71e9739535e35052c429d0254f1fbe3ee2bcd873946027517742b2b73` |
| `tests/retired-trial-browser.spec.ts` | `30d9d81c613530f040a8d5cc55e70be607fd576e097654963a597978d60eb263` |
| `playwright.retired-trial.config.ts` | `c334b53b5a974da962d434016c5bb671ae42d42624e8e07a6b32222d496f72a1` |
| `package.json` | `acee961a6c03734d2701ea10924811a609566eb5ef1e42c9938ffd97f2ddf989` |
| `.github/workflows/ci.yml` | `493d649f731228bbeba7e735dd4b8461625e3645970875fa9dbbaabc46eca42f` |

Normal green PR/main CI remains required before release. Production retirement additionally requires the separately verified runtime binding removal and targeted grant/session invalidation, followed by fresh live denial checks. Source-only success is not evidence those operations already happened.
