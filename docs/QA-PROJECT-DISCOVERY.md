# Independent QA: recent project discovery (Cycle36 / #71)

No blocking finding remains in the fictional local project-discovery scope. This supplies an anonymous cross-author entry to existing standalone projects; it is not public editing, a moderation-policy change or validation that students find useful work.

## Independent execution

After the final source freeze and parent complete checks, independently ran these targeted tests using the existing freshly built final Worker fixtures, then explicitly rebuilt the editor and ran both focused browser files:

```sh
npx vitest run tests/projects.test.ts tests/public-works-client.test.ts tests/project-reports.test.ts tests/publication-stops.test.ts
npm run editor:build
KOBE_LOCAL_EVIDENCE_DIR=/tmp/kobe-project-discovery-final-images npx playwright test --config playwright.editor.config.ts tests/editor-project-discovery.spec.ts tests/editor-project-discovery-independent.spec.ts --workers=1 --output=/tmp/kobe-project-discovery-final-output --reporter=list
```

- 30 tests passed in6.76 seconds: projects12, works client3, project reports9, publication stops6. Fixtures were not unnecessarily regenerated during this run.
- Explicit final editor rebuild produced `index-B3RHtRyH.js` and `index-BTAIEj4w.css`.
- 10 browser cases passed in19.8 seconds: developer scenarios6 plus independent scenarios4, across desktop and mobile browser emulation. No physical device was used.
- The parent's separate347 tests/public48/editor154/build/dry-run pass and developer12 browser cases are separate evidence, not additional independent runs.
- Local self-signed HTTPS generated handshake diagnostics while contexts deliberately ignored that local certificate. Cases completed successfully; no OS trust configuration was changed.

## Source/contract review

The previous standalone-project routes required a known project or author ID. This new local `/lab/works` entry is separate from article discovery and does not broaden the old project-author API. The anonymous GET `/__lab/project-discovery` exposes at most20 current published snapshots ordered by stored publication milliseconds descending and ID ascending. Selection checks IDs, then a second bounded read must recover the same valid IDs in the same order. Count/order/decoder failures, malformed selected snapshots, invalid selected public profiles or a visibility race produce unavailable rather than filtering into empty success. Only a successful zero-candidate first read returns cards:empty.

The pair of reads is not an atomic snapshot. The20 limit bounds returned candidates/metadata rather than proving an indexed constant-cost scan, complete history or complete search. The shared full snapshot decoder validates selected data before projecting only project ID/title/300-code-point description preview/publication date and short author ID/name/department/year/initials. No full description, biography, external URL fields, private IDs, source version, report or stop information is exposed. Response size is limited to256KiB.

The client uses unchanged bounded anonymous transport, exact keys, UUID/date/text bounds and duplicate rejection. It preserves server order. Refresh removes stale cards before loading or failure; retry is explicit. Card text is plain React text, with native project/author links and no embedded images/iframes or external fetch. The fixture route checks exact path/query/method and safe response headers; it does not fall through to fictional identity setup.

Actual local D1 tests cover genuine empty versus thrown storage failure, cross-author22 candidates and timestamp ties/top20, strict DTO, draft/private/unlinked exclusions, a selected malformed profile/snapshot and visibility change between reads. Actual owner-stop composition excludes the stopped target while retaining its immutable saved snapshot. Existing project test isolation preserves stop-marker foreign keys; it does not weaken constraints to manufacture a fixture.

## Browser evidence

The independently rerun developer cases cover anonymous feed→project→project-only author navigation, no identity/private/external requests, literal unsafe-looking text and correct mobile contexts, strict raw HTTP DTO/headers/routes, and explicit refresh/retry. Browser empty and503 results are synthetic responses and distinct from the actual D1 genuine-empty test.

The independent UI case opens an actual saved project in the registration screen and explicitly publishes public version1. Its confirmed receipt opens the works feed in a new tab. The original page retains later input; saving private version2 and typing unsaved version3 does not alter the feed preview or anonymous version1 reader. Popup viewport matches the parent project viewport. Request inspection for its first feed request is installed on the browser context before clicking the popup link and waits for actual allHeaders assertions: no Cookie or CSRF request header, even though the parent has a session.

The second independent case creates actual projects under two distinct fictional authors, reads them in a fresh anonymous context, uses the owner's explicit UI stop for one target, then reloads the feed. The target disappears while the other author's project stays discoverable. A fresh anonymous raw GET confirms exact narrow DTO keys, maximum20, no Set-Cookie/Location and an empty cookie jar; the stopped project's fresh reader returns404. Shared local fixture storage may contain previous fictional projects, so assertions target newly created IDs instead of assuming a globally two-item list.

No implementation changes or extra policy actions were introduced during independent execution. PROJECT-DISCOVERY.md accurately distinguishes returned bounds from scan cost, two-read limitations, public versus private text, synthetic failures, actual stops and unvalidated student usefulness.

## Local visual review and follow-up

Independent QA opened all eight final PNGs. The parent separately opened five: desktop01 and mobile01/02/03/04. Two-column desktop and single-column mobile cards are readable, long titles/text wrap without observed overlap, public version1 is distinct from private saved2/unsaved3, and the stopped target is absent after refresh while the other author remains. Unsafe-looking sample markup appears as literal text. Captures cover selected feed/editor regions, not whole-page accessibility or complete content history. Some tall mobile previews were scaled by the image viewer; original retained files are unchanged.

A follow-up UX candidate is visible in editor capture02: the draft-list metadata still says version1 after current saved version2 is acknowledged. Opening the item requests the current server version; this is not a new discovery regression or a blocker for this unit. It is recorded without expanding scope or claiming student harm/value evidence.

Images remain only under `/tmp/kobe-project-discovery-final-images`. The independent test requires explicit KOBE_LOCAL_EVIDENCE_DIR under `/tmp`; default CI writes no new screenshots. No image upload/publication was attempted.

| Local image path | SHA-256 |
| --- | --- |
| `editor-desktop/01-receipt-feed-original-public-version.png` | `13fff94c8850c20365eb635861cb4292305949ed641cc5b884809a19c5abfe29` |
| `editor-desktop/02-private-saved-two-unsaved-three.png` | `8447f3187ef2971d3d6273cf48b8802c6707ea08cb33ec273ac8d43f9a08ced4` |
| `editor-desktop/03-cross-author-works-before-owner-stop.png` | `e9b0a0830f19214a5a05c3431354290eb4110d5688c05625ec1684e29f18a953` |
| `editor-desktop/04-fresh-works-excludes-only-stopped-target.png` | `85a16ccaed5c3da1c7868df602c96e603a993b8c1861c2f57f2d76760601cac1` |
| `editor-mobile/01-receipt-feed-original-public-version.png` | `595471b255954a121ae957e1b6cb24073c6670954d02c344bb01935b86aa9c23` |
| `editor-mobile/02-private-saved-two-unsaved-three.png` | `869a023db1ad9aa79aae8857a75ae10afe9c346e66cf63ac45a7cee6908e6c27` |
| `editor-mobile/03-cross-author-works-before-owner-stop.png` | `9c39260e021f673a297b5df322d8016be0d6aae59095f1e8183b1ba28baa8a13` |
| `editor-mobile/04-fresh-works-excludes-only-stopped-target.png` | `fa9fdc64aae16da37ec58ad010ade6d4bc927487b2d7f3771bd03c6b2fa75afe` |

## Final source fingerprints

| File | SHA-256 |
| --- | --- |
| `worker/projects.ts` | `76f0fe955369d7d7abacce56f93f0671a4f944c71706c2a9214937bc7628e5e8` |
| `src/project-types.ts` | `b835ef0c687a885330b1f833af1429d82228956e27a3f94f417fda0f221acc63` |
| `src/editor/PublicWorksLab.tsx` | `0b8f65a0b2fefb6396c2b183d42432ed8829fc67f6e7e3f72380e6e61eb0ed66` |
| `src/editor/public-works-client.ts` | `b5a0c3cb0517026c10d2b2f8a2b269fa20710e47f7746357867dce0a04a3bd11` |
| `src/editor/PublicProjectCard.tsx` | `d0283f8a26789d0dfca347534caba4035947f6a99c50e5db12115776516e7f06` |
| `src/editor/ProjectAuthorLab.tsx` | `83de60e592e83c52c3150419c40ed696f424fbbc0053b92fb21d21ce570fcdbb` |
| `src/editor/ProjectRegistration.tsx` | `b3c7cfe7794e18156fb70db888bddfb36e19359725aed1fbdd8197ae88ae9cbf` |
| `src/editor/PublicProjectLab.tsx` | `1bb21cad78e2f6fd0a02bc38ec80298c79530111e49c2efb3ade2e36dcf48e92` |
| `src/editor/PublicDiscoveryLab.tsx` | `5148d1796351c77c066b9595a8aa22b91735750c1738ed0a1f2b929dc68bba43` |
| `src/editor/project.css` | `81989c8df86cb8452243242e121cb7989916b2762eaed32d408182137512dfb3` |
| `tests/editor/entry.tsx` | `7318200827ad592343f414d16332af7c602964fc7289348eb4e11a9ac0925506` |
| `tests/fixtures/editor-worker.ts` | `787f0628aaeed400ac2fca160431bface9bfbc5dd25577fe16d0deb8b516b47d` |
| `tests/fixtures/projects-worker.ts` | `9bd0e0802c5be602440587c24a6c95e60fe27e3e6eab95a5be176408e872c399` |
| `tests/projects.test.ts` | `a5d54a521443749ae50101e3bcaa54d2f6b010ce89383800401474e1b2c61e44` |
| `tests/public-works-client.test.ts` | `2235feacaf555950fa48d100adec5543d01af905e3539ba0a12b5a40be3c1272` |
| `tests/editor-project-discovery.spec.ts` | `0833fda0261e69373de3171e995e0b4e1842adc24bb072641798209710a6ca66` |
| `tests/editor-project-discovery-independent.spec.ts` | `477fb37d13eee46a98d8f5b0324b7fb4de6af95727807f67cba33a792cab90dd` |
| `src/editor/anonymous-public-read.ts` | `4178f4560aa3a8ec80b1ae4ebe2abc315dbe1d2b0ec6d4f4270f6cbc480dc9b8` |

## Limits

This uses isolated localhost HTTPS, local D1 and fictional fixture identities. No remote schema/data/configuration, credentials, permissions, billing, real Google/admission/operator action or deployment was performed. Current production sample delivery remains a separate surface. Owner stop does not reclaim already received or cached/third-party copies; project reports do not gain an automatic hide policy. Real logging/cache/media protection, operations/notifications/explanation/appeal/contact/retention, physical-device/Safari/assistive-technology behavior and actual student value remain unverified.
