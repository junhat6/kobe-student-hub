# Independent QA — recent public feed (Cycle26)

## Actual baseline before implementation

On unchanged main5c94449 independently rebuilt the fictional local editor and created one fresh account/manual profile/private draft→publication via existing HTTP. Opened its article and followed its author link. Article links contained only the author; author links contained only the source/own article. Combined `/lab/discover` entry links were zero. Both page screenshots were actually opened and visually inspected independently. No guessed unknown route was visited; the old editor fallback was not treated as a feed.

No source was changed. Local server deliberately stopped with Ctrl-C(exit130), scripts/imported writes/8788 released before implementation. This establishes missing navigation, not student value or the absence of all conceivable discovery options.

| Local baseline file | SHA256 |
| --- | --- |
| `/tmp/kobe-recent-feed-baseline/01-article-no-feed-entry.png` | `2b5f90f887fd22fd803e55d9c6bb2129f92128a9beee3853e49c9a0ca4ed2f89` |
| `/tmp/kobe-recent-feed-baseline/02-author-no-feed-entry.png` | `b5a41a1b65433bdab463c3baf244739050027c34217d33174581fe4758cc7e36` |
| `/tmp/kobe-recent-feed-baseline/result.json` | `6e2e3ac6b0709be41a64b7081ce3e3e18b43653b210dde627673491258139098` |

## Earlier verification plan (historical)

Review bounded recent publication-backed card projection (max20, short public author, no body/bio/private linkage), genuine empty versus unavailable and shared author-query behavior. Final independent case should verify freshly published target discovery→read→author and actual third-report exclusion while another target remains. Existing lab database contains earlier publications; no global-count2 assumption is valid. UI empty injection must be labeled synthetic separately from actual empty backend fixture. All images local-only; no held-image retry, remote settings/schema, real identity/grant or public deployment.

## Independent final product checks

No outstanding blocker in the bounded local recent-feed journey. Final `node scripts/build-test-fixtures.mjs && npx vitest run tests/publication-discovery.test.ts tests/publication-author.test.ts tests/publication.test.ts tests/worker.test.ts`: **35 passed,4files,1.03s** (discovery7 +author10 +publication11 +production boundary7), actual isolated Workers/D1. Shared bounded-publication refactor preserves author-noeligible unavailable versus genuinely empty global cards[]. Top20 candidate bounds/UUID validation, same-ID recheck/count mismatch, publication-time order and explicit summary/short-author stripping remain coherent. No hypothetical invalid binding-result proposal is counted as runtime or release evidence.

Then explicitly `npm run editor:build` and `npx playwright test --config playwright.editor.config.ts --workers=1 --output=/tmp/kobe-recent-feed-independent-final --reporter=list`: **86 passed (tool reports1.2m)**, prior80 +developer4 +independent2. Final lab assets `index-DeRgKP-A.js`, `index-esFWBX1O.css`. No product change followed this complete regression run.

### Exercised journey

1. Independent case uses actual existing-session account lab and local API to precreate explicit public profile/saved target/another publication. The actual PublicationComposer form then accepts explicit confirmation and publishes the target; this is not merely an API-seeded receipt assertion.
2. After publication, user types a new private unsaved body and clicks the actual targetblank receipt→recent-feed link. Popup shows the new target and parent textarea retains the exact private buffer. Card→article→author works through native links. No unbounded count2 assumption is made against the accumulated lab data.
3. Three fresh fictional accounts submit reports through actual local HTTP/store/D1. A fresh anonymous feed excludes the target, keeps the other publication, and target article GET is404. Private draft/body/bio/report linkage is not in feed DTO. New anonymous viewport inherits desktop/mobile settings, has no cookies, and retained-card screen is checked.
4. Raw empty APIRequestContext confirms no Set-Cookie/Location and no-store/no-referrer/noindex,nofollow/nosniff. Query is404 and non-GET405. These are APIResponse.headers observations, not browser-masked Set-Cookie results.
5. Developer UI cases exercise unknown-URL feed→article→author→feed/back and synthetic empty versus503 with explicit recovery. Actual backend empty[] is separately established by the isolated empty D1 fixture; browser empty state is injected, not a claim that this populated persistent lab has no articles.

## Complete request-header evidence correction

During review of installed playwright-core types, Request.headers() was found to omit security/cookie headers. Its undefined cookie value was not proof of credential omission. Product source remained unchanged; three test cases were strengthened to await Request.allHeaders(), assert only boolean key presence (avoiding token values), and await queued checks. The independent receipt case additionally proves its context contains an actual fictional session cookie before popup API reads omit it.

Final targeted tests were run without another product build/full86 repeat:

- Author native journey +independent receipt flow, two viewports: **4 passed,12.7s**, `/tmp/kobe-recent-feed-header-proof-final`. Initial grep used an incorrect discovery title and selected4 rather than6; no omitted case was silently counted.
- Remaining corrected discovery journey, `--grep 'unknown-URL readers'`: **2 passed,9.8s**, `/tmp/kobe-recent-feed-header-proof-discovery`.

Together these6 final test-only strengthening checks establish actual complete outgoing request-header absence. The full86 product checkpoint and targeted4+2 final test lineage are distinct. No full-suite repeat or product change occurred. Scripts/8788 released after completion.

## Local visual evidence

All six selected final screenshots from the full86 product checkpoint were actually opened and visually inspected independently. Receipt clearly distinguishes saved public version from unsaved private text and exposes the feed link. New target and surviving other card are readable in desktop/mobile, with native article/author links and no visible overlap. These are state/region captures, not full feed-catalog/layout proof. Target removal is established by DOM/API assertions, not an image of one surviving card alone. Final screenshots remain unchanged after test-only header strengthening; later temporary focused outputs are not substituted into this table.

Temporary local-only evidence, may expire. No PNG copied into repository evidence, uploaded/published or previously held screenshot retried. Base `/tmp/kobe-recent-feed-independent-final/`.

| Relative final local PNG | SHA256 |
| --- | --- |
| `editor-discovery-independe-14e84-s-and-hides-reported-target-editor-desktop/01-published-receipt-feed-entry.png` | `93d77bb247215a8441c5d77c98b2daab7dc39e60deb0c8225aa475a5326c69a7` |
| `editor-discovery-independe-14e84-s-and-hides-reported-target-editor-desktop/02-new-publication-feed-card.png` | `3a0073ef2fd67e28fada1b3806d77fc29f44f5724b0badcbb1f101aa819c5981` |
| `editor-discovery-independe-14e84-s-and-hides-reported-target-editor-desktop/03-other-publication-remains.png` | `8a4a2f15b6ed85773899ebaacf1809c6dc73a211d3e5e1ab2854049de3c87dd9` |
| `editor-discovery-independe-14e84-s-and-hides-reported-target-editor-mobile/01-published-receipt-feed-entry.png` | `a1db590b32170ca2119722f7e80cda0f03f67e47ec1662f0644d75725a6f27c5` |
| `editor-discovery-independe-14e84-s-and-hides-reported-target-editor-mobile/02-new-publication-feed-card.png` | `10646aa81a2b0981676ad89972a8b9dcff2cebb8452fa7f7b1f86b14468e28d9` |
| `editor-discovery-independe-14e84-s-and-hides-reported-target-editor-mobile/03-other-publication-remains.png` | `ec6d80518b0864f3a4ff6f5c9db70fa4a74a99b6c7a8139e305276148f7368d8` |

## Final source fingerprints

Working-tree hashes. Three strengthened browser specs are final4+2 checkpoint versions; product source remains full86 version.

| File | SHA256 |
| --- | --- |
| `worker/publication.ts` | `f40f5ef363a0656a88eefd102fe4fa73703debf43d1bbdc665a1825954070774` |
| `tests/publication-discovery.test.ts` | `943e82effdb1de30f3fb2eee21720be01b0037ec8f83b47d79eeaae909d646d7` |
| `tests/publication-author.test.ts` | `a29dca4fcd7825dd4e0a7d03f2bdef2e0091ca0446e1000cc4a3dfe8e319ad98` |
| `src/types.ts` | `72e0e79128203200bd52d7ccfef5e0cd113ba6f8a54926fd1fa2b0dcc6845f62` |
| `src/editor/PublicDiscoveryLab.tsx` | `60c9969839d7755a62a8f6c7277ed0b989347df69b7ab03300966ae3874739db` |
| `src/editor/PublicArticleCard.tsx` | `1e7195c0ae09a424865535247d54bf51bc628956722f9706d887762f87adbed1` |
| `src/editor/public-discovery-client.ts` | `0d8a6bcc53e29b8891929205c47569b64d126fe691aadf72130aeb5c3e1ffd4d` |
| `src/editor/anonymous-public-read.ts` | `5e9b77f50fd48f13785ba4b3dfb735360b2b05a638f5a7b7088b0359790f0769` |
| `src/editor/PublicAuthorLab.tsx` | `8c846c5b0796644b8a418d53a5754d612e119c607667c17caa9a97ab5fbfae90` |
| `src/editor/public-author-client.ts` | `250a489d21a0e9855cd0f6b23470516975cc2589d76482a484e234adcd0f63dc` |
| `src/editor/PublicationComposer.tsx` | `e5245d83888379dd0dbb26b25ce4b4e80832601864acdeaa93f55bc2cb6d040f` |
| `src/editor/PublishedArticleLab.tsx` | `02c0ad9d9fe132c47bc858471ca6aa377e53c7857a9fbf2bf51404854ed8d35e` |
| `tests/editor-discovery.spec.ts` | `aaea0e9dc3afc408d96fb441f52317c0e1172b9dc8c7d2d9d334897a94c3ba54` |
| `tests/editor-author.spec.ts` | `f81d23b777710814f1d14970e990efef4f60a6299b94dfcd6301478602311754` |
| `tests/editor-discovery-independent.spec.ts` | `d9ae2cf4bd43f669025164230f903cc9e1230506238b4860b84bd05c73c591b2` |
| `tests/fixtures/editor-worker.ts` | `80fd227622abb396e1a04a5ebeadc57f5a52b0921bc173ccd2f7f61c309aa962` |
| `tests/editor/entry.tsx` | `15feab422b4ca6377e032e3c4f27425954197b807a09233d1a618a4432c66106` |

## Limits

No production entry/assets/catalog/config, remote data/schema, real Google/admission/session settings, credentials/grants/operator provisioning, paid contracts/R2/mail/deploy or screenshot publication changed by QA. Recent20 is not search/recommendation/pagination or all authors' complete archive. Distinct fictional accounts do not establish distinct eligible humans. New-read hidden exclusion does not erase already received data or prove real CDN/cache/log behavior.

Real operating notification/explanation/appeal/contact, restore/re-report/retention, protected media and school lifecycle remain release gates. Desktop/iPhone13 Chromium emulation is not physical Safari/device/IME/assistive technology or student value validation. Self-signed TLS ignored only by browser/API context; CertificateUnknown server diagnostics occurred while tests passed, with no global OS trust modification. QA changed only its authorized independent spec and report.
