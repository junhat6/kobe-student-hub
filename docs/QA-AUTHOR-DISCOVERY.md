# Independent QA — article to author discovery (Cycle25)

## Baseline before implementation

Independently rebuilt unchanged local editor, created a fresh fictional account/manual profile and two actual local private-draft→publication records through existing HTTP APIs. Opened the first article in Chromium: author region contained the explicit name/bio but zero links, all page links were empty, and the other same-author article title was absent. Screenshot was actually opened and visually inspected independently. This proves the missing local reader journey, not student demand.

Initial setup attempt navigated the old `/` fixture bootstrap after capturing another session, causing a CSRF mismatch; it failed before publication. Corrected setup used `/lab/account` to preserve matching cookie/proof, then both publications succeeded. No implementation was changed. Server deliberately stopped with Ctrl-C(exit130); scripts/8788 released before developer writes.

| Local baseline evidence | SHA256 |
| --- | --- |
| `/tmp/kobe-author-discovery-baseline/article-no-author-discovery.png` | `dd693c98f569c91208880236919074ad1299e249ef944a46534526e0cba89dd1` |
| `/tmp/kobe-author-discovery-baseline/result.json` | `0b24ff12a5e27bdd8436f726b329cc6de70186d49e5ed7387ac92525c27b33e7` |

## Earlier verification plan (historical)

Planned review: explicit public author DTO and bounded20newest publication-backed summaries, sameauthor/otherauthor separation, private draft/report identifiers absent, hidden/deleted entries excluded, emptyeligible author unavailable. Final PC/mobile navigation/direct/new-tab/failure state checks wait source freeze and avoid duplicate developer cases. No real Google, remote schema/config, new grants or screenshot publication is authorized by this QA. Images remain local; held originals are not retried.

## Final product checkpoint

Independent `node scripts/build-test-fixtures.mjs && npx vitest run tests/publication-author.test.ts tests/publication.test.ts tests/worker.test.ts`: **28 passed,3files,902ms** (author10 +publication11 +production boundary7), actual isolated Miniflare/D1. Readonly review validates two-stage top20 selection/full projection, strict UUID reader compatibility, count mismatch refusal on between-query hiding, explicit profile/9-field summaries and256KiB serialized cap. Ordering is actual publication milliseconds descending, ID ascending only for ties. Invalid selected records/storage failure fail the lookup rather than yielding a false partial list. Internal body loading is bounded to20 valid-size rows before summary stripping.

Explicit final `npm run editor:build` then `npx playwright test --config playwright.editor.config.ts --workers=1 --output=/tmp/kobe-author-discovery-independent-final --reporter=list`: **80 passed (tool reports1.1m)**, prior72 +developer6 +independent2. Final lab assets `index-BMUMhCFA.js`, `index-Dzb-N3hd.css`. Source remained frozen throughout. Scripts/8788 released after completion.

Actual native article→author→another article/back/source-return/direct route operations pass. No history scaffolding, exact scroll/focus restoration or modified-click behavior is inferred. Independent case opens another tab explicitly using the real article href; it does not claim native modified-click activation.

Independent composition creates two same-author publications plus a private draft and a separate author's publications. Three fresh fictional reporter accounts POST through actual local HTTP/store/D1 to hide one target. Fresh author reload retains only the other same-author article; other author IDs/private draft/report text are absent. Fresh anonymous target article becomes unavailable, remaining article opens from its href, cookie jar stays empty and reader performs no private/bootstrap request. Distinct accounts are not proof of distinct eligible humans.

Developer browser checks also cover strict route/method/projection, escaped public text, no script execution and failure recovery clearing stale visible content. Root found that browser fetch cannot inspect Set-Cookie (forbidden response header); its null value is not raw HTTP evidence. A minimal test-only APIResponse header correction and focused independent rerun are pending; no product change or full-suite repeat is required for that evidence correction.

## Header evidence correction — final test checkpoint

The owner removed the browser-masked Set-Cookie assertion and added an explicitly empty fresh Playwright APIRequestContext. Independently reviewed that test-only change and executed `npx playwright test --config playwright.editor.config.ts tests/editor-author.spec.ts --grep 'anonymous author HTTP contract' --workers=1 --output=/tmp/kobe-author-discovery-http-final --reporter=list`: **2 passed,8.8s**. Actual APIResponse.headers confirms no Set-Cookie/Location and no-store/no-referrer/noindex,nofollow/nosniff. This targeted final test checkpoint supplements the unchanged-product80 run; it does not imply full80 reran after the test-only patch. Existing independent browser cookie-jar observation remains separate evidence. No product rebuild or unrelated test repetition was needed. Shared scripts/8788 released afterward.

## Final visual evidence

No outstanding blocker found. All six final app-only screenshots were actually opened and visually inspected independently. Desktop/mobile show explicit author profile, two→one currently public cards after actual third-report hiding, and fresh anonymous hidden target unavailable. Literal script-like biography renders as text. Cards/context fields wrap within mobile width without visible overlap; screenshots establish only the captured sample content/layout. Final route uses actual390px mobile emulation versus1280px desktop.

Images remain local temporary evidence, may expire, and were not copied into repository evidence/uploaded/published. Previously held originals were not retried. Base `/tmp/kobe-author-discovery-independent-final/`.

| Relative final local PNG | SHA256 |
| --- | --- |
| `editor-author-independent--b135e-m-fresh-anonymous-discovery-editor-desktop/01-author-two-public-articles.png` | `20a890faae6cfc9e960c7218545dab8b64e4dc6b96f9a697c1bcafdd218048f0` |
| `editor-author-independent--b135e-m-fresh-anonymous-discovery-editor-desktop/02-author-hidden-target-excluded.png` | `93b082d9a61df3636619434327e5b1097408c6a0e4afc30850c35938f0abd305` |
| `editor-author-independent--b135e-m-fresh-anonymous-discovery-editor-desktop/03-hidden-target-unavailable.png` | `490017dc9162f083ab22f3299e448619fc5625cb8d9e603ac4425043925714c0` |
| `editor-author-independent--b135e-m-fresh-anonymous-discovery-editor-mobile/01-author-two-public-articles.png` | `402d74e195c9a6efd141e306d53923bcd5d61b4d54a66fde3a4af13fc8897324` |
| `editor-author-independent--b135e-m-fresh-anonymous-discovery-editor-mobile/02-author-hidden-target-excluded.png` | `41e376ed1c62587ab1819ff951e0b0711fab08c55310135185c5462580116cd4` |
| `editor-author-independent--b135e-m-fresh-anonymous-discovery-editor-mobile/03-hidden-target-unavailable.png` | `f42d8a843e11c39a9429e84fe11fa6607f3184c298d45acf33d97dfe27cb4c75` |

## Final source fingerprints

Working-tree content hashes. Developer author spec below is the final header-corrected version, covered by the focused2 checkpoint; product/other test hashes refer to the full80 checkpoint unchanged source.

| File | SHA256 |
| --- | --- |
| `worker/publication.ts` | `61ad3f4a31ddd6d965563cb85b74b6138149d5c4b860e0cc7430379590a5e9b9` |
| `tests/publication-author.test.ts` | `a29dca4fcd7825dd4e0a7d03f2bdef2e0091ca0446e1000cc4a3dfe8e319ad98` |
| `src/types.ts` | `b80c604cedaf3a20fee636c8864d9aa8938068c6fffec339b024e51fe139e23b` |
| `src/editor/PublicAuthorLab.tsx` | `ab833636236da0dcc07c06ee1bca49b4e8728bd2f34cb69c6d9ac37297a80dd6` |
| `src/editor/public-author-client.ts` | `9b03a4e859e59ec56f48bf62eced68c82c576fe600d3a460eb808722e41bedd8` |
| `src/editor/public-author.css` | `1bcb7277ac3cd488b72c55c129cb96f294c6bedcbb836224cb0f0752f67748bc` |
| `src/editor/PublishedArticleLab.tsx` | `d49ed390f05af3db98cb9cefbdc3f5bb9e83a6109a951d166d288db69ff2fbe9` |
| `tests/editor-author.spec.ts` | `d092248b4588e765a5bf5030938ec05f68e1aadf6906286ab4528815b54c13a0` |
| `tests/editor-author-independent.spec.ts` | `cf389f3749483cbd9c098679e9e2809e5f0f280230b6cb588e9eda1f03acb3d6` |
| `tests/fixtures/editor-worker.ts` | `91cfce990331006d10c71b1dec5540d4f828d4d99b2a5fec7ebffb3f19d24792` |
| `tests/editor/entry.tsx` | `6cb1038cacb3d91dbfa2b5b122e097679934c51b4fb774f18d3198d0d3858a08` |
| `tests/worker.test.ts` | `d8ffb0c4cc84b396bdb88930e97442f515a5b812f5354abe1d8dbd19c292a7ee` |

## Scope and limits

AUTHOR-DISCOVERY.md accurately distinguishes actual publication-time order from displayed day precision, bounded summary lookup from full catalog, public self-entered fields from semantic personal-information scrubbing and fresh hidden exclusion from erasure of already received data. Page state keyed to authorID plus abort prevents the exercised stale/error display; arbitrary atomic state revocation is not promised.

All sessions/publications/reports are fictional isolated local Workers/D1. No production entry/assets/catalog, remote schema/data/settings, real Google/admission/graduation, credentials/grants/operator provision, paid contracts/R2/mail/deploy or screenshot publication was performed by QA. Local no-store/raw headers do not establish real CDN/cache/log behavior. Restoration/re-report/retention/explanation/appeal/contact/real notification policies remain gates. Physical devices/Safari/assistive technology/IME, real student usefulness and actual school onboarding were not validated. Browser contexts use self-signed TLS ignore only; recurring CertificateUnknown diagnostics did not prevent successful tests and no OS/global trust changed. QA modified only its authorized independent spec and report.
