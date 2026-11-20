# Independent QA — first publication journey (Cycle21 / #43)

## Earlier backend checkpoint (historical)

Independent source review found no blocker in the reviewed backend contract. This checkpoint does not establish a completed browser journey or production activation.

Executed `node scripts/build-test-fixtures.mjs && npx vitest run tests/publication-http.test.ts tests/publication.test.ts tests/worker.test.ts`: **28 passed, 3 files, 6.48s** (10 HTTP +11 publication +7 public-boundary tests), an earlier pre-NUL-hardening checkpoint. Actual isolated Miniflare/D1 fixtures; no remote operations, real identities or editor port/build used. Shared scripts were released afterward.

Reviewed the single joined owner receipt query and explicit DTO. An owned existing draft without a publication alone yields publication:null; hidden/deleted/invalid linkage, missing/other-owner drafts and final session loss remain unavailable. Original snapshot/sourceVersion survives later private editing. Existing publication retry cannot restore hidden content. Transport tests exercise16KiB/4096chunk/5second bounds, invalidUTF8/metadata, private headers, late-body no mutation and final session revoke/status/epoch checks after initial authentication. Domain tests preserve atomic/concurrent publication and moderation composition. These are local fixtures, not live cache/log/real OAuth claims.

PUBLICATION-JOURNEY.md accurately distinguishes local anonymous preview from actual public rollout. Browser source, confirmation lifecycle, pending/unknown reconciliation, anonymous no-cookie reads and PC/mobile visual evidence remain pending implementation readiness. No new screenshot or screenshot publication has occurred at this checkpoint.

## Backend fingerprints

| File | SHA256 |
| --- | --- |
| `worker/publication.ts` | `dc1a3ec025d275bd0d3dcce0d4cc75bc437691832cd53a973f1579112a593ec6` |
| `worker/publication-http.ts` | `fc38e1989ba69aa0a3f41991d1a48ac3b2aa02f7a1d24538a43a878c691049ee` |
| `tests/publication-http.test.ts` | `ca5ea647869754b0a297113a55a0231de2463ed4b0f93db8e0beffd2a59c52f5` |
| `tests/publication.test.ts` | `1ce5ed1fc6574f21803064d2c3f8608506ec287d6eae6aaed49da9c6f2d44628` |
| `tests/fixtures/publication-http-worker.ts` | `ba1d9d7e3e0801e240c05f18eb415a082d12687744aff70339183dce2dbe2f7b` |
| `tests/worker.test.ts` | `3640e1cea06f45f297f93d856eccf7248a0a5da7f15b06002e7a05445840d26a` |

## Final backend hardening checkpoint

Parent identified a stored-body NUL mismatch between client and server. The owner added pre-publication and shared public-reader SQL body-NUL guards, plus regression coverage that no publication is inserted for a NUL draft and a legacy NUL snapshot remains unavailable. Developer concurrent-test body reading was moved inside each concurrent promise after its own earlier response-body fixture failure; concurrency/assertions were retained.

Independently rebuilt fixtures and reran the same command on final backend source: **29 passed, 3 files, 6.45s** (HTTP11 +publication11 +worker7). This supersedes the earlier28 backend checkpoint. No editor build or port was used. Source review of the current composer/client/parent locks found no blocker: saved-version/title/body/profile/metadata binding clears confirmation; pending typing retains private text while save/navigation are locked; failed receipt reads prevent repeated POST. Browser execution remains pending final UI readiness.

| Final backend file | SHA256 |
| --- | --- |
| `worker/publication.ts` | `9012f0c96771d318d7d8259152fcc872c9996e21071c3cce254878cb0bd87a7a` |
| `worker/publication-http.ts` | `fc38e1989ba69aa0a3f41991d1a48ac3b2aa02f7a1d24538a43a878c691049ee` |
| `tests/publication-http.test.ts` | `f71dfa371fa09c34bbd4244eb51a614f1573b94a4b4103503c1e745a7df04f46` |
| `tests/publication.test.ts` | `1ce5ed1fc6574f21803064d2c3f8608506ec287d6eae6aaed49da9c6f2d44628` |
| `tests/fixtures/publication-http-worker.ts` | `ba1d9d7e3e0801e240c05f18eb415a082d12687744aff70339183dce2dbe2f7b` |
| `tests/worker.test.ts` | `3640e1cea06f45f297f93d856eccf7248a0a5da7f15b06002e7a05445840d26a` |

## Final independent browser result

No outstanding blocker found in the bounded fictional local journey. Explicit final `npm run editor:build` followed by `npx playwright test --config playwright.editor.config.ts --workers=1 --output=/tmp/kobe-publication-journey-independent-final-v2 --reporter=list` completed **40 passed,30.3s**: prior editor/profile26, developer publication12 and independent publication2. Final lab build: `index-D1UHETZ4.js`, `index-CA8-DMSv.css`. This is actual local Workers/D1 plus Chromium desktop and iPhone13 emulation, not physical iPhone/Safari.

An earlier independent40 passed30.1s before the reader-context fidelity correction. Its author viewport coverage is valid, but both anonymous reader contexts defaulted to desktop. Developer's earlier12 likewise did not establish mobile anonymous reading. Final40 supersedes that checkpoint: anonymous contexts inherit author viewport, screen, mobile/touch/scale/UA settings and assert viewport equality. Fresh anonymous context has an empty cookie jar; developer checks no Cookie/CSRF headers and no fixture bootstrap requests. Self-signed localhost TLS was ignored only by test browser context; no global trust setting changed. CertificateUnknown server diagnostics occurred while browser tests passed.

### Verified steps and findings

1. Save a private draft, explicitly prepare a manual public profile, inspect saved version/body and canonical metadata. No title/body/owner/profile supplied by client POST; only confirmed metadata and expectedVersion are sent. Missing profile, dirty text, changed saved version and changed metadata clear/block confirmation. Preparation-only navigation cancellation retains metadata.
2. Explicit first publication exposes original saved snapshot in the local anonymous reader. Literal malicious Markdown does not execute scripts/fetch images. Existing source-safe rendering remains separate from actual media support.
3. Typing during pending publication remains private while create/navigation/save are locked. Later private save does not change original public body. Recorded accepted sourceVersion remains distinct from the current private version.
4. Lost successful acknowledgment requires explicit receipt GET, never automatic POST retry. A competing different record stays read-only and preserves the local proposal. Synthetic unavailable404 is not absence; real owned-draft absence requires renewed confirmation.
5. Added independent case holds manual receipt GET while the user types. Navigation/save remain locked; a synthetic404 preserves latest private buffer and blocks repeat POST. Subsequent real GET confirms the original publication without a second POST; independent cookie-free reader still contains only original saved body. This synthetic browser404 does not claim an actual moderation action. Actual hidden/deleted/report composition is established by domain/HTTP local D1 tests, not a new lab operator helper.

All eight final independent app-only screenshots were actually opened and visually inspected. Desktop/mobile composer warnings, disabled confirmation, retained private text, original receipt and anonymous reader are readable without visible overlap. Reader mobile capture is390 CSS pixels wide, desktop1280. Controls and text wrap within mobile cards. No product fix was required by the final browser run. Parent source review had found the NUL guard and reader-context fidelity issues; both are reflected in final evidence above.

Stale external draft version remains a bounded recovery/discoverability limitation: server refuses a stale saved version; an absence receipt cannot make that version current. Existing list reopen plus explicit discard confirmation can reload current saved state. This path was source-reviewed, not added as an independently executed stale-version browser case. No silent overwrite or wrong-version publication was inferred. No new recovery feature or policy was invented.

### Final local screenshots

Base `/tmp/kobe-publication-journey-independent-final-v2/`; temporary evidence only, may expire. No new PNG was copied into repository evidence, uploaded or published. Previously held screenshots were not retried.

| Relative local PNG | SHA256 |
| --- | --- |
| `editor-publication-indepen-a35de-permits-another-publication-editor-desktop/01-unavailable-retains-private-buffer.png` | `73ada0db021eebc9007197d6e120244e27a02f1df15eef9ec6baa08025384b54` |
| `editor-publication-indepen-a35de-permits-another-publication-editor-desktop/02-original-publication-confirmed.png` | `e21bd77d2093cc964bf2c79a167d2ab8d7d424d77a9b94bb89c48a313bd3aefe` |
| `editor-publication-indepen-a35de-permits-another-publication-editor-desktop/03-private-unsaved-buffer.png` | `e266135d82ee66d5a64bdbf3e68142496233efa686e967324390710532bc2b90` |
| `editor-publication-indepen-a35de-permits-another-publication-editor-desktop/04-cookie-free-original-reader.png` | `e0a217c2954f915cf3a3d5a4581e4964f2e512ea7c308288aa53b60d22f78a9e` |
| `editor-publication-indepen-a35de-permits-another-publication-editor-mobile/01-unavailable-retains-private-buffer.png` | `02ff01b34fc1ece10307f03c6b5c4ab072d558c397d55da65e6c464ba66a98fe` |
| `editor-publication-indepen-a35de-permits-another-publication-editor-mobile/02-original-publication-confirmed.png` | `506e56ee6973268c74ca8e9fd358ebf0bc5974c767904bea36ecbb7364cd8a5b` |
| `editor-publication-indepen-a35de-permits-another-publication-editor-mobile/03-private-unsaved-buffer.png` | `f00950ff8f32a6fea6a606a07dccb81f1aadff8e445534a542d3ecd74dda10ac` |
| `editor-publication-indepen-a35de-permits-another-publication-editor-mobile/04-cookie-free-original-reader.png` | `605669f7caa01dce31a05b9ce971cbb85ec605107d7149c66125a9a4fcdb5b7d` |

### Final source hashes

Working-tree fingerprints, not an invented future commit SHA.

| File | SHA256 |
| --- | --- |
| `worker/publication.ts` | `9012f0c96771d318d7d8259152fcc872c9996e21071c3cce254878cb0bd87a7a` |
| `worker/publication-http.ts` | `fc38e1989ba69aa0a3f41991d1a48ac3b2aa02f7a1d24538a43a878c691049ee` |
| `tests/publication-http.test.ts` | `f71dfa371fa09c34bbd4244eb51a614f1573b94a4b4103503c1e745a7df04f46` |
| `tests/publication.test.ts` | `1ce5ed1fc6574f21803064d2c3f8608506ec287d6eae6aaed49da9c6f2d44628` |
| `tests/worker.test.ts` | `3640e1cea06f45f297f93d856eccf7248a0a5da7f15b06002e7a05445840d26a` |
| `src/editor/PublicationComposer.tsx` | `15e234ff936d5f8854d32f2c4d3dc44d1153e1362274d00a3304539108e8c686` |
| `src/editor/publication-client.ts` | `9380a06bc1708289c4057835bafe788a68fa3e290cff98272cf1b781fdca9899` |
| `src/editor/publication.css` | `bfb87ef395f42c30e6fb97c34f8e09cd52d69e3bb69785af3fc64b5a244e0d11` |
| `src/editor/DraftEditor.tsx` | `4766bb069d62f11124140659a349ba7876ad3592ed493a4ed7b1b7d354c75424` |
| `tests/editor-publication.spec.ts` | `a9ec3aa14de202de9ec0b0d671bba8d576419dc6e62c4107eddbcbb2aafbe039` |
| `tests/editor-publication-independent.spec.ts` | `548c4c2a097273b9ee63cf39492dadf0553fe37c1011a9943e73c2c7dc906539` |
| `tests/fixtures/editor-worker.ts` | `5e783e4304d9ca97f24bdc4755b76c5b2293a51e1c39bf57af2b5b1899d0a37a` |
| `tests/editor/entry.tsx` | `40e117c6f6ec7c2b65a6fc33090dfae620d871605b5e6dec16776a3382e01127` |

Anonymous reader source: `src/editor/PublishedArticleLab.tsx` SHA256 `5d7c0f24f3244b191128c10b8a37d9b53a49f483aebc1ceea26446209c1d60ed`. Parent additionally visually inspected four selected final images; independent review inspected all eight.

### Limits

No production route/assets/catalog, remote schema/SQL/settings, credentials/grants, mail/R2/contracts or live login was changed by QA. Fictional local account bootstrap is not Google identity/admission/current enrollment. Local no-store headers and test browser behavior do not establish real CDN/platform log secrecy, erasure of already received text, graduation/retention or operational moderation/appeal/restore/mail. Publication edit/delete/unpublish, real terms/consent, identity-switch/logout remount and protected media remain gates. Browser capture/automation is not manual CUA, screen-reader/IME/physical-device testing or student value validation. The UI is a local first-publication journey, not public user posting activation. Shared scripts/8788 were released after final run. QA implementation changes were confined to the authorized independent browser test and this report.
