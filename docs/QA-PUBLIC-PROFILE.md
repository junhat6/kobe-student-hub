# Independent QA — explicit first public profile (Cycle20 / #41)

## Result and scope

No outstanding blocker found within the isolated local first-creation contract. This is a fictional-account HTTPS lab, not production onboarding or student value validation. The new backend/HTTP/UI remains unconnected to the production Worker; no new schema, remote operation, real Google login, permission grant, mail, deployment or screenshot publication was performed by this QA.

Reviewed the final source and PUBLIC-PROFILE.md. Manual fields, literal reader preview and explicit public-information confirmation match the selected scope. First creation does not verify enrollment, grant posting eligibility or accept all terms. Later editing/deletion, logout/identity-switch buffer clearing and retention remain explicit gates. The anonymous preview is a local React rendering, not a live anonymous profile endpoint.

## Independent execution

- `node scripts/build-test-fixtures.mjs && npx vitest run tests/public-profile.test.ts tests/publication.test.ts tests/worker.test.ts`: **29 passed, 3 files, 8.81s** (11 profile +11 publication +7 production-boundary tests), actual isolated Miniflare/D1 fixtures.
- First UI checkpoint: `npm run editor:build` then the full editor Playwright suite: **26 passed, 42.8s**. Image inspection found the unknown-state badge misleading; it was corrected before the final run. These pre-fix images are historical, not final evidence.
- Final UI checkpoint: `npm run editor:build && npx playwright test --config playwright.editor.config.ts --workers=1 --output=/tmp/kobe-public-profile-independent-final --reporter=list`: **26 passed, 30.3s**. Existing editor14 + developer profile8 + independent profile4. Build served `index-D6PNguaC.js` and `index-D-AxD8ep.css`.

Desktop Chromium and Chromium iPhone13 viewport emulation used fresh fictional local sessions. Self-signed HTTPS was ignored only by test browser configuration; no OS trust or global TLS setting changed. Server CertificateUnknown diagnostics did not prevent the browser suite passing. Scripts/port were released after completion. Parent full-suite results are separate from these independent executions.

## Reviewed guarantees and exercised journeys

1. Initial GET failure stays unavailable: no blank creation form or POST; badge is 未確認. Explicit successful GET of absence enables blank manual fields.
2. Name/bio preview renders literal text; no Google defaults. Keyboard Space confirms the checkbox, any edit resets it, and POST remains absent before explicit confirmation. Long80-codepoint names wrap without horizontal page overflow in both viewports.
3. Pending creation freezes fields. A committed POST with lost acknowledgment is reconciled by explicit GET without a second mutation. Different stored content stays read-only and cannot silently overwrite the submitted buffer.
4. An uncommitted failure followed by failed GET retains read-only text and 未確認 state. Confirmed absence preserves text but requires new confirmation. Explicit creation then displays the stored read-only profile and 作成済み. No localStorage/sessionStorage content is added.
5. Backend review/test covers real session/CSRF and final SQL guards, strict fields/Unicode/private DTOs, concurrent one-ID creation, same-input replay and different-input refusal. Atomic batch checks include ABORT, IGNORE and epoch/profile mutation rollback. Single-query mapped-ID sentinel distinguishes absent mapping from invalid mapping/auth loss. Programmatic local profile→draft→publication→anonymous DTO is covered; the UI suite does not publish articles.

The earlier single-query race concern, preview initial and unknown-state badge findings are resolved in the final source. GET compatibility with bounded preconfigured manual profiles remains distinct from strict generated-ID/derived-initial POST acknowledgments. No unresolved critical source or visible layout defect was identified in this bounded review.

## Final visual evidence — local only

All ten final app-region PNGs below were actually opened and visually inspected independently after the badge fix. Desktop/mobile text, wrapping, retained failure buffers, confirmation reset, disabled controls and final first-created card were readable without visible overlapping content. These are automated browser captures at CSS pixel scale, not physical device or assistive-technology testing. Parent separately inspected five selected images. No image was copied into repository evidence, uploaded, or published; previous held screenshots were not retried. Paths are local temporary evidence and may expire.

Base: `/tmp/kobe-public-profile-independent-final/`

| Relative local PNG path | SHA256 |
| --- | --- |
| `editor-profile-independent-4e0b4-oard-consent-resets-on-edit-editor-desktop/01-initial-state-unavailable.png` | `73df7b267cae0ffaae1f5949d200845521bd8ee6d6824aec1d9c85df79a76283` |
| `editor-profile-independent-4e0b4-oard-consent-resets-on-edit-editor-desktop/02-confirmation-reset-preview.png` | `aad30a0cbbda1e26cc6a0a794c6ccf192da7598abb190c25345ac822f7cbdcee` |
| `editor-profile-independent-4e0b4-oard-consent-resets-on-edit-editor-mobile/01-initial-state-unavailable.png` | `fcedc437cba179eeafd25867abf031b417e6ae529b72ad2e308ce4c7d5c2e9fe` |
| `editor-profile-independent-4e0b4-oard-consent-resets-on-edit-editor-mobile/02-confirmation-reset-preview.png` | `463206a10574d0a24e2c4084c66e1cc92acab91af4c51d6324d691aceff05e4a` |
| `editor-profile-independent-e3583-ore-explicit-first-creation-editor-desktop/03-uncertain-read-failure-retains-input.png` | `d635f2bd76a500a4bbc21780e77ce058c55361719d4f6cdc50d89b58b098eb77` |
| `editor-profile-independent-e3583-ore-explicit-first-creation-editor-desktop/04-confirmed-absence-needs-new-consent.png` | `faab54358ba24ebfa4b061d736f0bf9f0c92c70afd67175341f4b9be7bd032ad` |
| `editor-profile-independent-e3583-ore-explicit-first-creation-editor-desktop/05-explicit-first-creation-confirmed.png` | `9d4db2a1c9b6415cb29abfc503a57a59a9e14325d02335657bb77be2ca583986` |
| `editor-profile-independent-e3583-ore-explicit-first-creation-editor-mobile/03-uncertain-read-failure-retains-input.png` | `1b1e2bd715a38c752f91ad455bc7aa092ad7ea0becb25b028764a0091f3ab394` |
| `editor-profile-independent-e3583-ore-explicit-first-creation-editor-mobile/04-confirmed-absence-needs-new-consent.png` | `696e0583daabc98001910a5321cbcd3d2ec33feb0102ffd12dcd1161102bd446` |
| `editor-profile-independent-e3583-ore-explicit-first-creation-editor-mobile/05-explicit-first-creation-confirmed.png` | `dd83307e5b2c4fbd11cb7cb7fc2398b4934ce2bc7a2e93e5065ea801a68f5b2c` |

## Final source fingerprints

Hashes bind this report to the reviewed working-tree content; no commit SHA is invented before the parent commits it.

| File | SHA256 |
| --- | --- |
| `worker/public-profile.ts` | `bd41bc1e0d0e604a31d979d379449aba6b40b9442e9724b51ec02089d0bf2a86` |
| `worker/profile-http.ts` | `114bdb6e5793d3e0909bc425c8b46fc21dead7c3ac493dd41ae333690fada193` |
| `tests/public-profile.test.ts` | `94b3a5773331d0a199815e5129695085971a64326500ac22fb92b434b626b924` |
| `tests/fixtures/profile-worker.ts` | `dea5f07adce0c9b9c53ee154eb7d021d450095cc3fcfc4375b2c71567704fa4b` |
| `src/editor/PublicProfileSetup.tsx` | `352671c3ebb86e7e45ca186a47d1999a1ef2ac656d16f9dbaae50d2a52cfaaae` |
| `src/editor/profile-client.ts` | `a1aa4d798164de35102022d884db70ee27feea9d0288cd0ea0f00f48e6d379b2` |
| `src/editor/profile-setup.css` | `4f64420f037a8cccb037d7ff4cb716f0b149e9bf5df038af7140f4356c941af7` |
| `tests/editor-profile.spec.ts` | `09626343482d876b084f9778fb8010d9e3fd631068cd6b00eff35aca0de31946` |
| `tests/editor-profile-independent.spec.ts` | `7c759fd5f4b952837af03ebcfbd845de3710eff378df9d7d7bb84c949edfb570` |
| `tests/fixtures/editor-worker.ts` | `0e93b17aeca45883dffbf71d81cac2dddf393f053ed9ed603dde4ccc598c2f99` |
| `tests/editor/entry.tsx` | `193dfa0d8bfd90d63755a4b9ef39b65e93baa80d618153e05cf66e5d005c579b` |

## Limits and remaining activation gates

Synthetic fixture accounts/cookies are not Google identity verification or current-student admission. Local HTTP privacy/cache headers and D1 behavior do not verify CDN caching, platform logs or real-world consent. Real OAuth/settings, session change/logout remount, graduation/retention, public profile edit/delete, authenticated publication UI, operator/appeal/notification delivery and media policies remain outside this cycle. No remote D1 writes or schema application were performed. Physical devices, Safari, screen readers, Japanese IME and student usefulness/understanding were not validated. Before-unload warning and in-memory buffer retention are best effort, not crash recovery or durable browser storage. This QA changed only its independent test file and this report; implementation fixes were made by their owners.
