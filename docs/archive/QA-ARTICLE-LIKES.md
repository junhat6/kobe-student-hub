# Independent QA — public article likes (Cycle30 / #59)

## Result and scope

No outstanding blocker found in this bounded fictional local journey. This is deliberate public association and withdrawal, not private reading history, popularity/recommendation or production activation. Reviewed ARTICLE-LIKES.md against implementation: profile-field confirmation is distinct from the explicit public-like action; active fixture visibility is a technical prototype, not agreed graduation/eligibility policy. Existing public-author no-eligible semantics remain unchanged.

An early source review identified repeated explicit state-check potentially leaving imperatively concealed DOM hidden despite a nonnull active state. Developer added per-inspection generation keys and layout-time hidden/inert reconciliation. Final browser cases verify repeated checking exposes enabled withdrawal and inert:false. Developer also resolved actual local D1 expression-depth failure through materialized final-validation CTEs; no full bounds were removed. Final source review found full live/session/profile/selected-membership validation retained.

## Independent execution

- Rebuilt test fixtures; `npx vitest run tests/likes.test.ts tests/likes-client.test.ts tests/publication-author.test.ts tests/publication-discovery.test.ts tests/publication.test.ts`: **43 passed,5files,6.79s** (new backend11,private client4,affected author10/discovery7/publication11).
- Public client file was omitted from that first command, then independently executed `npx vitest run tests/public-likes-client.test.ts`: **3 passed,71ms**. Together all7 new client cases are covered; do not count the first43 as containing all7.
- Explicit `npm run editor:build`, then `KOBE_LOCAL_EVIDENCE_DIR=/tmp/kobe-article-likes-independent-images npx playwright test --config playwright.editor.config.ts tests/editor-likes.spec.ts tests/editor-likes-independent.spec.ts --workers=1 --output=/tmp/kobe-article-likes-independent-test-output --reporter=list`: **8 passed,15.9s**, developer6 +independent2. Final lab assets `index-t_oTT9VR.js`, `index-BueDmX8M.css`, matching the frozen owner's build.
- Independent final `npx tsc --noEmit` passed. Shared scripts/editor8788 released after completion. Parent full-suite results are separate and not claimed as independently rerun.

## Verified boundaries and journeys

1. Actual local Miniflare/D1 checks explicit add confirmation, deduplicated order time, current session/Origin/CSRF/final SQL races, own-only removal, ignored-delete rollback/no false ACK, corrupted projection/visibility-race failures, transport limits/deadline, top20 ordering/cap and strict private/public fields. Private own false is deliberately independent of target existence; it is not a public article eligibility proof. Adds still require a valid current confirmed mapping and record-backed published nonsample article.
2. Reusable selection helper accepts at most20 unique UUIDs and validates full public DTOs. Public liked list permits an empty valid registered profile without requiring authored articles. Invalid mapping/storage/mid-read hide is unavailable, not false empty. Short public profile and9-field summaries omit body,bio,private/provider/draft/report identifiers and liked timestamps/counts.
3. Developer browser journeys cover explicit add→anonymous list→withdrawal, no identity bootstrap/private reads on public list, complete Request.allHeaders absence of Cookie/CSRF, lost committed PUT with no automatic retry and focus requiring explicit state check, and held A response rejected after B session switch.
4. Independent case creates a reader with explicit public profile and no authored publications, likes an actual other author's published article and repeats active inspection. Personal shell is visible/non-inert, withdrawal enabled. Anonymous list shows the article with no cookie/private calls.
5. Three fresh fictional reporter accounts send actual HTTP/store/D1 reports, making target hidden. Fresh public liked list has genuine empty visible entries, and fresh public target reader returns404. Already-open reader retains its accepted own action state; a separately injected profile503 does not prevent explicit own-state read and withdrawal. Own private GET afterward confirms liked:false. Re-add remains disabled while profile is unverified.
6. A synthetic503 public-list response is shown as unavailable, not the genuine-empty heading; this injection is distinct from actual hidden exclusion and backend storage-fault tests. No synthetic response is described as an actual platform outage.

## Final local visual evidence

All eight final screenshots were actually opened and visually inspected independently. Parent separately inspected desktop01/02 and mobile03/04. Public disclosure notice, repeated state-check result, anonymous list, actual-hidden empty state and successful withdrawal with unavailable profile are readable in desktop/mobile without visible overlap. Long fictional profile names wrap in mobile. These state/region captures do not themselves prove permission or data absence; actual DTO/network/DOM assertions above do.

Screenshots require explicit KOBE_LOCAL_EVIDENCE_DIR resolving under/tmp, produce no PNG by default and remain local-only. No image upload/publication or held-image retry. Temporary files may expire. Base `/tmp/kobe-article-likes-independent-images/`.

| Local PNG | SHA256 |
| --- | --- |
| `editor-desktop/01-explicit-public-like.png` | `1b754d9cf03325fdfe0dad35f29de6b3de3762c6d4a23b92bf5f60be86f34ae9` |
| `editor-desktop/02-anonymous-liked-article.png` | `44ec6b66fde437e98bda9c1cd8eba898871e41eced2a3efa665308e0016ec039` |
| `editor-desktop/03-hidden-like-list-empty.png` | `5c688997b345a96a61d29ee683062e0f50155030be939ab076afbc88f1bd6611` |
| `editor-desktop/04-hidden-like-withdrawn-profile-unavailable.png` | `c5b29c031982c059943b2f8d6d3b1c80abb0c478e952db738e46f665640dd560` |
| `editor-mobile/01-explicit-public-like.png` | `7dc1627d1563d4659c30a1bd02adff15c82b685f62c4a06f51b24dcd1179dd39` |
| `editor-mobile/02-anonymous-liked-article.png` | `d6865cb6365b53caf142c0547fd9bb312a04fdae14a4cf17df668440fd5e327f` |
| `editor-mobile/03-hidden-like-list-empty.png` | `3e90082702209f02e27663087538703b54ade18d6258330d82d073f242400ed9` |
| `editor-mobile/04-hidden-like-withdrawn-profile-unavailable.png` | `2ef623372447b7f96d0c079357f8bebf1345b470619c40436955c6031e830c77` |

## Final source fingerprints

Working-tree hashes bind final source and independent test; no future commit SHA assumed.

| File | SHA256 |
| --- | --- |
| `worker/likes.ts` | `6de9bf26064d3293129175e9586676488189bbd146058bb5fe0229cee6e2fa1f` |
| `worker/likes-http.ts` | `79b6652256fea7375bd41ad15f19479ecfa46d21a684738a440d6b388f96ff06` |
| `worker/publication.ts` | `48d494d1cc9b56e87599469893959f5aa6eaf45f81099d27552709ac4af43147` |
| `migrations/0008_article_likes.sql` | `e12f0873700b602bae9875b4e98f28b41121858eec6b02ed7c59f5c4d03c0a18` |
| `src/types.ts` | `11ef359b38c6fb989ec58141e275098675597bfe937f20d5669d96ecd42cdaae` |
| `src/editor/LikePanel.tsx` | `18829f4e4182570bc1cc6b2f3a4814e895206eb0eac56861db00f75eb98fe0e7` |
| `src/editor/PublicLikesLab.tsx` | `35219c30c0cd08fde4c8156838df75c9a44fea0b83c4d9c10e1e9c8b04b834ed` |
| `src/editor/likes-client.ts` | `85487221b9d5e3b045c9909f5ea80e35bf03e99fccdca4d7438e45b1640c5b7b` |
| `src/editor/public-likes-client.ts` | `02def000430bd2c6b0d54e4d5d4f05ef47e60ed57203668b371e01064216ca20` |
| `src/editor/likes.css` | `5791777be11372db513984af48242afad84a3021a172173ef52a13f7a9b8400c` |
| `tests/likes.test.ts` | `2b79f3d4f02b1111fdddf2c180bbfd9d4f9078c583ad25bc3205fc1b5c4516d1` |
| `tests/likes-client.test.ts` | `4192c37f5020d645cf73e673419cb534c520814e1771e35cae261d6950fd59c9` |
| `tests/public-likes-client.test.ts` | `c883db44a01250f99ed475d2ea08056b9f673c78909ada13366e8cdd8f927daf` |
| `tests/editor-likes.spec.ts` | `2b651707f498de94d62f551bfd3c5a5c7039495beba1be67c5566e33fa23b543` |
| `tests/editor-likes-independent.spec.ts` | `950fe29c8849bc957b761e9c65d4b3b230349129bc57f46c06e562e247f0ee1f` |
| `tests/fixtures/editor-worker.ts` | `14120c65552910192740dbc49f635302fbe0839b022f2544b6194977bc26aead` |
| `tests/editor/entry.tsx` | `4a47abbf79c3e6c98689177ce3ccc4b964134b5ce592191b4179a77f9a5ab5e4` |

Additional changed integration fingerprints:

| File | SHA256 |
| --- | --- |
| `src/editor/PublicAuthorLab.tsx` | `272750093ec30edbe63d3999284411ac5141f42c928ddf0989f1818ac2b101fc` |
| `src/editor/PublishedArticleLab.tsx` | `7d2dc0681004740a9ea4dc9c9fdac1f8c1360a60cc50dba491801101eaf9b3ca` |
| `scripts/build-test-fixtures.mjs` | `6832915e32643bcc55321f388e528025da281116dff58ee419a8f0a68feecca3` |
| `scripts/editor-preview.mjs` | `e04df311d9544be37e92ae281693b521b269c0cf06cbbed5c4f0e41a27dab664` |
| `tests/fixtures/likes-worker.ts` | `02fbd0e3cbe48586eb045048e961780b1231decd09ba54441aaa30462e29d85f` |

## Limits and release gates

Migration0008 is local/test only; production worker routes/assets remain unconnected. No remote schema/data/config, real Google identity/eligibility/graduation rules, credentials/grants, operating notification/contact/appeal/restore/retention decision, paid contract/R2/mail/deploy or screenshot publication was performed by QA. Existing likes after graduation/deletion and real disclosure/consent policy remain unresolved before actual service use.

Distinct fictional accounts are not distinct eligible humans; likes/clicks are not proof of learning or demand. Public interest expression may be undesirable and needs voluntary student evaluation. New-read hide filters do not erase already received text or prove actual CDN/cache/log behavior. Guard revalidation is bounded network observation, not instantaneous atomic cross-tab identity detection; abort cannot reverse a committed write. Chromium desktop/iPhone13 emulation is not physical Safari/device/IME/assistive technology. Self-signed TLS ignored only by test contexts; CertificateUnknown diagnostics occurred while tests passed, with no global trust change. Private operational work is absent from this public report. QA changed only its authorized independent spec and report.
