# Independent QA: author publication stops (Cycle34 / #67)

No blocking finding remains within the fictional local experiment. This is an explicit one-way stop of an original public snapshot, not public editing, deletion, restoration, a reporting decision, or an agreed real service withdrawal policy.

## Final independent execution

Independently rebuilt Worker fixtures and ran the targeted backend/client suites against their unchanged source. After the final UI fix and freeze, explicitly rebuilt the editor and ran both browser files. The commands and checkpoint provenance are recorded separately below:

```sh
node scripts/build-test-fixtures.mjs
npx vitest run tests/publication-stops.test.ts tests/publication-stop-client.test.ts tests/publication.test.ts tests/projects.test.ts tests/project-reports.test.ts tests/sessions.test.ts
npm run editor:build
KOBE_LOCAL_EVIDENCE_DIR=/tmp/kobe-publication-stops-final-images npx playwright test --config playwright.editor.config.ts tests/editor-publication-stops.spec.ts tests/editor-publication-stops-independent.spec.ts --workers=1 --output=/tmp/kobe-publication-stops-final-output --reporter=list
```

- 52 tests passed in 6.83 seconds: stops 6, stop client 4, publication 11, projects 10, project reports 9, sessions 12.
- The explicit editor rebuild produced `index-y8sTJgJ7.js` and `index-2wJmG2_n.css`.
- 10 browser cases passed in 32.2 seconds: developer scenarios 6 and independent scenarios 4 across desktop and mobile emulation. No physical device was used.
- All eight opt-in local images were opened and inspected. No screenshot was uploaded or copied to public repository evidence.

Local self-signed HTTPS generated handshake diagnostics while the test browser contexts intentionally ignored that local certificate. All tests completed successfully; no OS trust changes were made.

## Review and observed behavior

The store binds ownership and the original publication source version to the current live session/account/epoch/time. Strict POST input contains only expectedSourceVersion and confirmStop:true; private GET/POST return200 only with the exact five-field state. HTTP accepts only the exact kind/UUID route, uses private/no-store response headers and bounds commands to16KiB,4096 chunks and a five-second body deadline. No body/title, report reason, private ownership identifier or client role is accepted as authorization.

A unique marker INSERT and its status-changing trigger are one atomic statement. Actual local D1 tests run12 concurrent commands for each kind and confirm a single marker with repeated exact acknowledgments. An ignored hidden update rolls back the marker; ordinary UPDATE and INSERT OR REPLACE republish attempts are rejected. This does not protect against an administrator altering schema, removing markers or using unsupported arbitrary SQL.

An ordinary exact retry selects no published INSERT candidate once the original is hidden, then checks the owned marker and exact version. A report-hidden target with no own marker remains stopped:false, and POST cannot relabel it as an author stop. Actual article report tests retain the two accepted reports and pending outbox count when an author stops before a third report; a third report after hiding is unavailable. No notification was sent or verified.

The independent project scenario publishes source version1, separately saves private version2 and leaves unsaved version3 in the editor. Four distinct fictional reporters actually submit reports; the project remains public before the separate author action. The author confirms stopping public version1. Private version2 and unsaved version3 remain unchanged, fresh project and sole-author project reads return404, and the trusted fictional operator case still contains the original public description and all four reports. The own receipt returns hidden/stopped:true/sourceVersion1. No project report threshold was invented.

The second independent scenario commits a real local stop, then delays its response body EOF by five seconds using the isolated fixture hook. It observes POST headers and a subsequent valid A session proof, changes the browser cookie to B within four seconds, and verifies the old target/acknowledgment cannot populate B. Manual verification and explicit continuation show B's genuinely empty own records. A separate API context carrying the original A cookies reads stopped:true and a fresh reader404, demonstrating that discarding a response does not undo the committed operation. Only the latency is synthetic; the stop, cookie change and receipt are actual local fixture/store operations.

Developer cases independently rerun here cover both article/project stopping, private text preservation, an injected lost successful acknowledgment with selected target preserved through an injected list503, explicit receipt recovery without automatic POST retry, and an independently report-hidden article that never claims an own marker.

The final negative-state fix is included: a matching-version GET showing hidden/deleted with stopped:false refreshes the own list automatically, removes its reader link and published-row stop entry, retains read-only receipt access, and preserves the generic cause distinction. The test now asserts this without a manual list refresh. Hidden/deleted rows also expose a read-only state lookup after opening another same-session page; that lookup confirms an existing own receipt without POST or changing the original page's private buffer. A captured hidden/deleted row cannot initiate POST even if a synthetic fresh GET says published: both captured and fresh published state, matching source version and consent are required. This synthetic contradiction test does not restore any real record.

Fresh project reader/author exclusion is independently exercised in the browser composition; article/project direct hidden reads are exercised in local store tests. Existing feed/likes exclusion predicates were not separately exercised with a new owner stop in this QA run. Already-open pages, previously received content and third-party copies are not reclaimed.

## Provenance and documentation review

The parent's complete342-test/public48/editor132/build/dry-run checkpoint preceded the negative-state list synchronization fix. The developer's subsequent6 cases passed16.7 seconds. An independent10-case run then passed31.2 seconds before the read-only reopen recovery branch. A developer6-case checkpoint passed17.6 seconds before the additional captured-intent gate; the final developer6 cases passed17.9 seconds with that gate. The authoritative final independent explicit rebuild and10-case run passed32.2 seconds. Backend/client52 tests passed6.83 seconds before these UI-only changes and were not repeated because backend/client source stayed unchanged. These overlapping checkpoints are not summed. The final eight images below were regenerated in a separate final directory and all reopened; earlier images are historical and not used as final evidence. No implementation changes were introduced during independent execution.

The project registration copy now points to the separate own-record stop and accurately distinguishes local report intake from unfinished real operational handling. PUBLICATION-STOPS.md keeps the value hypothesis, immutable public target, no-restore/no-erasure warning, generic report-hidden state and real-policy limitations explicit. Source PRD was not changed.

## Local visual evidence

All eight final images below were opened by independent QA. The parent separately opened five final images: desktop01 and mobile01/02/03/04; this does not refer to the earlier pre-recovery images. Both layouts show the selected original source version and explicit one-way warning; mobile text/public references wrap without observed overlap. The editor capture distinguishes saved version2 from unsaved version3. Closed-A and explicitly continued empty-B states are clear. These selected panel captures do not establish whole-page accessibility or screen-reader quality.

Images remain under `/tmp/kobe-publication-stops-final-images`. The test writes them only with explicit KOBE_LOCAL_EVIDENCE_DIR under `/tmp`; default CI produces no new screenshots.

| Local image path | SHA-256 |
| --- | --- |
| `editor-desktop/01-public-v1-explicit-stop-confirmation.png` | `7935ee3264d73c5028566fbfd1e42a855a425f2eba13209bacf268d1f4290d88` |
| `editor-desktop/02-private-saved-v2-unsaved-v3-preserved.png` | `193bf1f3ab867bfc4286db9e4b140c11bda54ab48f4e66f23bde51fd9cdf5b9b` |
| `editor-desktop/03-old-stop-ack-scope-closed.png` | `54ea82b4dc70375c539a74385aff6eaf853044aaf8b2c3f3abd344951d0cf657` |
| `editor-desktop/04-new-author-no-old-stop-record.png` | `c84f374583bc92d93ee9c3d739f8388dc8ac42d3582cbea95c9a9c4407087a69` |
| `editor-mobile/01-public-v1-explicit-stop-confirmation.png` | `5d1ff05df09b0b1476ca49038ddc8454fa0598b09c065d69863654363f1c1ad7` |
| `editor-mobile/02-private-saved-v2-unsaved-v3-preserved.png` | `b2b58bdf888ea3f0eeab537fbdad110fac0a072e5e5b8c805c3150865707f8d1` |
| `editor-mobile/03-old-stop-ack-scope-closed.png` | `1c920ff270e2060ea1a260ea87a0030487a7a8ec6de84fabcdd4512ba4491740` |
| `editor-mobile/04-new-author-no-old-stop-record.png` | `14e72965eb952577a65027c211cbac0033f6da0cfedd956381b14ee076ca0d9b` |

## Final source fingerprints

| File | SHA-256 |
| --- | --- |
| `worker/publication-stops.ts` | `a8028c150cb1775b299fe3f8e8dbaa7d31f7ce03a81788933118624cf8275c95` |
| `worker/publication-stops-http.ts` | `1bae2c4e038ef39a230d5f2b658ed1dff4400c1317ab29fc108a898e27b19912` |
| `migrations/0011_publication_stops.sql` | `635754e166bfb68ed657fb17c5209249a5bc7150abdb5bb9733ac7f0f43b9c23` |
| `src/publication-stop-types.ts` | `200bc371b60ff93104cf3a9f8cb99b769b231862fd6dcadbf643237694c37efb` |
| `src/editor/PublicationStop.tsx` | `068a52ac2ab3d2999702f4683b8acf9c8f5a22cb5c64e56f88887f46e1742336` |
| `src/editor/publication-stop-client.ts` | `ada88962090491296e1958156a6350153af49bd4b59d811ffb15ca664cfcd5ea` |
| `src/editor/publication-stop.css` | `29b888520b82e2fbc9251d26a59f3bb35a6f11a4a05f4e732ef0434be2ce294f` |
| `src/editor/OwnPublications.tsx` | `23abca2abe6902bf85ab93f0d7c9c328bc290cfb12c905f187a1159688831aac` |
| `src/editor/AccountSessionLab.tsx` | `6b92294facab869191be5080ee47df7deab56b248bf6595e2411c8aa4c0f2677` |
| `src/editor/ProjectRegistration.tsx` | `9e12b9e9d498de2bfaa2fc0383fc24df55cee83ac444c90807d213b5cc4112c9` |
| `tests/publication-stops.test.ts` | `6e3148730ebd06325e9874d8d6c89c1ac0687e6abae2f4fea51424e28f72608d` |
| `tests/publication-stop-client.test.ts` | `36002908ba1c2a92ca8b6ecdc9e861d7c4bf0e4e883af2bf0befe6aea2734c64` |
| `tests/editor-publication-stops.spec.ts` | `9343552ad5d08e3ef7d3c505b04f78036330e814fe3074612ba0031b8812b53c` |
| `tests/editor-publication-stops-independent.spec.ts` | `ce4fcd2b7f66981822fdd0b3eec64aa5093f7883f332e31253cb20682cd9aeac` |
| `tests/fixtures/publication-stops-worker.ts` | `cf2505aa20306471a0a87a756ee4dcf68e96e0e09c0015f96b3214c0585ae87d` |
| `tests/fixtures/editor-worker.ts` | `534d5211b1513a67b3081d37c60dc60b7c0164700a3c24e460ca04aaeb2dcd45` |
| `scripts/build-test-fixtures.mjs` | `83b96e2d4a35d124ca0243f7df1010d35757fa12fc70ed1d234feec3350cd431` |
| `scripts/editor-preview.mjs` | `c40b5580d727a82df6574f834fba56decdea1e9436057ac8a93efbc2270dd224` |

## Remaining limits

No remote migration0011, deployment, real account/Google authentication, school admission/graduation decision, credential, role grant, mail operation or contract change was performed. Local fake operators are not real operational authorization. Public editing/republication/restoration/deletion/contact/appeal/retention decisions remain unfinished. No guarantee is made for instantaneous cross-tab detection, every concurrent cookie race, secure memory erasure, CDN/media/log invalidation, physical-device/Safari/assistive-technology behavior or actual student value. Production activation remains a separate gated task.
