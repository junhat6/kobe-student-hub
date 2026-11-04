# Independent QA — image-free standalone projects (Cycle31 / #61)

## Result and scope

No outstanding blocker found in the bounded local standalone-project journey. A project-only author can save/confirm an immutable public snapshot and reach a dedicated anonymous author-project list without creating an article. Article read-time/likes/report semantics are not reused. Reviewed STANDALONE-PROJECTS.md and the updated FIRST-RELEASE project gate: works moderation/media/related-article/revision/withdrawal/retention and actual school activation remain explicit unresolved release conditions, not fabricated policy or delivered service.

Source review covers separate schema/DTOs, server-owned snapshots, final session/owner/version/profile checks, strict receipt absence versus unavailable, safe canonical HTTPS fields and no fetch/embed. Private draft edits or deletion do not silently revise/unpublish the public snapshot. Project URLs including query/fragment are deliberately public and not a semantic secret scrubber. No existing article-author API was broadened to expose orphan profiles.

## Independent execution and provenance

- `node scripts/build-test-fixtures.mjs && npx vitest run tests/projects.test.ts tests/project-client.test.ts tests/public-author-client.test.ts tests/public-discovery-client.test.ts tests/public-likes-client.test.ts`: **31 passed,5files,6.43s** (projects10 +projectclient7 +affected shared anonymous clients14), actual isolated local Workers/D1 fixtures.
- Explicit `npm run editor:build`, then `KOBE_LOCAL_EVIDENCE_DIR=/tmp/kobe-projects-independent-images npx playwright test --config playwright.editor.config.ts tests/editor-projects.spec.ts tests/editor-projects-independent.spec.ts --workers=1 --output=/tmp/kobe-projects-independent-test-output --reporter=list`: **8 passed,29.0s**, developer6 +independent2. Final lab build `index-BDaPAeAB.js`, `index-C_aCDFNe.css`.
- Independent final `npx tsc --noEmit` passed. Scripts/editor8788 released after completion. No broad full-suite rerun is claimed.

Parent's earlier full editor checkpoint had90 pass/10 fail because an existing global status locator matched the newly added project status as well as the article status. Reviewed the two test-only helper edits: scope to #editor-main, retaining the exact article-save acknowledgment assertion. Parent reports affected12 passed27.7s afterward; this result is parent-supplied, not independently rerun. No product behavior fix or weakened acknowledgment assertion was inferred from that selector ambiguity. Developer's earlier label-association issue was fixed before this independent run; final tests use stable explicit labels.

## Verified boundaries and journeys

1. Backend actual D1 tests cover strict four fields/canonical URLs, private ownership, live session/CSRF/final SQL races, concurrent CAS and idempotent publication, rollback/no orphan snapshot, private edits versus immutable public values, receipt absent versus invalid, bounded author20/order and malformed/storage failures. Actual fixture hidden/deleted changes exclude fresh project/author reads and cannot be replay-restored. Private draft deletion retains the published snapshot as documented. These are backend fixture operations, not a new work-report or operator UI/policy.
2. Developer PC/mobile journey saves canonical URLs, explicitly publishes after inspecting saved values/profile, renders literal script/Markdown-like description as plain text with no image/iframe/external fetch and reaches project-only author listing. Later private save leaves public snapshot unchanged. CAS failure preserves local text; explicit comparison/rebase and pending-save typing remain distinct. Synthetic committed lost-create/lost-publish responses require manual owned review with no automatic mutation retry; these are injected network failures, not real platform incidents.
3. Independent setup creates a fresh explicit profile with zero articles, project v1 publication and private v2 description. Raw anonymous public reader DTO contains only six project fields plus explicit public author fields; no draft ID/sourceVersion. Article-author endpoint remains404 for this zero-article profile, while dedicated project-author page succeeds. Query404/non-GET405 and APIResponse absence of Set-Cookie are checked.
4. Independent anonymous browser performs no private/bootstrap calls and full Request.allHeaders confirms Cookie/CSRF absence. Public v1 description remains visible while private v2 text is absent; no cookie is created. Device context settings are inherited explicitly.
5. Independent actual project-draft GET emits headers/first bytes before a5-second delayed EOF using a local-only fixture hook. A successful post-header session proof is observed, then cookie changes to a fresh B within4seconds. A's private project result cannot complete into B UI; old project component and unsaved input disappear, B's server GET of A draft404, and manual proof plus explicit continuation mounts an empty B form/list. The hook is synthetic latency; actual local session/private-store/guard behavior is distinct from real OAuth deployment.

## Final local visual evidence

All eight final screenshots were actually opened and visually inspected independently. Parent separately inspected desktop01/02 and mobile01/03/04. Project-only public reader/list, closed old account scope and empty new-scope form are readable without visible overlap; long mobile titles/profile names wrap. These state/region images do not themselves prove authorization or absent fields; HTTP/DOM assertions supply that evidence.

Images require explicit KOBE_LOCAL_EVIDENCE_DIR under/tmp and produce no PNG by default. No new screenshot upload/publication or held-image retry. Temporary paths may expire. Base `/tmp/kobe-projects-independent-images/`.

| Local PNG | SHA256 |
| --- | --- |
| `editor-desktop/01-public-project-only-snapshot.png` | `21cfb0e6531f12d918fbe6217ae6b39604ab75aa5cdb0784f856a0e3dd9aadde` |
| `editor-desktop/02-author-with-project-no-articles.png` | `502df3b14810ef461e89441ae92f7cc99ea9686060f0b8b863cfb3fd4c5efb7e` |
| `editor-desktop/03-old-private-project-scope-closed.png` | `54ea82b4dc70375c539a74385aff6eaf853044aaf8b2c3f3abd344951d0cf657` |
| `editor-desktop/04-new-scope-empty-project-form.png` | `87bda5cbfaf59f546e858292b362980c4582d2226d51fa1eec71e7daa3f2c336` |
| `editor-mobile/01-public-project-only-snapshot.png` | `6b8125816df161140a1337495419e45f213b660cb99917cf979a6507db58e39d` |
| `editor-mobile/02-author-with-project-no-articles.png` | `953fa24f9deb5b447ad2a5c0519f3c04896fced546c66edf32575d365c540ec1` |
| `editor-mobile/03-old-private-project-scope-closed.png` | `1c920ff270e2060ea1a260ea87a0030487a7a8ec6de84fabcdd4512ba4491740` |
| `editor-mobile/04-new-scope-empty-project-form.png` | `25ed8d28470f182f561d69514a722da3b7b8093376d3675b4f7666ef28804ff6` |

## Final reviewed fingerprints

Working-tree source/test/integration hashes; no future commit SHA assumed.

| File | SHA256 |
| --- | --- |
| `worker/projects.ts` | `0e16ade871d31f15912084d871593a13eb9ef85b20457d6ef200191ef04b10b8` |
| `worker/projects-http.ts` | `51ecc8e67813b74773c9dcab2e136d08f6520c030af7d33fa9079cb0a9e0b39c` |
| `migrations/0009_standalone_projects.sql` | `f140695fcba5ff486e70b7c6c3c4127498c5f427e7c2cd64c78132821172cced` |
| `src/project-input.ts` | `ee97165821cd897657d8719417d85c5084418951a6d0b52dc0a8733a6dd8250e` |
| `src/project-types.ts` | `d72a296ed482743a2fdacc9c68a553425abbcd6557cb1921145391dfb912ee18` |
| `src/editor/ProjectRegistration.tsx` | `8bf073a45b27833e09990112cd232d9b865a8865e063b5089eef524c67957800` |
| `src/editor/ProjectAuthorLab.tsx` | `978a694e8d7533de0916032085cfc53c0c4b00ce6f572cd8f4464c8a76e53b99` |
| `src/editor/PublicProjectLab.tsx` | `6d6be6d17f6b922d4e449d4ea6805218141b7890bbcf1e27e2108374e2c4b76e` |
| `src/editor/project-client.ts` | `c344586e6ab942beb1571e747f689ad522ee54eb039d06678f84734fbfa3f87f` |
| `src/editor/public-project-client.ts` | `6a1d14b7efd8437eee350c4c11bef212d2307f56fe352eafce8a2a355d9e9f3d` |
| `src/editor/project.css` | `7a276f31e98c8f5756a248d7eec4a298cbce126d038004a45b121bab31d11745` |
| `src/editor/AccountSessionLab.tsx` | `21b338e765a21ceed814806435aab79af5d062a461c92ce363569540cb309cba` |
| `src/editor/anonymous-public-read.ts` | `4178f4560aa3a8ec80b1ae4ebe2abc315dbe1d2b0ec6d4f4270f6cbc480dc9b8` |
| `tests/projects.test.ts` | `44faabc48f6b7359bb1b434fd96cd950f9006140b0ced8d0d44602fb83d058ee` |
| `tests/project-client.test.ts` | `38b263135eb50e6135e9dd1e416e10c5314919d7146968b7bd1d9af573157fbe` |
| `tests/editor-projects.spec.ts` | `6a59b4a3033be4c4b95a02fd75a42b8ad04c79c82b332487beb85c5baf3bed30` |
| `tests/editor-projects-independent.spec.ts` | `58dd348bdd2ee26049283e35459ce2b41d6936ac5473c90cd5258b1ccbfe1841` |
| `tests/editor-session.spec.ts` | `1f50d1e7c26c4650c8229a79241f78dc4abaa6d764b66b6c530f39b938f158f5` |
| `tests/editor-session-independent.spec.ts` | `0936efc3de41c4739acf61f07e3d4fd8cdeaa4549b800d8669540a4f1a605bdb` |
| `tests/fixtures/projects-worker.ts` | `60b1deba1d586e1447b0d2201bf939ac65b03c65a686fd262581ce3cb6677ad6` |
| `tests/fixtures/editor-worker.ts` | `8812f6a1c419bf586ba07f9d827f73ebd9ae87fe4eb46e480fd7961f52ac08f6` |
| `tests/editor/entry.tsx` | `18661e76e47e0c3ebe27fe6a7cf751f2a0e474c1ab18c4d2dadb6ce49976b9a4` |
| `scripts/build-test-fixtures.mjs` | `93d437befa8a6a2f0e0ad5898b5b51eaea7ec9e76cc8edaba1fba79a5a12bec1` |
| `scripts/editor-preview.mjs` | `d83519f71a124d2a2cdb11e0467cb700f4a3f69a55ecba07046c16f88826cb02` |

## Release limits

Migration0009/local fixture initialization does not apply remote schema or activate production routes. No production entry/assets/config, remote data, real Google/admission/graduation, credentials/grants, paid contract/R2/mail/deploy or screenshot publication was performed by QA. Actual works moderation/reporting/operating responsibility, media, revision/unpublish/deletion/retention and consent policy remain unfinished. Hidden/deleted browser transitions were not exercised through an operator UI; actual backend fixture coverage is explicitly separate.

Network proof is not instantaneous atomic cookie/cross-tab detection, and abort cannot undo committed writes. Fresh-read exclusion does not erase data already received or prove CDN/cache/log safety. Fictional accounts/AI operation checks do not establish student demand or learning. Chromium desktop/iPhone13 viewport emulation is not physical Safari/device/IME/screen-reader testing. Self-signed HTTPS ignored only by context settings; CertificateUnknown diagnostics occurred while tests passed with no global OS trust change. No private operational facts are included. QA changed only its authorized independent spec and report.
