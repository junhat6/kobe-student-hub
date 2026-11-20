# Independent QA — reporting to read-only operator review (Cycle22 / #45)

## Independent backend checkpoint

Independent final backend execution: `node scripts/build-test-fixtures.mjs && npx vitest run tests/moderation-http.test.ts tests/moderation.test.ts tests/worker.test.ts` — **30 passed,3files,6.51s** (HTTP11 +store12 +production-boundary7), actual isolated Workers/D1 fixtures. No remote resources, editor build/8788 or real operator credentials were used. Scripts released after run.

Source/doc review found no backend blocker: own accepted hidden report remains received:true, false is limited to published/no-own, and inaccessible/hidden-without-own is unavailable. One final receipt SQL checks live session/status/epoch/time. Operator allowlist defaults empty; browser roles cannot grant access. Bounded private DTOs omit reporter/session/provider identifiers. NUL/invalidUTF16 and legacy report bounds are aligned; case validation fails as a whole rather than hiding individual invalid reasons. Existing actualD1 tests establish atomic third-report hiding/pending outbox behavior, not mail delivery or distinct eligible humans.

MODERATION-JOURNEY.md correctly leaves restoration/re-report/deletion/retention/operator provisioning/contact/appeal/actual notification policy unresolved. Current ReportPanel/ModerationLab source reviewed: report session lookup is explicit, no initial reader auto-login; uncertain outcome blocks resend; read-only operator loads clear stale case data. Final UI execution, screenshot inspection and browser contract remain pending implementation freeze/readiness. No screenshot publication or held-image retry occurred.

## Backend fingerprints

| File | SHA256 |
| --- | --- |
| `worker/moderation.ts` | `0821e74a6d5977d654ca6364d96074045d0c92b1c9b82a214d4edd2582e77901` |
| `worker/moderation-http.ts` | `75e8c44cfdaa65647ae832720a651e4b955ad30e783f6b044034bca632e59363` |
| `tests/moderation-http.test.ts` | `f3692732e4cd7525bee7ba21231204ca3c5ab3b8b79911f1753979952c85c9db` |
| `tests/moderation.test.ts` | `c5939aa58e27a82402ef75a8eb9f1d4853ea5ec35b9bacf5349025166ca4156d` |
| `tests/worker.test.ts` | `2f39a69da7b4b7139b1ac4f1c48c07e16c39afb369875c70b11b0221d9653693` |

## Final browser result

No outstanding blocker found in the bounded local reporting/read-only review journey. Independently executed final `npm run editor:build && npx playwright test --config playwright.editor.config.ts --workers=1 --output=/tmp/kobe-moderation-journey-independent-final --reporter=list`: **50 passed,41.6s** (prior editor/profile/publication40 +developer moderation8 +independent moderation2). Final lab assets `index-B4DAKFDs.js`, `index-CBrm07SQ.css`. Scripts/editor8788 were released afterward. Backend30/6.51s source remained unchanged; no redundant backend rerun was made.

### Actual checked journey

1. Initial anonymous reader performs no private bootstrap or identity operation. Explicit report opening without a session receives an honest login-unavailable state; no cookie/fictional account is created by the UI. Operator navigation likewise cannot create identity/grant authority.
2. Three fresh fictional reporter accounts submit through actual local HTTP/store/D1. Same-account duplicate does not replace reason or add a vote. Fresh anonymous reads remain200 after first/second,404 after third. Hidden response contains no private reasons/detail.
3. Ordinary reporter cannot open operator data. Explicit fixture-only operator session opens read-only queue/case. Reasons are plain escaped text; script/image Markdown does not execute/fetch. No restore/delete/judgment/mail controls exist. A held failing case read clears previous private case immediately, then supports explicit retry.
4. Lost committed report response retains readonly input and disables resubmission. Manual receipt GET confirms accepted status without second POST. Bounds and changed-input confirmation reset, synthetic404 unavailable versus real received:false, and renewed confirmation are exercised.
5. Independent added case composes the missing boundary: first reporter loses its committed ACK, two other actual accounts trigger hiding, then the first reporter manually confirms its own accepted hidden report. POST count remains exactly1. New fresh anonymous context cannot read hidden content; fixture operator still sees three private reasons. This uses actual local third-report hiding, not a synthetic hidden-page response.

Desktop and iPhone13 Chromium viewport emulation used inherited screen/viewport/touch/scale/UA for fresh reader/operator contexts, with viewport equality checks. Fresh hidden-reader cookie jar is empty. This is not physical iPhone/Safari verification. Self-signed localhost certificates were ignored only by test browser settings; no OS/global trust changed. CertificateUnknown server diagnostics occurred while tests passed.

## Final visual evidence — local only

All eight final screenshots were actually opened and visually inspected independently, covering retained uncertain input/disabled send, accepted-hidden receipt, fresh anonymous unavailable page and read-only operator case in both viewports. Parent separately inspected four selected images: operator case desktop/mobile, accepted-hidden receipt mobile and fresh anonymous unavailable desktop. No visible overlap; mobile text wraps within cards and private reasons remain readable. Operator queue scrolls within its bounded list; the case and unresolved-operation notice remain visible in the page. Images contain only fictional local app content. No new image publication/upload or held-image retry occurred. Temporary paths may expire.

Base `/tmp/kobe-moderation-journey-independent-final/`

| Relative local PNG | SHA256 |
| --- | --- |
| `editor-moderation-independ-b6304--ACK-without-another-report-editor-desktop/01-uncertain-private-input.png` | `5f42885fed8b2cc54d5b82dff91590fe13da1264cda0e64891e0311df8f7dcfa` |
| `editor-moderation-independ-b6304--ACK-without-another-report-editor-desktop/02-own-hidden-receipt-confirmed.png` | `5a8affe16d147921f7db521b0f542cf875fef841dc35ac4361f8f1b00c4df041` |
| `editor-moderation-independ-b6304--ACK-without-another-report-editor-desktop/03-new-anonymous-hidden.png` | `490017dc9162f083ab22f3299e448619fc5625cb8d9e603ac4425043925714c0` |
| `editor-moderation-independ-b6304--ACK-without-another-report-editor-desktop/04-readonly-operator-case.png` | `e0b19864094560bcd6bae432997ce00a9582de3b1f2999bc9c9479a2710c90e8` |
| `editor-moderation-independ-b6304--ACK-without-another-report-editor-mobile/01-uncertain-private-input.png` | `696ac7a04831148de7fe3f840078a48e6213431edca7ee714368f95f1a7aa65f` |
| `editor-moderation-independ-b6304--ACK-without-another-report-editor-mobile/02-own-hidden-receipt-confirmed.png` | `32e702185b2c33c36a286a9b2736f5e8cdb4ff6f89c3622308a684b56c7568df` |
| `editor-moderation-independ-b6304--ACK-without-another-report-editor-mobile/03-new-anonymous-hidden.png` | `f42d8a843e11c39a9429e84fe11fa6607f3184c298d45acf33d97dfe27cb4c75` |
| `editor-moderation-independ-b6304--ACK-without-another-report-editor-mobile/04-readonly-operator-case.png` | `a82efafdefc1859fdfb67363a3abc6f07b1741dd831d20583c6f396f5ce2acca` |

## Final source fingerprints

Working-tree hashes bind review/execution, without inventing a future commit SHA.

| File | SHA256 |
| --- | --- |
| `worker/moderation.ts` | `0821e74a6d5977d654ca6364d96074045d0c92b1c9b82a214d4edd2582e77901` |
| `worker/moderation-http.ts` | `75e8c44cfdaa65647ae832720a651e4b955ad30e783f6b044034bca632e59363` |
| `tests/moderation-http.test.ts` | `f3692732e4cd7525bee7ba21231204ca3c5ab3b8b79911f1753979952c85c9db` |
| `tests/moderation.test.ts` | `c5939aa58e27a82402ef75a8eb9f1d4853ea5ec35b9bacf5349025166ca4156d` |
| `tests/worker.test.ts` | `2f39a69da7b4b7139b1ac4f1c48c07e16c39afb369875c70b11b0221d9653693` |
| `src/editor/ReportPanel.tsx` | `a199ec22fa4ed5935fd5c4b117345b617b40ed90c01631bc21cd0e36cb7c0fbe` |
| `src/editor/ModerationLab.tsx` | `63972b64272cf52da397a47a9f3d4704bb8ab43ee0aaaf1f50558435a1c9a16a` |
| `src/editor/moderation-client.ts` | `60a271460b72b062bb2896fb659bbf219cb754c36d5b8dbf82923548fcb9f020` |
| `src/editor/moderation.css` | `939af0fe6b2335d8e1cf3f2ffef473322e78998ef0a3a19a48dbcc55206d632f` |
| `src/editor/PublishedArticleLab.tsx` | `baa03b071e9dbefb7315d639d059a9bf895883d3553ded00e653dac42fb8f3b7` |
| `tests/editor-moderation.spec.ts` | `d491cb7a4f0e0def46c7e928179a7a61d84cf8496f429ee9f4c6554ffee79f5a` |
| `tests/editor-moderation-independent.spec.ts` | `a6b3c4a40ad003122ebe6a65f70c26e704a545bcbe41f829df5444c0ab77fb4b` |
| `tests/fixtures/editor-worker.ts` | `3bec5be5dea1e26b1e897e31e1c9c61508bf48b7bdfac8cd4d397a7e5fe188b5` |
| `tests/editor/entry.tsx` | `89253acad9a891cdcaab6ef8832d605536891ddc3dd8b8e02472c1724df3c8a4` |

## Limits and remaining gates

No production entry/assets/catalog, remote schema/SQL/settings, real Google identity, credentials/grants, paid contracts/R2 or mail was changed by QA. Fictional operator/account helpers are guarded local fixtures, not real provisioning or admission. Three different accounts are not proof of distinct eligible humans. Stored reports/pending outbox and read-only case viewing are not delivered notification, judgment or author explanation. Restore/re-report/delete/retention, graduation/account deletion, real responsible operators/contact/appeal and abuse policy remain unresolved as recorded in MODERATION-JOURNEY.md. No fake contact address or delivery claim was introduced.

Fresh GET rejection does not erase already received article text; old reader tabs may retain it. Actual CDN/cache/media invalidation, platform logs, real-world consent, physical devices/Safari/screen readers/IME and student value were not validated. Before-unload and in-memory input retention are best effort, not durable crash recovery; authenticated identity changes must still clear/remount private state. Browser tests are Playwright automation, not manual CUA. This QA changed only its authorized independent test and report; no implementation change was needed after the final freeze.
