# Independent QA — reader list context (Cycle29)

## Public sample baseline

Using fresh desktop and iPhone13-emulated Chromium contexts, independently visited `/search?tag=Git`, opened its article, followed the visible author link and then clicked the visible 一覧 link. Both author pages were `/students/sample-a` with list href `/`; both returns reached home `/` with4 article cards, losing the original Git filter. All four screenshots were actually opened and visually inspected independently. This is a read-only public sample navigation defect, not student-value evidence.

Initial script assumed a nonexistent /people author selector and was halted before evidence; corrected script used the observed /students link and completed both viewport paths. No local build/server/source or remote configuration was changed. Images stay local only; no held-image retry/publication occurred.

| Local baseline evidence | SHA256 |
| --- | --- |
| `/tmp/kobe-reader-context-baseline/desktop-author-before-list.png` | `efcd6bf2c73d4df65d23a00cf5d55b0fc9cbaa78d5ef7a61770eead394189917` |
| `/tmp/kobe-reader-context-baseline/desktop-list-after-return.png` | `2aa702da03a5ec0a8e8b6c649e2cb0f3df2fef6803be399cb07b6be92907e6fd` |
| `/tmp/kobe-reader-context-baseline/mobile-author-before-list.png` | `239f383199ab104d89b495ed2400bfa125c216c2db6b9e029ee85edd8de9a52f` |
| `/tmp/kobe-reader-context-baseline/mobile-list-after-return.png` | `27ad258223ec29cf0ca4cd4b6921b6a922064edee643c9a9583b299ac25e4a65` |
| `/tmp/kobe-reader-context-baseline/result.json` | `837369b78263acff56191637213128e984ba5e4fe4be59e90bd7e34c23f83156` |

## Earlier verification plan (historical)

Await DISCOVERY-NEXT.md and frozen context-repair source/tests. Verify explicit author/card/study/nested profile→article→profile context transfer, safe direct/malicious fallback, new-tab/reload/history behavior and origin scroll/focus restoration only where an actual listing snapshot exists. No fake detail-page snapshot may impersonate a listing origin. Actual school auth/student usefulness/physical devices remain outside this repair.

## Final independent source and local regression result

No outstanding blocker in the bounded reader-context repair. Source review confirms one safe profile wrapper around an existing root/search/study leaf; no recursive profile redirect. Actual originating outer list snapshot is carried separately from a real profile-card position snapshot. Detail/related hops inherit evidence rather than inventing article-scroll origins. A direct URL may retain safe filters but does not manufacture position/focus evidence.

Executed `npx vitest run tests/navigation.test.ts`: **5 passed,58ms**. Focused browser command covering existing list-return8, developer profile-return8 and independent2 initially yielded **16 passed +2 failed,12.2s**. The two independent failures were a harness measurement issue: an element screenshot scrolled the profile page after profileY was recorded. Moved screenshot before explicit target.scrollIntoViewIfNeeded→measure→click, retaining the strict less-than4px assertion. Corrected independent2 passed3.2s; no product code changed and the unchanged16 cases were not repeated.

Parent then identified that info.outputPath screenshots would be collected by default CI artifacts. Final test-only helper requires explicit KOBE_LOCAL_EVIDENCE_DIR under/tmp; with no variable it produces no PNG. Final independent command: `KOBE_LOCAL_EVIDENCE_DIR=/tmp/kobe-reader-context-final-local npx playwright test tests/profile-list-return-independent.spec.ts --workers=1 --output=/tmp/kobe-reader-context-env-guard-final --reporter=list`: **2 passed,3.2s**. Independent `npx tsc --noEmit` also passed. Source/test fingerprints below correspond to this final guard; earlier product regression remains unchanged. No broad full-suite repetition was needed. Shared8787/scripts released after execution.

### Exercised behavior

1. Developer focused cases preserve root/search query/tag/kind and studyB through article→author and direct card-author links. Nested profile→other article→author→original list, URL flattening, reload/new tab and native Back/Forward work in both viewports.
2. Existing list cases preserve ordinary article/project/related return behavior and refuse fake article positions. Malicious/direct/oversized/nested profile targets use bounded safe fallbacks.
3. Independent studyA card-author path keeps original study position/focus while a profile→other article→visible back restores the separate actual profile card position/focus. Returning from profile to studyA restores original card and scroll within4px; variantA remains selected.
4. Independent direct article URL with safe wrapped profile/studyA context preserves that leaf but returns to main focus/top0, proving no invented listing position from a URL-only origin.

### Audit document review

DISCOVERY-NEXT.md accurately labels its screens as pre-fix observations and distinguishes reproducible filter loss from untested confusion/dropoff or student priorities. H02/A-B and optional E23 remain hypotheses with existing trial plans; no extra recommendation, expertise or popularity claim is inferred from fictional samples. Its local-newfeed section explicitly was not re-audited there. Accessibility notes retain contrast/keyboard/physical-device/assistive-technology limits. No private operational facts are included. This QA does not claim to have independently viewed every separate audit image; its own baseline/final image coverage is listed here.

## Final local visual evidence

All six corrected images were actually opened and visually inspected independently. Profile/card/studyA layouts are readable in desktop/mobile, with no visible overlap. After the local-only environment guard, all six final images were independently byte-compared and are identical to those already viewed; hashes below bind the final paths/content. These region screenshots do not alone prove focus/scroll; DOM and numeric assertions provide that evidence. Parent visual review, if any, is separate.

Images remain temporary/local-only; no new image upload/publication or held-image retry. Base `/tmp/kobe-reader-context-final-local/`.

| Final local PNG | SHA256 |
| --- | --- |
| `desktop/01-study-origin-profile.png` | `a6096c8a9a813e6ccd328fc15de4053c1bedb84b65498b8851d91f7165e78448` |
| `desktop/02-original-study-card-restored.png` | `8c57aa0b913d57978ff3346b38c7bcfd0ddf4353a3b1fce7dddd345ccfae24bb` |
| `desktop/03-direct-origin-no-fake-position.png` | `83ec38604c82bb8e9a2ffea64e0032087b6f28a2f9e9e73e60accf2bc194c1db` |
| `mobile/01-study-origin-profile.png` | `ee05e1c1d2451624c7b5a20e1eeb925ea5c094c3e5a0fb2d76b1b07be40d984a` |
| `mobile/02-original-study-card-restored.png` | `f68953fdd10ffe145dcc6b6beb0427b74fa41a405973b7eedd06e26fa08f27b2` |
| `mobile/03-direct-origin-no-fake-position.png` | `599d115d880e6a5260efd58a741810e03dee1d589961162eb2f93ca1f5eea2eb` |

## Final reviewed fingerprints

| File | SHA256 |
| --- | --- |
| `src/main.tsx` | `ce4c8523c65ecf3352f2705e3181fe1dbad737d4504fe16fe59ebdf1a7b5ec26` |
| `src/navigation.ts` | `9c4f00dfa7ba36a39e342944f383ee174dc592c14b474d48a4a2a87acf5c5fce` |
| `tests/navigation.test.ts` | `4851a7e5fb45e2ebb8b830baf0662c8f28d89b82b1b27fc9da5de12fb3b21890` |
| `tests/profile-list-return.spec.ts` | `42a39ff2cc25ec1954ab81c843f2a21176676e74fe6f5207c4453688c3ac4e83` |
| `tests/profile-list-return-independent.spec.ts` | `61cc513f1f0603d02f2f8cea9b360ecf3a03bfed6ec8521fe114bc925e75b9a8` |
| `docs/DISCOVERY-NEXT.md` | `520eeb1ed8223bddc08fa7e6da5e04ffe3baa1e7f186b4dbe3fbd2085b409e6d` |

## Limits

Baseline is actual public sample behavior; final repair above was independently tested locally, not yet claimed as a deployed verification. No remote configuration/data/authentication/permissions, real school login, clipboard or student interaction was used. Browser automation is desktop/iPhone13 Chromium emulation, not physical Safari/device/IME/screen-reader testing. Native history/focus is verified only in exercised routes; arbitrary graph state, all gesture combinations and cross-tab position transfer are not promised. Student usefulness/impact remains unvalidated. Private logging work is separate and absent from this public report. QA changed only its authorized independent spec and report.
