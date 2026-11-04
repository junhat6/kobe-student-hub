# Independent QA — author session lifecycle (Cycle23)

## Earlier backend checkpoint (historical)

Independent final execution: `node scripts/build-test-fixtures.mjs && npx vitest run tests/session-http.test.ts tests/sessions.test.ts tests/worker.test.ts` — **28 passed,3files,749ms** (HTTP9 +session12 +production boundary7), isolated actual Miniflare/D1. Shared scripts released; editor build/8788 untouched.

Backend review found no blocker: existing-cookie CSRF-only GET creates no identity; raw empty-body CSRF logout revokes only current token. Other same-account session remains valid. Actual D1 zero-change UPDATE fault cannot falsely ACK/clear cookie; logout now requires success and exactly1 change. Workers zero-framed non-null empty stream is accepted without reading; nonzero/unknown framing/Transfer-Encoding and content type are rejected. Cancellation is not awaited. Private no-store/error projections reveal no actor/profile identifiers.

Current guard source review: raw existing-session proof is nonrecursive and bounded, checked before request, after headers and before body EOF. Invalidation aborts tracked requests and late EOF cannot complete SDK consumption. Temporary SDK buffers are not heap secrecy; server CSRF/ownership remains required and abort cannot undo committed mutation. No global fetch patch or new authority is introduced. Final controller effects, unknown-proof hide/retain, same-scope restore versus changed-scope remount/logout lifecycle and actual browser screenshots remain pending UI freeze/readiness. No production/remote/credential/realGoogle/image-publication operation occurred.

## Backend fingerprints

| File | SHA256 |
| --- | --- |
| `worker/session-http.ts` | `76966c14e78bf5790f2a38e237942e38c2b14ed54d30cfa2afd73c89b752abf6` |
| `worker/auth/sessions.ts` | `3cf11b31fc2f03bdc0189090862665efdee013d22479f730b4fec9f24b6cb6a3` |
| `tests/session-http.test.ts` | `0a27327d9471dad30e3b4a28bc09b469545de05039b3a1b3cb5513551d99f33c` |
| `tests/sessions.test.ts` | `771ece54457d693679fa10f0d26033d944c8378a41e0aa77405ca542c4aeb286` |
| `tests/worker.test.ts` | `d8ffb0c4cc84b396bdb88930e97442f515a5b812f5354abe1d8dbd19c292a7ee` |

## Final backend availability fix and execution

Parent identified that GET session storage failure had been classified401, which would cause the UI to discard a retained buffer. Final typed SessionStore.inspect distinguishes authenticated/signed-out/unavailable while existing authenticate callers retain their fail-closed null contract. GET now returns503 for failed storage/config/clock checks rather than claiming sign-out. The lookup-throw test uses a synthetic DB adapter fault around actual local fixture sessions; it is not an actual Cloudflare outage. The zero-row logout test separately uses an actual local D1 BEFORE UPDATE RAISE(IGNORE) trigger.

Independently rebuilt fixtures and reran `npx vitest run tests/session-http.test.ts tests/sessions.test.ts tests/worker.test.ts`: **29 passed,3files,741ms** (HTTP10 +session12 +public boundary7). This supersedes pre-fix28/749ms above. Source review found no outstanding blocker in typed lookup, strict empty command, private projection or current-token-only revoke contract.

## Final browser execution

Executed `npm run editor:build && npx playwright test --config playwright.editor.config.ts --workers=1 --output=/tmp/kobe-session-lifecycle-independent-final --reporter=list`: **62 passed,58.5s** (prior editor50 +developer session10 +independent session2). Final lab assets `index-L7j_C-dx.js`, `index-CMlR_DXF.css`. No repeated public or full unit suite is counted as independent here. Shared scripts/editor8788 released afterward.

Desktop Chromium and iPhone13 Chromium viewport emulation use local fictional sessions. Self-signed HTTPS is ignored only in browser context settings; no global TLS/OS trust changes. CertificateUnknown server diagnostics occurred while browser tests passed. These are Playwright operations, not manual CUA or physical devices.

### Verified journey and source review

1. Account lab checks an existing cookie without fixture bootstrap or auto-created identity. Signed-out route has no private author UI or logout control.
2. Focus proof pending hides/inerts the existing editor subtree. Same-session success and a synthetic503 followed by same proof retain the exact textarea instance and unsaved buffer. Unknown proof does not claim sign-out.
3. Independent added synthetic503→401 sequence checks hidden/inert same DOM/value retention first, then actual component removal on confirmed invalid classification. A newly seeded different fictional scope requires manual proof and explicit continuation; no old buffer or storage is inherited. Synthetic HTTP classification is distinct from the actual backend fault test described above.
4. A real local draft response emits headers/first bytes before a5-second delayed EOF. Browser observes successful post-header A proof, switches cookie to B before EOF and rejects late A consumption. Old editor unmounts; explicit new-session check/continue is required. This exercises EOF checking beyond merely delaying an entire response.
5. Logout immediately drops private UI while an already committed save ACK is held. Late ACK cannot resurrect it; current token becomes invalid, another same-account session remains valid and committed save is not falsely undone. Unknown logout remains closed and requires manual check plus explicit continuation; both committed and uncommitted synthetic lost results are covered.

Reviewed stable guarded-fetch proxy, controller revision/abort checks and scope-keyed children. Raw proof checks are nonrecursive before request/after headers/before EOF; no global fetch patch. Same-scope recovery preserves SDK instances, changed scope/logout clears children. SESSION-LIFECYCLE.md accurately states network-observation limits. No product change was needed after final freeze.

## Local visual evidence

All eight final PNGs below were actually opened and visually inspected independently. Parent separately inspected desktop02/03 and mobile01/04. Active controls and unknown-state notices wrap/read cleanly in desktop/mobile. Hidden and cleared states visibly omit private text/editor.03/04 captures retain the browser scroll position, so their upper heading is outside the shown state; they support the visible state messages/buttons, not a complete top-of-page layout assertion. No overlap was observed in inspected content. DOM/value assertions establish retained versus discarded memory independently of screenshots.

Images are temporary local-only evidence; no copy into repository evidence, publication/upload or retry of held images occurred. Base `/tmp/kobe-session-lifecycle-independent-final/`.

| Relative local PNG | SHA256 |
| --- | --- |
| `editor-session-independent-a90ed-d-invalid-session-clears-it-editor-desktop/01-active-session-controls.png` | `1088acdafb0cc640d4fbdaa65ad5695a156612dcf1eb027a8d3cda96fd676c8d` |
| `editor-session-independent-a90ed-d-invalid-session-clears-it-editor-desktop/02-unverified-hidden-retained.png` | `8607281804339307e34f032e4088d7d9eb40f8e8f88e23f1e5bc4be06c30c4cb` |
| `editor-session-independent-a90ed-d-invalid-session-clears-it-editor-desktop/03-confirmed-invalid-cleared.png` | `4b2b0c48d15851b66cd2b5f3dc4f63e7e608bef66902adb6ea6e89cadff6159c` |
| `editor-session-independent-a90ed-d-invalid-session-clears-it-editor-desktop/04-explicit-new-scope-continuation.png` | `971a9d70ac8e5f530fb41f427e4fc021d8045372682f3c45fba999f1b1378372` |
| `editor-session-independent-a90ed-d-invalid-session-clears-it-editor-mobile/01-active-session-controls.png` | `8966c375dd37a8817cb9caf6a0f48cdcfa3505f55807aba9c24af00f6f271d91` |
| `editor-session-independent-a90ed-d-invalid-session-clears-it-editor-mobile/02-unverified-hidden-retained.png` | `f57c7cdcad1411a4df6625cc5fc19401dbd3a0a1b5bae21f1646e206760f2422` |
| `editor-session-independent-a90ed-d-invalid-session-clears-it-editor-mobile/03-confirmed-invalid-cleared.png` | `8c12d1f356aac0dfeab12ea190411057a1e9501593817cc70fb4bf224a1405fa` |
| `editor-session-independent-a90ed-d-invalid-session-clears-it-editor-mobile/04-explicit-new-scope-continuation.png` | `2ff1424c398aa99821b5b4be14655a97e4d3775d3037247256b3b443b6c89429` |

## Final source fingerprints

Working-tree hashes; no future commit SHA assumed.

| File | SHA256 |
| --- | --- |
| `worker/session-http.ts` | `843123a342d74109e4bc8b10d76250fab6bafbc3fb15350bba217037f5fcab98` |
| `worker/auth/sessions.ts` | `4faa88bca74b5e6cefd1efbc2792b42faff0d8949aae67573f23a3b6910a411b` |
| `tests/session-http.test.ts` | `716707c3186c3543f7374c77ce7a84b66159dfccc6ecb0e274487ffec95392b8` |
| `tests/sessions.test.ts` | `771ece54457d693679fa10f0d26033d944c8378a41e0aa77405ca542c4aeb286` |
| `tests/worker.test.ts` | `d8ffb0c4cc84b396bdb88930e97442f515a5b812f5354abe1d8dbd19c292a7ee` |
| `src/editor/AccountSessionLab.tsx` | `293c506e790a512ca47da63a095af34cbeda0620f3d664a0d249764146491641` |
| `src/editor/session-client.ts` | `1913862d97f3cf76381a1a777a104058a3fd1e190de5f472babb754b7cc75ffb` |
| `src/editor/session-lab.css` | `772491985eb462b54f98d9cff1bea0ef495c56824ac5e0f7547c6caf85b0018f` |
| `src/editor/DraftEditor.tsx` | `ecdf8091d19b38ab8be9e36f8e0149764f6ea4d0fa1e8c255e9ac92652e7495b` |
| `src/editor/PublicProfileSetup.tsx` | `8b7a735d4c666b523ff6dd297309e22d52936880071ba696b98321db18b5f488` |
| `src/editor/PublicationComposer.tsx` | `49290a0c63bcd7f54b759512e7b6a0e2ae4ebb93022c3aefd1e641a902c862b6` |
| `tests/editor-session.spec.ts` | `d46a4a00886e8e2cf9ccdd7507372590fe1d1a0a94a26f95ae1135a95402a3e1` |
| `tests/editor-session-independent.spec.ts` | `2982dfded08d75542989c1796bd3aacc83210fdb45fdb844453bf57d835d6241` |
| `tests/fixtures/editor-worker.ts` | `47013a4fdc5e44a06f05bff7f08c57f1a1ab54a7d6e68c69908fa43a67ccea75` |
| `tests/editor/entry.tsx` | `8c385dba5554b3f121cc78943061350140d32fd4450240b9319e8f3b27b0dbc6` |

## Limits and activation gates

No production entry/assets/catalog, remote schema/SQL/config, real Google/OAuth identity, credentials/grants, paid contracts/R2/mail or deployment was changed by QA. This is an author-shell local privacy boundary, not an all-route identity controller; standalone report/operator labs remain outside it. Real admission/graduation/provider callback coordination, actual CDN/cache/log/privacy and operating policy still need evidence.

Each proof is a network observation: cookie change after the final proof remains possible. Instant cross-tab detection, atomic cookie observation, secure heap erasure, clipboard/history/file clearing and erasure of already received data are not established. Temporary response bytes may enter SDK buffers before EOF; guard prevents the exercised UI commit, not all memory access. Aborting cannot undo server-committed writes. Before-unload/in-memory retention are not crash recovery. Actual native browser lifecycle/physical Safari/device/IME/assistive technology and student value are unverified. QA edits were limited to its independent test and report.
