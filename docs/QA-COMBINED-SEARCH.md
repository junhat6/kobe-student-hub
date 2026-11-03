# Independent QA — combined article/author search

Date: 2026-11-03. Reviewer: independent QA agent in a separate task/context from implementation. Scope: [Issue #15](https://github.com/junhat6/kobe-student-hub/issues/15), [PR #16](https://github.com/junhat6/kobe-student-hub/pull/16), implementation source `202f4af439eb68963ad83ff3172cbac9395f3a66`. Independent execution began against the same working-tree source before its commit; the source hashes below identify the tested files.

## Source review

No blocking finding.

The search now creates one searchable string per entry using its existing article fields plus **that entry's corresponding author name/department**. Every query term must occur in that same entry/author string. It does not combine unrelated entries or borrow another author's fields to satisfy a term. Both stored searchable text and query use NFKC normalization and Japanese-locale lowercasing.

Kind/tag constraints still apply before matching. Results remain sorted by update date descending on a filtered copy, without mutating the catalog. Missing-author entries can still match their own content. The change does not expand the API/public-data projection or add private identity fields to search.

## Independent execution

After the implementer confirmed its shared build/full-test run was complete, this reviewer ran:

```text
npx vitest run tests/catalog.test.ts
10 passed (63ms)

npx playwright test tests/combined-search.spec.ts --workers=2 --output=test-results-independent-combined --reporter=list
2 passed (2.6s)
```

Sandbox escalation allowed local Chromium/localhost access. The browser cases ran against the final prepared local build. Desktop is Chromium desktop; mobile is Chromium with iPhone 13 settings, not a real iPhone or Safari test. These are this reviewer's independent runs; the implementer's 64-test/22-E2E full run is separate evidence.

### Unit coverage observed

- Article `Git` plus its author `サンプルの先輩` matches `git-branches`, independent of term order.
- Full-width/case/spacing normalization applies to query and stored author fields.
- A different author does not match that article; terms cannot be borrowed from a second entry.
- Kind/tag intersections and update-date ordering are preserved.
- Own-content matching remains available when the profile is absent.
- Existing discovery/related/validation tests in the file also pass.

### Browser form sequence independently executed on both viewports

1. Entered `Git サンプルの先輩` into the actual search input and submitted. Exactly the Git article appeared with the correct author.
2. Changed kind to projects: no articles matched. Changed kind back to articles: the expected result returned.
3. Submitted `Git サンプルの学生`: zero results and the explanatory empty state appeared, rather than borrowing the other student's name.
4. Submitted full-width/case/spacing variant `　ＧｉＴ　サンプルの先輩 `: one result appeared.
5. Reloaded: the result/query persisted through URL state. Opened the article and confirmed its code body; browser Back restored the single-result search.
6. Asserted no horizontal page overflow.

The tests exercise actual form controls and client navigation. They do not establish search quality for a large catalog, every Unicode edge case, real-device accessibility or usefulness to students.

## Retained screenshots and visual inspection

Copied four screenshots from this independent run into the repository and opened **all four at original resolution**:

| Viewport | Matching article + its author | Different-author zero result |
| --- | --- | --- |
| Desktop | [Match](evidence/combined-search/combined-match-desktop.png) | [Empty](evidence/combined-search/different-author-empty-desktop.png) |
| Mobile emulation | [Match](evidence/combined-search/combined-match-mobile.png) | [Empty](evidence/combined-search/different-author-empty-mobile.png) |

The captured matching view shows the entered combined query, one Git article and `サンプルの先輩`. The negative view shows the different-author query, zero count and reset guidance. Text, controls and the mobile card fit their captured viewport; no clipped or overlapping text was visible. Only fictional app content is shown.

Raw output remains in untracked `test-results-independent-combined/`, excluded from intended source commits. The retained files came from this independent run, not implementer screenshots.

```text
SHA-256 of retained images
combined-match-desktop.png        a2d6dece0104cb836d31cd47027668753ce5cdb248ec3d6cfb033146f1bb4359
different-author-empty-desktop.png 01a3898e94e6670fdb7efedfb788f687dc487000051fcf7c8756bc354dd6ba72
combined-match-mobile.png         3c915929150e294eb9cf5ca608a3dae72847dffc31a69d25edb53e7797d95975
different-author-empty-mobile.png  505c95679c0c9e5473e4007f87324c5edc6f7ac566d320fff8385f2f7f754b51
```

## Tested source identity

```text
src/catalog.ts                07bc7ab55297d0328be84c6c536dd09c46837ee7ebc623d6d9b88d9196aad1ef
tests/catalog.test.ts          88dddac6b35e80063e9e1650623c25f1c2bde9cbf03101c7fd6f96404004c3be
tests/combined-search.spec.ts  4bd18ee9b3f000f69df96cef599491e41e50ecc05d54c5d04af60688efb32abc
```

## Disposition

No blocking finding remains for the scoped search fix. This reviewer changed only this report and retained app-only screenshots, not implementation/tests. No public deployment, remote SQL/D1, R2 contract, authentication or permission action was performed. Student value validation and physical-device/Safari checks remain unperformed; passing local behavior does not claim this source is already live.
