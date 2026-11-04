# Cycle 01 evidence

Recorded 2026-11-03. Scope: fictional sample-only discovery preview. No real student accounts, identities, teaching materials, drafts or uploads were published. PRD remains unchanged.

## Checks actually run on Mac

| Check | Result | Meaning |
| --- | --- | --- |
| TypeScript + Vite production build | Pass | Static frontend and Worker types compile |
| Wrangler types (binding-only) | Pass | DB/ASSETS generated from config |
| Unit / real local Worker + D1 tests | 8 passed | Search/related/validation, private-status exclusion, non-sample exclusion, write rejection, safe storage-failure response |
| Chromium desktop/mobile E2E | 14 passed | Complete discovery navigation, query/tag/reset/back, malformed URL, no horizontal page overflow, API outage, about page, Markdown active HTML/script-link rejection, API/static headers, screenshots |
| Local D1 migrations | Pass | Fresh schema and fictional samples; repeated migration command reports none pending |
| Wrangler deploy dry-run | Pass | Bundle and bindings validate, no remote deployment |
| npm audit during dependency install | 0 reported vulnerabilities | Registry advisory snapshot, not a security guarantee |
| Independent source + Chrome walkthrough | Completed, findings fixed | [Separate QA report](QA-INDEPENDENT.md) |
| Secret / public-source review | Completed | No token, credential, student identifier or private source document is committed |

The independent reviewer found malformed URL handling, API-dependent static help, missing static header delivery and low-contrast text. All were fixed. The final rebuilt output passed the listed E2E including the exact malformed route and actual local HTTP security headers. Final small-text colors and hover now use darker colors; tags/navigation/actions have 44px targets. The independent report preserves earlier findings chronologically.

Frontend startup JS is about 282KB raw / 90KB gzip. Markdown and syntax highlighting are a separate deferred chunk about 329KB raw / 102KB gzip, loaded on article/project detail. No external font or image calls are needed. These are build sizes, not measured user latency or Core Web Vitals.

## Browser captures

Captured by the final E2E run and visually inspected by the implementer. These are Chromium viewport emulations, not physical iPhone or Safari evidence. The independent reviewer additionally inspected macOS Chrome screenshots and performed direct interactions in a separate context.

- [Desktop home](evidence/home-desktop.png)
- [Desktop article](evidence/article-desktop.png)
- [Mobile home](evidence/home-mobile.png)
- [Mobile article](evidence/article-mobile.png)

Future CI runs retain HTML reports, screenshots and failure traces in the `browser-evidence` artifact for 14 days. Local `playwright-report` and `test-results` are ignored rather than committing environment logs.

## Not verified / not implemented

At the initial cycle there was no deployed endpoint; the later preview bootstrap and independent live QA are recorded below. Do not treat dry-run success as deployment. Account-specific operational details are intentionally omitted from this public record. No live OAuth, authenticated-session/real-record ownership enforcement or graduation logic, private drafts, image protection, moderation/email, likes/history or student trial exists yet. Therefore these tests do not establish production safety for UGC, value for students, Safari behavior or performance at scale. Public sample preview quality and real-service release quality are distinct.

Initial GitHub CI execution is tracked in the PR/Actions, not assumed passed by this local record.

## GitHub verification

[CI run 41660339820](https://github.com/junhat6/kobe-student-hub/actions/runs/41660339820) completed successfully for implementation head `82c5abcd5827fc282a2caeb2096d56f6634e1ae8`; the `browser-evidence` artifact was uploaded. [PR #2](https://github.com/junhat6/kobe-student-hub/pull/2) was merged as `6a976c22f9ece13d1bc271947069ffb46a4f58d8`. Remote infrastructure blocker is tracked in [#3](https://github.com/junhat6/kobe-student-hub/issues/3), identity foundation in [#4](https://github.com/junhat6/kobe-student-hub/issues/4), and pre-selection reader-context discovery in [#5](https://github.com/junhat6/kobe-student-hub/issues/5).

## Cycle 02 — card comparison prototype

Prepared the same three fictional articles as baseline A and reader-context B at `/study/cards?variant=a|b`. The existing home is unchanged. The [study plan](CARD-STUDY.md) records the hypothesis, source experience IDs, neutral prompts, order effects, privacy and pending student validation.

Implementer: build/typecheck and eight logic/Workers-D1 tests passed; all 18 desktop/mobile E2E passed after the comparison was added. A final wording/heading update was rebuilt, and independent QA then re-executed four mobile tests against that output, including API failure/retry and existing outage/deep-link regressions. The implementer also reran the two desktop comparison tests on the final build. See [the independent report](QA-CARD-STUDY.md) for exact scope; do not conflate implementation checks, independent re-execution and student value validation.

| Variant | Mobile | Desktop |
| --- | --- | --- |
| A: current card | [Screenshot](evidence/card-study/a-mobile.png) | [Screenshot](evidence/card-study/a-desktop.png) |
| B: reader context added | [Screenshot](evidence/card-study/b-mobile.png) | [Screenshot](evidence/card-study/b-desktop.png) |

Mobile screenshots are from the independent run of the final build; desktop screenshots are from the implementer's final comparison run. Full final CI is tracked in the PR. None of these captures is a physical iPhone/Safari test. No student trial, preference result or value finding is claimed.


### Cycle 02 screenshot provenance correction

An earlier duplicate section incorrectly described the desktop captures as preceding the final wording/heading correction. The duplicate is removed. The retained files are unchanged; their bytes match the assets already in main `e74d822`.

Execution order in the recorded tool session:

1. Implementer full 18-test run passed before the final wording/accessible-h2 change.
2. That small change was rebuilt. The independent reviewer then ran its final four mobile tests, and those mobile captures were copied into the repository before another run could clear test-results.
3. Implementer ran `npx playwright test --project=desktop tests/card-study.spec.ts` on that same final build: two tests passed (1.1s). These newly generated desktop A/B captures were copied to the retained paths.
4. Both the final mobile and desktop B images visibly contain the clarified ordinary-page-network wording. Re-inspection confirmed this. Source hashes in QA-CARD-STUDY.md match main e74d822; final PR CI and main CI also passed.

The old transient test-results directories were replaced by later test runs, so this is provenance from the recorded executions plus retained image/source hashes, not a claim that the original raw Playwright report is still present locally. The retained images were not regenerated for this correction.

```text
SHA-256 of retained images:
a-desktop.png e0642ceb3ad019fcb552ed12c1fb97822eb6fba89114e99e5142a010a5cf8a1c
a-mobile.png  073c1e0b2fcdbb155fe6b67be3a941ac6aeacdf4f8f5576b60b01531738fae18
b-desktop.png 128bf7602963543897eddd7fea7b684078aba79d4b11e2131a93c1448d1539e0
b-mobile.png  aed289e9aaa6e09977297405eba7702a202ccd567c7344b60d61d1b6873910ff
```

[Cycle02 PR CI](https://github.com/junhat6/kobe-student-hub/actions/runs/41664437523) passed; the parent task separately verified [main CI 41664730933](https://github.com/junhat6/kobe-student-hub/actions/runs/41664730933). This correction changes documentation only, not the captured UI or study conclusions.

## Cycle 03 — unconnected school identity and ownership boundaries

Implementer: production build/typecheck, test-fixture Worker bundle, and the complete 37-test suite passed. A clean lockfile install/typecheck also passed with no reported registry advisories. No production Worker route, Wrangler configuration, UI, database schema, real OAuth setting or privilege grant was changed.

[Independent QA](QA-AUTH-BOUNDARY.md) rebuilt and executed its own 28 identity/owner tests plus four production-Worker negative-boundary tests, all passing. It also explicitly observed that a valid token with the same expected nonce verifies twice: this stateless helper is not one-time OAuth replay protection. Source hashes and exact commands are in that report.

The tests verify actual RSA signatures and claim rejection in Node and Workers, using generated public-key fixtures at the fixed Google JWKS fetch boundary. They do not establish live Google login, session/CSRF/state/nonce consumption, current enrollment, protection of a real private-data endpoint, or readiness for real student posting. [AUTH-BOUNDARY.md](AUTH-BOUNDARY.md) records the next gates. Existing UI flows remain unchanged; full CI checks the existing 18 E2E without presenting an unavailable login as a working flow.

## Cycle 04 — one-time attempt repository and logging gate preparation

Implementer: build/typecheck, 47 tests and local migration application passed. The test-only attempt entry uses actual local Workers/D1 plus real RSA/JWT verification fixtures. Twenty concurrent consumers produce exactly one nonce-returning winner; sequential reuse, wrong browser/state, expiry and verification failure paths are covered. Public catalog tests include a private attempt row and still expose only the four published samples.

[Independent QA](QA-OAUTH-ATTEMPTS.md) re-bundled the test entries and independently passed 14 tests (10 attempt cases plus four public-data/closed-callback cases). The exact commands/hashes and limits are in the report. Production Worker routes, UI and configuration were not changed by this cycle.

Ten-minute validity is not ten-minute deletion: cleanup is explicit and bounded, with no production scheduler yet. One-time attempt claim is not a complete OAuth/session/global-JWT-replay solution. [LOGGING-GATE.md](LOGGING-GATE.md) remains NOT RUN: neither platform logging settings nor actual OAuth-bearing logs have been verified. No actual leakage is asserted. These facts must remain distinct from helper test success.


## Verified preview bootstrap

The deployer used an isolated archive/build of verified main 6e82dfb and dedicated resources, then checked the literal [returned preview URL](https://kobe-student-hub-preview.ideaboost-whiteboard.workers.dev/): health200/writesEnabled:false, catalog200 with four samples/two fictional profiles and no private identity/attempt fields, article/study deep links200, static/API security headers and noindex, and empty POST content/callback405 with no Set-Cookie. Initial remote schema/ledger verification covered migrations 0001 and 0002 only; unmerged one-time-attempt code was not silently included in this release.

[Independent deployed QA](QA-DEPLOYMENT.md) separately inspected actual public HTTP responses and Chrome flows (article→author→related project, about→comparison A/B). It did not independently inspect management-plane version/database metadata, mobile devices, real Google login or secret-bearing platform logs. Treat those as unverified, not implied by successful public browsing.

No new paid plan, R2 subscription or persistent CI credential was accepted/created. Public source keeps real account/resource IDs out of the runtime template; generated deploy settings are ignored and validated by tests. Ongoing GitHub-only deployment remains opt-in and unactivated pending an authorized credential/settings.

## Reproducible preview deployment handoff

The deploy-setting generator was reviewed separately and passed 11 initial independent tests, including missing/mismatched account/D1 settings, placeholder IDs, unrelated Worker, unexpected assets/binding/migration paths, no credential copying and refusal to initiate a CI grant. [QA-DEPLOY-CONFIG.md](QA-DEPLOY-CONFIG.md) records exact execution and hashes. The implementer's initial full suite passed 58 tests with build/typecheck. These tests prepare local ignored configuration only; they do not create a credential, execute a payment or prove a cloud deployment by themselves.

The later remote auth-state migration is not applied. Deploy commands were separated from remote SQL mutation, so preparing/deploying the sample Worker does not bypass that authorization gate. The new negative test checks this separation. Final recheck results are recorded in QA-DEPLOY-CONFIG.md.

Final handoff recheck after separating remote SQL from Worker deployment: implementer build/typecheck and all 59 tests passed; independent deploy-config subset passed 12 tests. The later result supersedes the initial 58/11 counts for this handoff. No remote auth-state migration or contract/grant was performed by these tests.

## Cycle 05 — body-load recovery

Implementation/source checkpoint: PR #14, `96caaefc08d886c7b3bb4940045fbd9648257dc0`.
Root verification: build, 59 unit/runtime tests, 20 desktop/mobile Chromium E2E and deploy dry-run passed. The initial E2E attempt was interrupted because an older local preview was unresponsive; the complete 20-test run used a newly started server with `CI=true npm run test:e2e -- --workers=2` and passed in 55.8s.

[Independent QA](QA-BODY-RECOVERY.md) separately reran the two body-failure cases (3.4s), visually inspected four final screenshots and recorded exact source/image hashes. It found no merge blocker. The injected 503 targets the production Markdown chunk; removing the failure then full-page reload renders the Git body again. This is local Chromium desktop/mobile viewport evidence, not a remote outage, physical-device test or student value validation.

## Cycle 06 — combined article/author search

Source checkpoint: PR #16, `202f4af439eb68963ad83ff3172cbac9395f3a66`. Root build, 64 unit/runtime tests, 22 Chromium desktop/mobile E2E (9.2s) and deploy dry-run passed.

[Independent QA](QA-COMBINED-SEARCH.md) separately passed all 10 catalog tests and both new form-driven browser cases (2.6s), then visually inspected the four retained screenshots. Correct-author mixed query returns one entry; the other-author query returns none. Full-width/case normalization, filters, ordering and no cross-entry borrowing have regression coverage. Source/image hashes distinguish the independently captured evidence. No student usefulness or physical-device validation is claimed.

## Cycle 07 — return to filtered list

Source checkpoint: PR #18, `7b36e2781d265b2a3a5f3c1cf423561f57c869ee`. Final root build, 68 unit/runtime tests, 30 desktop/mobile Chromium E2E (10.9s) and deploy dry-run passed. Initial added E2E cases failed because their exact link-name locator omitted the arrow; the locator was corrected and the full suite rerun. That initial failure was not evidence of a product regression.

[Independent QA](QA-LIST-RETURN.md) separately passed four navigation unit tests and eight browser cases (3.5s), visually inspected four retained screenshots and recorded source/image hashes. Two review findings were fixed: never create a list snapshot from article scroll when the origin is unknown, and reject canonical return URLs that grow beyond the supported bound after encoding. Regression covers filters, explicit return, Back/Forward, position/card focus, direct/new tab/reload and related navigation with/without a genuine snapshot. The direct-link captures show the safe return action, not a completed lazy body. Student usefulness and physical-device/Safari behavior remain unvalidated.

## Cycle 08 — displayed code to local practice

PR #20 source checkpoint `ba456d00c75221e9d89835655a6304d08706714c`. Root build, 68 unit/runtime tests, final 36 desktop/mobile E2E (14.3s) and deploy dry-run passed. Initial manual-selection tests failed on a false byte-equivalence assumption between Selection.toString and DOM text's final LF; final tests compare the entire selected DOM Range instead. Automatic writeText's argument remains exact, including trailing LF. This is not a native clipboard-byte test.

[Independent QA](QA-CODE-COPY.md) reran six browser cases (5.0s), visually inspected four retained screenshots, and recorded source/image hashes. Success/pending/rejection/unavailable clipboard behavior uses only API-boundary fixtures; no user's OS clipboard was read or overwritten. Manual focus/full-range selection is an actual browser interaction. Native clipboard/permission UI, physical Safari, practice/learning and student value remain unverified. [Candidate comparison and H03](CODE-ACTION.md) explain why the current reader action was chosen ahead of another editor/study preparation surface.

## Cycle 09 — pending copy and staged Git practice

PR #22 source checkpoint `1b8c452de4d4f1e7499874f8e3647e8beaa20c72`. Root final local build, 70 unit/runtime tests, 38 desktop/mobile E2E (16.2s) and deploy dry-run passed. Local content revision applied; the historical bootstrap migration remained unchanged. Seed generation was separately checked to write only the ignored current snapshot.

[Independent QA](QA-CODE-PRACTICE.md) separately passed six Worker/D1 cases and eight browser cases (8.0s), visually inspected four screenshots and recorded source/image hashes. Late resolve/reject cannot hide/overwrite the manual-selection path. Revision guards cover replay, edited text and exact old text with private/non-sample flags. Both implementer and independent QA ran the actual three article blocks in separate disposable Git repos with isolated config/dummy identity: omitted edit means no new commit; manual README edit then diff/commit gives two commits and clean try-new-title branch. This is fixture execution, not a student's learning result.

Remote content revision and final public UI are separate release actions, to be recorded in PR #22. Local QA does not establish remote application. Authentication migration 0003 is still separately denied/pending. Native OS clipboard, physical iPhone/Safari and student value remain unverified; optional E23 observation is aligned with the existing #5 plan.


## Cycle 10 — explicitly authorized auth-test schema

The previous 0003 rejection was superseded only after fresh explicit user permission for this preview-table addition. The deployer checked the exact target, absent schema/index/ledger, existing data and unchanged migration source, reran 70 local tests, then retried the same operation once. Table/index creation and the single ledger insert succeeded. The migration file SHA256 is `403eb50fdd28feee1cba1038c2ccc6eb9dae1d501a421f3d3a3e7531b606a9c4`. Full existing sample/profile rows, counts and old ledger entries were identical before/after; attempts remained zero.

[Independent QA](QA-AUTH-MIGRATION.md) distinguishes its post-apply read-only schema/data verification, comparison against the deployer's before snapshot, local runtime tests and public HTTP checks. No remote attempt-write test or real OAuth result is inferred. The existing public Worker is still 4d87f44, with authentication/write routes closed; documentation main may advance separately. Earlier sections saying 0003 was pending describe their historical scope, not the current schema status.

## Cycle 11 — browser-bound PKCE attempt

Source checkpoint: PR #25, `24b18dc900cc75b997408b91a8d8e9672a331ae2`. Root final build/83 unit-runtime tests/deploy dry-run passed. Existing production-UI 38 E2E passed in 16.8s earlier in this cycle; the later correction only affects the unconnected private flow, so that local UI run is not claimed as a run of the final private-clock revision. CI runs the final source. Production application code/assets remain unchanged and do not import this flow.

[Independent QA](QA-BROWSER-FLOW.md) rebuilt fixtures and passed 29 tests (13 browser-flow, 10 attempt, six Worker) in 683ms. The decrypt-time expiry/rollback finding was corrected with fresh-clock and fractional-cookie-expiry regression. Real SHA-256/JWE and local D1 run together; the test passes cookie headers manually and does not prove browser SameSite/Host enforcement. Independent public GET/POST start/callback remained 405/no Cookie/no Location, and health was read-only. No public endpoint, remote attempt write, actual provider exchange, real key/client credential or permission grant was created. Live session/CSRF/private-account/logging/admission gates and student value remain unverified.

## Cycle 12 — private sessions (local only)

- Local Workers/D1 session schema and server-only lifecycle: [design](SESSIONS.md).
- Separate-context execution: 18 passing relevant cases; source hashes and limitations: [QA-SESSIONS.md](QA-SESSIONS.md).
- Root session-stage full run: 95 passing tests plus build/deploy dry-run. No UI change, real provider, real account, browser-cookie enforcement or student-value claim.
- Remote migration 0004 is not applied; deployed runtime remains sample-only at source 4d87f44. No production session endpoint/configuration was added.

## Cycle 13 — private provider exchange integration

- Server-private broker: [design and outstanding gates](GOOGLE-LOGIN.md).
- Independent QA: 41 passing local Workers/D1 cases in 10.70s, exact source hashes and review corrections in [QA-GOOGLE-LOGIN.md](QA-GOOGLE-LOGIN.md).
- Root final 105 tests passed (10.94s); existing 38 PC/mobile regressions passed (8.2s), build and deployment dry-run passed. Initial3 failed success cases exposed unsupported Workerd redirect:error and were corrected to manual handling with an outbound no-follow assertion. Deadline tests cover stalled headers/body/cancellation; provider/JWKS replies remain local stubs with real RSA verification.
- Local development and isolated test D1 only; remote0004 not applied, no Google configuration/key/client/grant created, no real sign-in/posting route or deployment in this cycle. Current public runtime source remains 4d87f44.

## Cycle 14 — private draft storage

- [Design and scope selection](PRIVATE-DRAFTS.md): owner-only persistence and optimistic versions support later authoring handoff; no editor/autosave or student-value validation claimed.
- [Independent QA](QA-DRAFTS.md): separate rebuild and40 local tests (10.75s), including draft12/session12/Google10/publicWorker6, exact source hashes and limitations.
- Root local development migration0005 and38 PC/mobile regressions passed (8.1s). The public-catalog test seeds actual private draft content and verifies it is absent; draft routes stay405. Root final117 tests passed (11.10s), with build/deploy dry-run successful; CI release status is recorded in the release PR.
- No production Worker routes/UI changes, remote0004/0005, accounts/credentials/grants/contracts or deployment. Actual public runtime remains sample-only source4d87f44.

## Cycle 15 — private draft HTTP boundary

- [Design/contract](DRAFT-HTTP.md): real session/store authorization, bounded JSON acquisition, uniform private headers and generic errors in an unconnected handler.
- [Independent QA](QA-DRAFT-HTTP.md):41 relevant tests passed (6.46s), fixed source hashes and explicit local/synthetic-stream limits.
- Root128 tests passed (11.15s),38 desktop/mobile regressions passed (8.0s),build and deployment dry-run passed. Content-Length is checked against received bytes; UTF8/media/encoding, fixed-buffer/chunk caps, delayed-body/no-insert, epoch change during acquisition and private error behavior were tested.
- Production worker/index.ts and frontend assets unchanged, private routes still closed. No remote migration/configuration/credentials/grants/contracts or deployment; no real browser/cache/log or student-value result.
