# Independent QA — cycle 01

Date: 2026-11-03. Reviewer: independent QA agent, separate context from the implementer.

## Scope and evidence boundary

Reviewed the initial read-only discovery preview: home → search/tags/type filter → article or project → author/related entry. The catalog contains fictional samples only. Login, authoring, likes, private history, uploads and moderation are explicitly unavailable; this is not acceptance of a student-facing production service.

This initial pass is a source review plus direct execution of catalog functions and TypeScript checks. Browser rendering, keyboard operation, mobile layout, live D1 authorization and deployed HTTP headers have **not** been verified by this reviewer. Implementer browser evidence is separate evidence and must be linked explicitly. No student value testing took place.

## Findings sent to implementer

### Q01 — malformed detail URL can crash the application (medium)

Observed source: `Detail` in `src/main.tsx` calls `decodeURIComponent` without a guard. A malformed path such as `/articles/%E0%A4%A` throws `URIError`; the root has no error boundary. Independently reproduced the decoder exception in Node. Expected: show a missing-page state and keep navigation usable. Browser reproduction is pending.

### Q02 — static help depends on successful catalog API (medium)

Observed source: `App` selects `failed` and `!catalog` before `/about` or a missing route. During a catalog outage, the page explaining the preview and development status cannot be read, even though it has no database dependency. Expected: informational pages remain accessible during API failure. Network-failure browser test is pending.

### Q03 — frontend security headers are not supplied by Hono (medium)

`secureHeaders` applies inside the Worker, while `assets.run_worker_first` only matches `/api/*`. Static HTML and SPA routes bypass this middleware. Therefore the Hono CSP, frame restrictions and referrer policy must not be reported as applying to frontend pages. Expected: static `_headers`, or an equivalent verified delivery configuration. The current Markdown renderer disables raw HTML, disallows non-http(s) links and omits images; no direct stored-XSS exploit was observed in this sample-only scope. Deployed-header validation is pending.

### Q04 — small secondary text has insufficient contrast (medium)

Static CSS color-ratio calculations against white: `.card-content > p` `#74828c` = 3.95:1; `.eyebrow` `#8b9aa6` = 2.89:1; `.card time` `#95a2aa` = 2.62:1. All are normal-size text and below 4.5:1. Desktop body snippets are 11px and metadata is as small as 8px. Expected: readable minimum sizes and darker text. Screenshot/browser confirmation and broader accessibility checks are pending.

### Q05 — long-term capabilities are correctly absent, not accepted (follow-up)

No real authentication, draft persistence, like, history, upload or reporting flow is present. This is a deliberate boundary for this cycle, not a completed implementation of the latest PRD. Before accepting real student content, verify school OAuth server-side, account eligibility, owner/admin authorization, private media, unique-reporter moderation and support contact. The UI states these limitations rather than exposing fake actions.

## Checks actually performed

- `npm run typecheck`: passed on the reviewed working tree.
- `searchCatalog(sampleCatalog, 'Git')`: `git-branches` only.
- `searchCatalog(sampleCatalog, '', 'all', '制作')`: `learning-notes`, `tiny-notes`.
- `searchCatalog(sampleCatalog, '', 'project')`: `tiny-notes` only.
- Search for `サンプルの先輩`: `learning-notes`, `git-branches`.
- Search for a nonexistent term: zero results.
- Related entries for `learning-notes`: `tiny-notes`.
- `decodeURIComponent('%E0%A4%A')`: reproduced `URIError`.
- Source inspection: API selects only `status='published' AND is_sample=1`; explicit content/profile projections omit emails and authentication identity. This source property does not replace a live database test against draft/hidden/real-user fixtures.

## Disposition

Q01–Q04 were reported to the implementer for fixes before publishing this cycle. This report is an initial independent review, not a passing release certificate. Record fixes, exact tested commit and browser evidence in the cycle evidence before closing the cycle. Student usefulness remains an untested hypothesis.

## Source recheck after implementer fixes

The implementer addressed the initial findings during the same cycle. Independent source recheck confirmed:

- Q01: unguarded `decodeURIComponent` was removed; detail lookup compares the literal route with known sample paths. Source finding resolved; browser regression remains to be evidenced.
- Q02: `/about` is selected before catalog loading/error states. Source finding resolved; API-failure browser regression remains to be evidenced.
- Q03: `public/_headers` now supplies CSP, `nosniff`, frame denial, referrer policy, noindex and a restrictive permissions policy to static assets. Configuration finding resolved; verify actual HTTP delivery after build/deployment.
- Q04: tail CSS overrides now use 14px card snippets, 12px metadata, 16px article body and darker secondary text. This addresses the original examples. Two remaining contrast cases were sent back: the more-specific `.eyebrow > span:first-child` keeps its old color, and white text on the blue primary-button hover state remains below 4.5:1 for normal-size text. Tags are at least 32px high rather than the reference's 44px touch goal; track broader target sizing as a follow-up.
- `npm run typecheck` passed again after these fixes.

The initial findings above are retained as review history. Current source status is Q01–Q03 resolved, Q04 partly resolved with two specific remaining contrast cases; deployment/browser validation is separate and still pending from this reviewer.

## Independent desktop browser walkthrough

Performed later in this cycle against `http://127.0.0.1:8787`, using macOS Chrome through the computer-use interface. Screenshots were inspected before interaction and again at the article, profile, related-entry and empty-result states. These captures are in the tool-session transcript; this reviewer did not export standalone screenshot files.

Observed results:

1. Home rendered the sample-only notice, four entries, search, tag links and article/project filters. No user login or write controls were presented as available.
2. Clicked the `learning-notes` article from the list. The article title, author, reading time and the three-part reader context were present; text and layout were readable in the desktop screenshot.
3. Clicked `サンプルの先輩`. The profile identified itself as fictional and showed that author's two articles. Opened the article again from the profile.
4. Scrolled to `つながる記事・作品` and opened `ひとこと制作ノート`. The project page rendered and linked back to the article.
5. Returned to the list, entered `zz-no-match`, submitted search and observed `0件`, an explanatory empty state and `すべて表示する`. Clicking that action cleared the query and restored `4件`.
6. Clicked the `Git` theme: `/search?tag=Git` showed one entry. The labelled clear-filter button restored four entries.
7. After clearing a filter, Tab focused an article link and Return opened that article. This is a narrow keyboard smoke check, not a complete keyboard or screen-reader audit.
8. Entered a malformed-looking article URL through the address bar. Chrome normalized it to `/articles/%25E0%25A4%25A`; the app showed the missing-page view with a home link. This verifies the normalized route only, not an exact raw malformed-byte request.

No blocking functional failure was found in this desktop walkthrough. One accessibility-automation click on a profile card did not navigate on its first attempt; clicking the visibly rendered title succeeded, as did the keyboard activation check. This is recorded as an automation limitation rather than established product failure.

The final source overrides now directly set the label color to `#275f7c`, primary hover to `#076db3` with white text, and tags/navigation/author/back/footer/filter-clear controls to 44px minimum targets. Q04's remaining source findings are resolved. The served preview seen during this walkthrough appeared to use an earlier built CSS hover state; rebuild and verify the final output before release rather than treating the source recheck as visual proof of the new hover color.

### Remaining verification limits

This reviewer did not independently run mobile viewport/device interaction, API outage injection, an exact malformed-byte HTTP request, screen-reader navigation, or live Cloudflare header/database validation. The implementer's reported 10 passing Playwright tests are separate evidence, not independent runs by this reviewer. No real student value trial has been conducted. Cloudflare deployment is reportedly blocked on new D1 creation; this reviewer neither retried nor changed cloud resources.
