# Independent QA — Cycle 02 card study

Reviewer: independent QA agent in a separate task/context from implementation. Date: 2026-11-03. Scope: `feat/card-study`, working-tree changes based on `d76e0f91ba1dc8cb24846c0befc2858a137caa71`. The reviewed implementation was not yet committed; do not mistake the base SHA for a tested final commit.

## Source review

No blocking defect found in the comparison implementation or proposed study plan.

- A and B share the same article-only catalog result and date order; `readerContext` changes only the two prerequisite/outcome fields on the common card component. Project/recommendation content is excluded from this comparison.
- Variant B is URL-addressable, A is the default, and the URL query persists through browser history. Existing home cards retain their default presentation. The comparison entry is on `/about`, not a promoted main-navigation feature.
- No new collection endpoint, analytics call, response form, local storage or write operation was added. The UI explicitly says it does not record/send choices, responses or viewing history.
- The plan describes an unperformed exploratory comparison, allows negative results, and identifies order/memory effects. It does not label the exercise a causal A/B experiment or assert student value.
- The plan does not request names, school email, IDs or grades, and says not to publish raw responses/personal information to public GitHub. Consent/retention details remain to be determined before any real trial.
- Initial minor finding: the study page skipped h2 before card h3 headings. The implementer added an accessible h2 (`記事の候補`); independently rechecked in source and Chrome accessibility output. Resolved before the final tests.

## Independent execution

After the implementer confirmed its build/test run was complete, this reviewer independently ran the requested final mobile/failure-injection subset. The results below are from this reviewer's own execution, not copied from implementer results.

## Acceptance boundary

A Chromium mobile viewport test is not a physical iPhone or Safari test. UI operation is not student value validation. No student trial, live OAuth, real publishing/moderation or Cloudflare D1 provisioning is part of this QA. This reviewer will not retry the blocked D1 operation.

### Final independent test run

```text
npx playwright test --project=mobile tests/card-study.spec.ts tests/discovery.spec.ts --grep 'same samples|study failure|API outage|deep links'

4 passed (1.1s)
```

Executed locally with the required sandbox escalation for Chromium/localhost; no remote operation or provisioning was attempted. The `mobile` Playwright project uses Chromium with iPhone 13 device settings. It is mobile emulation, not a physical iPhone or Safari run.

| Independent test | Result | Evidence covered |
| --- | --- | --- |
| same samples and order, optional context, direct link and back | Pass | A has no extra context; B has three prerequisite/outcome groups; titles/order match; B survives reload and article/back; no horizontal overflow; home keeps original cards |
| study failure recovery does not pretend to record responses | Pass | Injected catalog HTTP 503; error view appears; removing interception and pressing retry restores B; the collection-limit notice is visible |
| API outage has retry and independent about page | Pass | Injected catalog HTTP 503 on home; static about remains available; removing interception permits the home catalog to recover |
| deep links, malformed route, no overflow and honest preview | Pass | Direct article/code view; horizontal-overflow assertion; malformed URL missing-page state; honest unavailable-features page |

The latter general API outage test does not itself press the home retry button: it restores the route and navigates home. The comparison-specific failure test directly exercises retry.

### Independent screenshot inspection

This run generated the following files, shared with the implementer for retention in repository evidence:

```text
test-results/card-study-same-samples-an-33d3a-ontext-direct-link-and-back-mobile/cards-a.png
test-results/card-study-same-samples-an-33d3a-ontext-direct-link-and-back-mobile/cards-b.png
```

This reviewer opened both images after the independent run. A shows the same three article cards without reader context. B visibly adds both labelled fields on all three cards, with no clipped or overlapping text in the captured mobile width. The increased height/scroll burden is visible and remains a student-research question, not evidence that B is better.

### Additional independent Chrome interaction

Used a dedicated macOS Chrome tab for the final local preview. Inspected the screenshot first, opened A, switched to B, and observed the selected-button state and three context groups. Opened the third article (`first-team`) from B, then used the browser Back shortcut; the comparison returned with B selected and all three context groups intact. Screenshots and accessibility output were inspected in the tool session; no standalone exports of these desktop captures were made.

An initial attempt before the final preview server was restarted returned `ERR_CONNECTION_REFUSED`. After the implementer confirmed the final server was running, reload succeeded. This was environment availability before the final run, not counted as an application failure or silently omitted.

### Final reviewed source identity

Working-tree implementation based on the base SHA stated above. Final source SHA-256 at independent execution:

```text
src/main.tsx              572c857f816e74544c29e4a8c38ae1a1f74712e4450ff5bac0b118329870edc8
src/style.css             6e1979a86920f0a58d9ad8621c6750cddb258cfe3fc1207a41f5d48397b1a5fb
tests/card-study.spec.ts  bd226ba06437dafb98ca7f09e8818493a5491a9a7871315cfda20bf5a34e90e3
```

The final privacy wording distinguishes ordinary page-loading requests from comparison-answer collection, selection-event transmission and viewing-history storage. Source and UI both state that the latter are not implemented; it does not claim the page makes no network requests.

## Disposition

No blocking finding remains for this narrow sample-only comparison prototype. The independent final mobile/failure-injection subset passed, with additional desktop manual interaction. This is not approval for real student posting or a claim that either card improves student decisions. Student value validation, real-device/Safari behavior, live Cloudflare delivery and a real participant trial remain unperformed by this reviewer.
