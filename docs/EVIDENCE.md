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

## Cycle 16 — local authoring UI

- [Scope/operation](EDITOR-LAB.md): actual local private HTTP/session/D1 editor, isolated from production, manual save only; actual school OAuth and publication remain unavailable.
- Root full134 tests (11.17s),38 existing public PC/mobile regressions (8.0s),build and deploy dry-run passed. Six new client cases validate request/CAS payloads,DTO/list/size/identity constraints,unknown failure and timeout without automatic retry.
- [Independent browser QA](QA-EDITOR.md): final editor rebuild and14 PC/mobile cases passed (13.1s),9 source SHA256 entries and10 visually inspected app-only screenshots. [Desktop edit](evidence/editor/02-navigation-restored-desktop.png),[mobile edit](evidence/editor/02-navigation-restored-mobile.png),[failure keeps text](evidence/editor/03-read-failure-keeps-text-desktop.png),[explicit recovery](evidence/editor/04-explicit-recovery-desktop.png). Three additional local images (04-mobile and05-desktop/mobile) await individual public-sharing approval and are not included in the repository; their hashes and operation results remain in the QA report.
- Review fixed navigation-during-typing loss,skiplink overlay and ambiguous saved-success messaging. Root viewed all10 final images. Historical stale-build tests/images are not presented as final-source evidence.
- No realGoogle/physicaldevice/student-value/log/cache claim. Production main/routes/assets and actual sample preview source4d87f44 remain unchanged; no remote schema/configuration/credential/grant/contract/deployment operation.

Cycle16 CI follow-up: first CI41755583842 passed134tests/38publicE2E and13editor cases; a redundant Playwright response.finished() wait timed out although the page snapshot showed saved success. The helper retains HTTP200+saved DOM+clean-state assertions, removes only that wait, and separate-context final14 passed again(13.1s). Product source and original screenshots are unchanged. Automatic editor artifact upload is now withheld; initial earlier-config CI output existed, and a byte-hash audit confirmed it contained none of the three withheld original images. See QA-EDITOR.md for source checkpoints and publication boundaries.

Cycle17: mainCI41756626408 observed another test-only CDP body retrieval failure (13/14editor passed;134tests/38public cases passed). #34 replaces that delayed read with explicit UI save acknowledgement and native browser metadata fetch, preserving and strengthening saved-draft ownership/Markdown checks. Independent rebuilt14 passed(13.2s),product source/assets/retained images unchanged; third test checkpoint is in QA-EDITOR.md. No timeout increase,blanket retry,assertion removal or image publication.

## Cycle 18 — article report intake and pending review

- [PRD comparison/design](MODERATION-INTAKE.md): published articles only,one account/target,atomic pending event at1/2 and temporary-hide event at3,private operator access; no mail sender or restoration policy inferred.
- [Independent QA](QA-MODERATION.md): final19 Workers/D1 cases passed (819ms),source hashes and exact boundaries; earlier29-case execution is separately identified.
- Root147 tests (11.22s),local development migration0006,38 public desktop/mobile regressions (8.1s),build/deploy dry-run passed. Production catalog GET after trusted fixture INSERT/DB triggers keeps one/two-report articles and excludes the third-report target/private reasons/outbox fields. This is not an actual public report endpoint or operator browser flow.
- Concurrent dedup/threshold and outbox-failure rollback verified; account unlinking preserves accepted counts/pending cases while real retention/re-registration remains undecided.
- No actual email/notification delivery,user-facing report UI,remote0004/0005/0006,credentials/operator grants/contracts/deployment or new screenshot publication. Public runtime remains sample-only4d87f44; student/operator value and full cache/media/appeal lifecycle remain unverified.

## Cycle 19 — first-publication snapshot boundary

- [Design and limits](PUBLICATION-BOUNDARY.md): saved-version owner authorization, manual public profile mapping, atomic immutable first-publication snapshot and explicit anonymous DTO. Unconnected local store; no actual publish HTTP/UI.
- [Independent QA](QA-PUBLICATION.md): final18 cases passed (745ms), six source hashes; earlier30-case checkpoint explicitly separated. Concurrent idempotence, ABORT/IGNORE rollback, later private edit/delete independence, legacy projection bounds and three-report hiding without replay restoration verified.
- Root158 tests (11.21s), local migration0007,38 public PC/mobile regressions (8.5s),build/deploy dry-run passed. Existing production catalog excludes actual fixture publication records, private linkage and their nonsample profiles; sample4/2 remains. Production entry/assets unchanged.
- No real-user publish/login/browser/operator/mail/student trial or actual cache/log validation. No remote0004–0007,credentials/grants/contracts/deployment or new screenshot publication; previously withheld originals remain held. Runtime remains sample source4d87f44; #38 tracks release prerequisites.

## Cycle 20 — explicit first public profile

- [Contract and limits](PUBLIC-PROFILE.md): empty author-entered fields→anonymous preview→explicit first-create confirmation, atomic public row/private mapping, matching retry and non-overwrite. Existing bounded manual profiles remain read-only compatible. No Google identity defaults or enrollment inference.
- [Independent QA](QA-PUBLIC-PROFILE.md): backend29 cases (8.81s), final rebuilt local editor26 PC/mobile cases (30.3s), source and10 final local image hashes. Earlier pre-badge-correction runs/images are separate checkpoints. Root additionally viewed5 final profile images. Images stay local and outside repository/CI uploads.
- Root176 tests (17.93s), public PC/mobile38 cases (14.4s), final TypeScript/build and deploy dry-run passed. Tests compose profile creation→saved draft→immutable article snapshot→anonymous DTO, plus rollback ABORT/IGNORE/concurrency/revocation/privacy and bounded HTTP. The production entry and assets remain unchanged; actual private/profile routes remain closed.
- Review corrected overview badges after failed/uncertain operations to “未確認”; input is retained and no automatic mutation retry occurs. Initial read failure never becomes a false empty-profile state. No browser persistence added.
- Actual preview read-only smoke: health/catalog200, writesEnabled:false, sample4entries/2profiles. Real Google/admission/publication/consent/operator/mail/cache/log/student value/physical devices remain unverified. No remote schema/settings,credentials/grants/contracts,R2,deployment or screenshot publication; source4d87f44 remains the actual sample runtime. #38 tracks real release gates.

## Cycle 21 — saved version to first local publication

- [Contract](PUBLICATION-JOURNEY.md): saved title/body/version,explicit public profile and metadata review→first publication→cookie-free local anonymous reader. Private owner receipt distinguishes true absence from unavailable/hidden/deleted. No published editing/restore policy inferred.
- [Independent QA](QA-PUBLICATION-JOURNEY.md): final backend29 (6.45s), corrected explicitly rebuilt editor40 (30.3s), source hashes and8 local-only final image hashes. Prior pre-NUL and anonymous-device-context checkpoints are separate; initial anonymous contexts did not prove mobile rendering. Final contexts explicitly inherit/assert project viewport/device settings. Root additionally viewed4 final images.
- Root195 tests (11.17s),38 public PC/mobile cases (8.0s),TypeScript/build/deploy dry-run passed. Production worker entry and assets stay unchanged; private publication routes remain closed on production. NUL-body prewrite/reader consistency,final SQL authorization,original snapshot after later private edits,strict bounded transport,concurrency and true absence/unavailable were exercised with actual local D1.
- PC/mobile tests cover explicit consent reset,metadata-only navigation warnings,pending typing/locked save-navigation,unknown response/manual matching GET,different existing publication preservation,404 vsnull and anonymous no-cookie/no-bootstrap safe Markdown. Anonymous unavailable-screen response is synthetic; actual hidden/deleted rejection is proven separately in local store/HTTP tests, not a complete browser report-operation journey.
- No real Google/admission/consent/operator/mail/cache/log/student-value/physical-device claim. No new schema,remote migration/settings,credentials/grants,contracts,R2,deployment or image publication; #38 still tracks real release gates and actual sample runtime remains the recorded4d87f44 source.

## Cycle 22 — report to read-only operator review

- [Scope and operations decisions](MODERATION-JOURNEY.md): explicit reader report→private own receipt→three distinct fictional accounts hide→trusted operator read-only queue/case. Restoration/re-report,retention,notification,author explanation/appeal and actual inquiry/contact are concrete unresolved choices,not fabricated buttons or destinations.
- [Independent QA](QA-MODERATION-JOURNEY.md): relevant backend30 (6.51s),one final rebuilt editor/reader/profile/publication/report/operator PC-mobile suite50 (41.6s),14source hashes and8 local-only final image hashes. All8 independently viewed; root additionally viewed4. No image upload or previously held-image retry.
- Root214 tests (11.20s),38 public PC/mobile cases (8.4s),TypeScript/build/deploy dry-run passed. A docs-only Tailwind source-scan artifact was removed through plain wording; final build/dry-run regained original production asset identifiers. Required unit/public regressions were run once rather than rerun for this non-product text adjustment.
- Actual local Workers/D1 establishes dedup/third-report hiding/pending outbox,accepted-own hidden receipt vsunavailable,default-denied operator scope,private DTO/final SQL/revoke/bounded transport. Browser proof includes no initial private/identity calls,explicit report opening without autoidentity,unknown receipt/manual reconciliation,real hidden new anonymous reads,regular/anonymous operator refusal,literal reason/detail/safe article rendering and stale case clearing.
- No actual Google/admission,notification delivery,operating judgment/restore/contact,CDN/log/physical-device or student-value result. Production routes/sample mode remain closed; no new migration/remote0004–0007,credentials/real grants,contracts,R2,mail,deployment or screenshot publication. See #38 for genuine activation gates.

## Cycle 23 — author logout and session revalidation

- [Contract and limits](SESSION-LIFECYCLE.md): existing-cookie-only local account lab, current-token logout and private author subtree remount. Unknown checks conceal/inert the retained same-session editor; confirmed invalid/change/logout discards it. Explicit continuation is required after uncertain logout or a different session. No fictional identity bootstrap occurs on this route.
- Final root233 tests (11.24s),TypeScript/build/deployment dry-run passed after the typed-inspection correction. Earlier public PC/mobile38 cases passed (8.1s); production entry/assets stayed unchanged, so that suite was not repeated for an unconnected-helper correction. Earlier232 root and28 independent backend checks are historical checkpoints.
- Review fixed zero-framed empty Workers requests, zero-change SQL logout acknowledgement and storage-error versus signed-out classification. A synthetic throwing DB adapter proves lookup failure maps503 with no cookie change and the same actual local token subsequently remains valid; it is not an actual Cloudflare outage. Current-token revoke, other-token survival and zero-row suppression use actual local D1/session behavior.
- Guard checks run before request, after headers and before releasing body EOF. A local-only fixture sends actual saved-draft headers/first bytes immediately and delays the remainder5seconds, allowing a cookie switch after the header proof. This exercises a specific race; it is not an atomic cookie guarantee, instant cross-tab monitoring or secure memory erasure. Cancelling cannot undo a committed write.
- No actual Google/admission/controller/platform-log/cache,operating notification/judgment/contact/retention,physical-device or student-value evidence. No schema,remote0004–0007,credentials/real grants,contracts,R2,mail,deployment or image publication. Actual hosted sample remains source4d87f44; #38 tracks genuine activation gates.
- [Independent final QA](QA-SESSION-LIFECYCLE.md): corrected backend29 (741ms),explicitly rebuilt full62 PC/mobile editor cases (58.5s),source/image hashes. The62 comprise prior50,new developer10 and independent2. Eight new images remain local; all8 independently viewed,root sampled4. Cropped/scrolled controller captures demonstrate state visibility rather than a complete-page visual claim. Synthetic503/401 browser cases prove retention/discard interaction separately from local backend fault classification.

## Cycle 24 — existing Markdown helper correction

- [Contract](MARKDOWN-HELPERS.md): existing heading/code buttons operate on touched logical lines, preserve outside source/line endings, normalize existing ATX headings and choose a sufficiently long backtick fence. Bold keeps its inline behavior. Composition pauses helpers/view switching without forced commit/cancel; pending-save edits remain unsaved later versions. No new buttons/renderer/media features.
- Independent baseline on main cc5177 reproduced inline heading with zero H2 and split code with trailing content rendered as a paragraph; root and QA viewed both local captures. Actual parser output is distinct from an inferred source defect.
- Root243 tests (11.18s),38 public PC/mobile regressions (8.0s),TypeScript/build/deploy dry-run passed. A unit-test title generated one unused Tailwind overflow utility; wording-only adjustment plus final build/dry-run restored original production assets. No assertions/product code changed for that adjustment, and unrelated suites were not repeated.
- No real Google/admission/platform privacy/operating notifications/contact/restore/retention,physical-device/IME or student-value evidence. Local fictional editing only; actual hosted sample remains source4d87f44. No new schema,remote0004–0007,credentials/grants,contracts,R2/mail,deployment or image publication.
- [Independent final QA](QA-MARKDOWN-HELPERS.md): final10 semantic unit cases (115ms),explicit editor rebuild and72 PC/mobile cases (1.0m). Previous62 plus new developer8 and independent2. The developer8 checkpoint preceded the last empty-ATX correction; final QA includes it. Five final source fingerprints and6 final local images are recorded alongside the distinct2-image baseline. All6 new images independently viewed,root sampled4; cropped content establishes specific states rather than complete page layout. No image upload.

## Cycle 25 — published article to author to other articles

- [Selected contract and limits](AUTHOR-DISCOVERY.md): PRD core Q24 journey,actual fictional local publication records,anonymous author profile+maximum20 newest summaries. Candidate SQL bounds/full DTO reread,current visibility,strict UUID/author/private-field exclusion and256KiB public JSON cap. No orphan profile,false empty success,body or related linkage in cards.
- Independent baseline created two actual local publications by one author; article reader had zero author links and no other-article path. App-only image was viewed; baseline source is main93ac1dc. Initial fixture CSRF mismatch was corrected by avoiding legacy root autoidentity,not by bypassing authentication.
- Root261 tests (11.18s),38 public PC/mobile cases (8.4s),TypeScript/build/deploy dry-run passed; production entry/assets remain unchanged. A test-data correction used a true six-byte non-NUL JSON escape to prove a valid20-card response exceeds128KiB and stays below256KiB. No product change was made for that fixture correction.
- [Independent QA](QA-AUTHOR-DISCOVERY.md): backend28 (902ms),explicit final editor rebuild/full80 PC/mobile cases (1.1m),then only corrected raw-header HTTP2 cases (8.8s). Browser fetch masks Set-Cookie,so the later APIRequestContext raw-header assertion replaces an ineffective earlier check. Product source and6 images are unchanged after80; final test-file fingerprint identifies the narrower follow-up.12 source hashes and baseline/final evidence fingerprints recorded; all6 new images independently viewed,root sampled4. All remain local.
- Actual third distinct report hides the target from newly fetched anonymous author/article data; another same-author article remains. Other author/private draft/report identity fields stay excluded. Native article→author→other/back/direct and new-tab href target work; physical gestures,precise focus/scroll,already delivered data erasure and real CDN/cache are not asserted.
- No actual Google/admission/operating delivery/contact/retention,physical-device or student-value result. No new schema,remote0004–0007,credentials/grants,contracts,R2/mail,deployment or screenshot publication. Hosted sample remains source4d87f44; #38 tracks actual activation gates.

## Cycle 26 — publication to recent anonymous discovery

- [Contract/limits](RECENT-FEED.md): cross-author recent20 publication-backed cards,short public author pairing,shared author/recent SQL and bounded anonymous transport,ordinary navigation and new-tab publication receipt entry. True empty differs from unavailable; no body/bio/private linkage in cards,no global search/recommendation claim.
- Independent actual baseline main5c94449 had no recent-entry link on article or author pages. Two local images were inspected; unknown legacy-bootstrap routes were not visited or treated as real identity behavior.
- Root271 tests (11.21s),38 public PC/mobile cases (8.1s),TypeScript/build/deploy dry-run passed; production entry/assets unchanged. An out-of-contract failed-result mock proposal was removed after checking current D1 types/implementation; it is not counted as release evidence or an actual runtime defect.
- [Independent QA](QA-RECENT-FEED.md): backend35 (1.03s),explicit final editor rebuild/full86 (1.2m),then6 request-header-strengthened cases as4/12.7s +2/9.8s. Request.allHeaders(),not the security-filtered headers() subset,proves Cookie/CSRF omission. Existing-session popup context and parent private buffer were checked. An initial title selector matched4,then only the omitted2 ran; no broad duplicate execution. Product/source images unchanged after86;17 source fingerprints identify the test-only follow-ups.
- Actual Composer publish→receipt newtab→new recent card→article→author and3 distinct fictional reporters→fresh feed exclusion/other card retained passed. Raw anonymous HTTP headers/strict path/query/method and body projections were checked. Genuine backend-empty and synthetic browser-empty/error cases remain separate claims.
- Six final local receipt/card images independently viewed; root sampled5. Region crops establish these states rather than a complete20-card visual or physical-device result. No image upload or retry of held originals.
- No real school Google/admission,operating delivery/policy/contact,platform logs/CDN/media,physical devices or student-value validation. Hosted sample remains source4d87f44. No new schema,remote0004–0007,credentials/grants,contracts,R2/mail,deployment or screenshot publication; #38 tracks actual activation gates.

## Cycle 27 — source query-redaction configuration

The Wrangler template requests query-string redaction; the existing generated-config roundtrip verifies preservation. Root passed build,271 tests,38 public PC/mobile cases and deployment dry-run; assets unchanged. [Independent source QA](QA-LOGGING-GATE.md) passed12 configuration tests and fixes source hashes. No runtime privacy or working OAuth claim follows from this source-only evidence.

## Cycle 28 — first real-user release prerequisites

[FIRST-RELEASE.md](FIRST-RELEASE.md) separates local prototype evidence, actual connection evidence, external settings/policy decisions and student/device validation, linking existing gate documents. [Independent documentation QA](QA-FIRST-RELEASE.md) reviewed the checklist and README/WORK against Issue38 and existing documents, found no blocking issue and checked28 repository-local links with0 missing. Root TypeScript/build and link checks passed; production assets are unchanged. Documentation-only scope adds no runtime behavior or gate-completion claim. No additional local functional tests were needed; existing mandatory CI remains enabled.

## Cycle 29 — author detour retains discovery context

Screenshot-first [reader audit](DISCOVERY-NEXT.md) and separate public baseline reproduced filtered1→article→author→home4 on PC/mobile. The repair keeps canonical root/search/study context through one profile wrapper, with separate actual profile and outer-list positions. Root passed build,272 tests,46 public PC/mobile cases and deployment dry-run. [Independent QA](QA-READER-CONTEXT.md) passed5 navigation units,16 existing/developer browser cases and2 final independent cases; screenshot-induced test measurement correction and final local-only capture guard are explicit. Six final images were independently viewed, root sampled4, and source/image fingerprints were checked. New images remain local; no original held image was republished.

Observed condition loss is distinct from the unvalidated hypothesis that preserving it helps students continue exploration. H02/E23/activity-understanding candidates remain in the existing trial/discovery plan. Actual authentication/posting, comprehensive privacy and student/device validation remain unfinished. Operational evidence is outside this public record.

## Cycle 30 — fictional local public article likes

[Scope and value hypothesis](ARTICLE-LIKES.md) compare likes with independent projects and published editing. The local journey connects explicit public association→anonymous liked-article list→reader→own withdrawal. [Independent QA](QA-ARTICLE-LIKES.md) verifies real session/CSRF/final SQL, public-field bounds, duplicate/uncertain-operation handling, account changes and actual three-reporter hiding with withdrawal despite an injected profile failure. It distinguishes storage behavior from synthetic responses and student value from AI operation checks.

Root build/290 tests/public48/editor92/dry-run passed. Final production assets match515e0991; final editor bytes match the92-case run after a harmless source-variable rename. Independent43 plus separately executed public-client3 and rebuilt focused browser8 passed.30 recorded fingerprints match;8 images were independently viewed and root sampled4. New images remain local. Local schema0008 and fixture endpoints are not production deployment/authentication, and real privacy/eligibility/operating/student-device validation remains unfinished.

## Cycle 31 — image-free standalone local projects

[Scope and hypothesis](STANDALONE-PROJECTS.md) compare standalone projects with public editing. Private versioned fields→explicit saved snapshot→anonymous project→project-only author list works without an article. Canonical saved HTTPS URLs and chosen public profile are reviewed before the action; no automatic external fetch, article reading time/likes/report-policy reuse or public editing. Later private edits do not replace the public snapshot.

[Independent QA](QA-STANDALONE-PROJECTS.md) passed31 backend/client/affected anonymous cases (6.43s), explicitly rebuilt the editor and passed8 focused PC/mobile cases (29.0s). Actual delayed project EOF after account change discards the old private scope; raw anonymous DTOs and project-only author behavior were checked. Hidden/deleted storage checks and injected lost-ack recovery are described separately. Root build/307 tests/public48 passed; editor90 passed initially and10 status-selector failures were corrected by narrowing2 test helpers without changing exact assertions, then all12 affected cases passed. Deployment dry-run passed; no actual deployment. Final production assets match515e0991.

Eight final images were independently viewed, root sampled5; fingerprints are in the QA record. They remain local-only and are not student/physical-device evidence. Local schema0009 does not activate a real project service. Real authentication/eligibility, project reporting/operations, media, public editing/retention, actual privacy protection and student value remain open; FIRST-RELEASE.md and Issue38 track the distinction.

## Cycle 32 — local project report intake and read-only review

[Scope and unresolved policy](PROJECT-REPORT-REVIEW.md) separate a local report→own receipt→trusted review experiment from public editing and actual moderation. There is no project threshold, visibility write, notification/outbox, handling decision or restore/delete action. Accepted receipt is not exact confirmation of the currently visible text or completed operating response.

Root build/322 tests/public48/editor114/deployment dry-run passed. [Independent QA](QA-PROJECT-REPORT-REVIEW.md) passed39 affected tests (6.54s), explicitly rebuilt the editor and passed12 focused PC/mobile cases (19.8s). Actual21 reporter submissions retain public visibility and produce a20-record partial case; unknown proof preserves a hidden same-session input, while actual CSRF logout/server401 discards it. The real-invalid test was strengthened after the root114 checkpoint and is not claimed as part of that earlier execution. Developer23-reporter D1 checks also leave article report/outbox untouched.

Eight final images were independently viewed and root sampled5, all local-only with source/image fingerprints in QA. No real operator, reporting policy, school login/eligibility, notification/decision, privacy/CDN/cache/logging or student/physical-device value is established. Local0010 and fixture routes do not activate production. Public source assets and sample515e0991 are unchanged. No remote data, credential/grant, contract, deployment or screenshot publication.

## Cycle 33 — owner-only publication records

[Scope](OWN-PUBLICATION-RECORDS.md) connects the PRD MyPage own-post need to a private combined article/project record list. It labels stored state, initial publication time and the publication's saved source version, with maximum20 plus moreExists. This is neither public editing nor a reason/notification/decision/erasure/complete-history guarantee. Existing receipts and report rules are unchanged.

Root build/332 tests/public48 (9.7s)/editor122 (2.0m)/deployment dry-run passed; production assets remain515e0991. [Independent QA](QA-OWN-PUBLICATION-RECORDS.md) passed43 affected cases (6.64s), explicitly rebuilt final assets and passed8 focused PC/mobile cases (27.9s), overlapping the root122 rather than adding8 unique cases. Actual mixed21→20 private records, article3-report hiding versus project reports retaining visibility, and a5-second own-list EOF after A proof then B cookie were checked. B cannot consume old A records/input and requires explicit continuation.

New image capture is opt-in under/tmp, stays local and is not a held-image retry. The QA record binds final source/test/image hashes and separates screenshots from HTTP/DOM proof. No migration, remote SQL, real identity/role, credential/grant, contract or deployment occurred. Actual connection, operating explanations/appeals/decisions/notifications/retention, public editing, privacy/cache/logging and student/physical-device value remain open.

## Cycle 34 — explicit local author stop with own-state recovery

[Scope](PUBLICATION-STOPS.md) separates a selected original snapshot's author stop from public editing, report adjudication, deletion/erasure and restoration. Unique markers plus atomic published→hidden updates preserve original text/private edits/report evidence, and normal republish of the marked original is guarded. Existing report-hidden state without a marker is never claimed as an owner stop.

Root build/342 tests/public48/editor132/dry-run passed before final UI refinements. Final focused6 (17.9s) covers automatic list sync after a non-owner hidden result, read-only receipt recovery after reopening in a second same-session page, retained dirty input and an explicit captured-lookup write prohibition. [Independent QA](QA-PUBLICATION-STOPS.md) retains unchanged52 backend/client/affected cases (6.83s), explicitly rebuilds final source and passes10 PC/mobile cases (32.2s). Earlier overlapping checkpoints are not summed as distinct tests or final evidence.

Actual publicationv1/private savedv2/unsavedv3 and accepted project report evidence remain intact after stop. Fresh target/author reads exclude hidden data. Actual committed stop with synthetic5-second response EOF rejects old A data after cookieB while a separate A receipt confirms abort did not undo it. Full log/cache/third-party erasure and actual operating readiness are not proved.18 source/test/integration and8 final image hashes bind the QA result; all8 images were independently viewed,root5. Images remain local/tmp opt-in, with pre-recovery paths kept separate and no publication/held-image retry.

Local0011 and fixture endpoints are not production activation; no remote SQL/new credential/grant/contract/deployment occurred. Production sample515e0991 is unchanged. Public revisions, real school identity/eligibility/privacy and operating policy/notification/decision/explanation/appeal/contact/retention, student and physical-device validation remain unfinished.


## Cycle 35 — article operator session boundary

Independent baseline reproduction on e99d37c passed2 PC/mobile cases (13.2s): operator A's private reason/detail stayed visible after a B cookie and focus, even while fresh raw case GET returned404. The old ModerationLab SHA256 was `63972b64272cf52da397a47a9f3d4704bb8ab43ee0aaaf1f50558435a1c9a16a`. Two app-only local baseline images were independently opened; root inspected both. These are fictional test data, not actual account/production evidence. Baseline script/images and fingerprints remain temporary local files.

Developer type/build and18 focused PC/mobile cases passed (38.0s), new8 plus existing10. Source review by a separate backend context found no blocking issue; it did not run tests or change source. Final independent execution and source/image fingerprints are recorded in QA-MODERATION-SESSION.md. This is a local read-only rendering/response-consumption correction, not an operator role grant, real authentication, erasure, judgment/notification/contact or student-value validation. No remote schema/data/config, credentials, contracts, actual deployment or screenshot publication.

Root checks passed: build,342 unit tests,48 public PC/mobile cases (10.0s),144 local editor cases (2.9m), deployment dry-run. The prepared independent4 are included in144; final separate QA is not an additional full-suite count. Production assets match source515e0991 byte-for-byte.

Final independent12 passed (41.7s), developer8 plus independent4, after explicit final lab rebuild (index-BHmDJRlo.js/index-d9_J69x4.css). No unchanged backend rerun was claimed. The independent additions verify actual logout without focus and pageshow cancellation during delayed case EOF, then fresh queue recovery without late resurrection. Eight final images were independently opened; root sampled5 (desktop01, mobile01–04). QA-MODERATION-SESSION.md records baseline/final provenance and source/test/image fingerprints. Images remain local-only. Real school/operating/logging/cache/student/device gates stay open.


## Cycle 36 — recent standalone projects to activity discovery

Issue71's source review confirmed projects had only known-ID/author entry points, while articles already had cross-author discovery. Added a local anonymous recent-project entry and native project/author/article navigation. This advances the PRD's activity-discovery hypothesis; no student value or real publication readiness is established. PROJECT-DISCOVERY.md defines the bounded20/shortDTO/noURL/full-snapshot validation and genuine-empty versus unavailable contract.

Backend initial12 passed6.59s, then a test-only storage-failure strengthening passed12/6.77s. Existing stop FK and independent author-list dataset are retained, not disabled; healthy reads are proved before injected D1 failure. The narrow anonymous client passed3/83ms. Developer explicitly rebuilt and passed12 PC/mobile cases (21.2s), new6 plus existing standalone-project6. Root build/347tests/48 public cases (9.9s)/154 editor cases (3.0m)/dry-run passed. These overlapping checkpoints are not added as distinct cases; the root154 include prepared independent4.

Production assets match sample source515e0991 byte-for-byte. Final independently rebuildable local assets are index-B3RHtRyH.js/index-BTAIEj4w.css. QA-PROJECT-DISCOVERY.md records final separate execution and source/test/image fingerprints. Real Google/admission, log/cache/data protection, operating decisions/notifications/explanation/appeal/contact/retention, student value and physical-device validation remain unfinished. No schema, remote data/configuration, credential, new permission/contract, actual deployment or screenshot publication.

Final independent30 affected cases passed (6.76s), using unchanged root-built fixtures; explicit editor rebuild followed by10 PC/mobile cases passed (19.8s), developer6 plus independent4. Actual publication-newtab/privatev2/unsavedv3/publicv1 and actual owner-stop/fresh anonymous exclusion are distinguished from injected empty/503. Final8 local images are recorded in QA-PROJECT-DISCOVERY.md; root sampled5 (desktop01, mobile01–04). Images remain local-only. A pre-existing draft-list version-freshness observation in mobile02 is a separate follow-up candidate, not a discovery regression or student-value result.


## Cycle 37 — confirmed private-project list metadata

Issue73 was selected over configuration/policy-dependent release work. Independent baseline2 PC/mobile cases (13.6s) on main915ab867 reproduced the old list title/version1 beside confirmed savedversion2 and retained unsavedversion3. Both baseline images were opened by independent QA and root. Old ProjectRegistration SHA256 was b3c7cfe7794e18156fb70db888bddfb36e19359725aed1fbdd8197ae88ae9cbf; local baseline fingerprints/script and images are kept outside tracked source. This is stale display evidence, not data loss or student-value evidence.

Developer metadata-helper3 passed (68ms), build/type check and12 related PC/mobile cases passed (21.9s), new6 plus existing project6. Only validated private acknowledgement/read summaries enter the list, not optimistic input or public source versions; manual full-list replacement and current-session safeguards remain separate. PROJECT-LIST.md records returned20/known-page scope and limits. No backend/client/fixture/schema/production route, remote data/configuration, credential/grant/contract, actual deployment or image publication change.

Root build/350tests/48 public cases (10.2s)/164 editor cases (3.2m)/deploy dry-run passed. The164 include prepared independent4; final separate QA is a different provenance checkpoint, not an extra full-suite count. Final lab assets index-DBeOr-vz.js/index-BTAIEj4w.css; production assets match the sample515e0991 baseline byte-for-byte. QA-PROJECT-LIST.md records final separate execution and fingerprints.

Initial independent10 helper/client cases passed (83ms), then explicit final editor rebuild and10 PC/mobile cases passed (29.9s), developer6 plus independent4. Actual old-A delayed GET cannot merge into B's empty list; actual immutable publicv1 survives privatev2 metadata confirmation and unsavedv3. QA-PROJECT-LIST.md binds baseline/final source and image fingerprints and distinguishes injected latency/stale/error cases from actual fictional session/storage operations. Eight final images were independently opened; root sampled5 (desktop03, mobile01–04), and both baseline images. Images remain local only. Real authentication/protection/operations/student/device gates remain unfinished.

PR CI41829031920 found a test setup ordering gap before the new mobile EOF privacy assertions:350/public48 passed, editor163 passed/1 timeout. The initial list could race the test's direct title update. An explicit old-title/version1 barrier fixes that precondition, with no product/timeout/retry/privacy-assertion change. Final fixed10/30.0s follows an explicit unchanged lab rebuild; initial29.9s/old-directory images are historical. QA-PROJECT-LIST.md records the new test/image fingerprints and the fixed evidence directory. Root sampled fixeddesktop03/mobile01–04; unchanged independent unit10/83ms is retained.

An ignored one-case deterministic probe passed (12.5s): hold the initial list GET, perform the actual direct test PUT after the form appears, then release the GET. The legitimate list shows renamedversion2 and has no old-title button. This proves the possible ordering, not an observed trace of the failed CI's rendered state. Fixed final source/image16 fingerprints were reverified; all new8 images were independently opened and root sampled fixed5. No product or assertion weakening occurred.


## Cycle 39 — explicit verified pending registration

Issue75 selects the missing server-private verified identity→pending recording step. Default login remains existing-active-only; registration uses a distinct encrypted OAuth audience before attempt claim and never issues a session. The actual RS256 verifier remains in the shared exchange path. PENDING-REGISTRATION.md records private receipt, atomic status/subject/email bounds, no promotion/revival/linking, and operational/student-value limits.

Developer47 targeted cases passed (11.74s), including12 new registration cases and unchanged broker/browser/session35. Independent3 added cases cover concurrent first insert, competing subjects sharing an ASCII-case email and actual SQLite ignored INSERT/UPDATE. Root build/365tests/public48 (11.3s)/deploy dry-run passed. No UI/HTTP route changed; local editor164 was not repeated, while normal CI still runs that suite. No old test was weakened. A prose-only Tailwind utility was removed by rewording new documentation, restoring exact sample515e0991 production assets; no functional code changed.

No production route/assets, schema/remote SQL, real account, real Google, permanent credential/grant/key, secret setting, actual deployment or image publication. Existing ephemeral in-memory cryptographic test fixtures are separate from live keys. Independent execution and exact source fingerprints are recorded in QA-PENDING-REGISTRATION.md. No new UI screenshots are required or claimed.

Independent focused50 passed (10.83s) using unchanged final root-built fixtures. Source/old-test/production boundaries and final fingerprints are in QA-PENDING-REGISTRATION.md. Actual local D1 writes and RSA verification are distinct from stubbed provider/JWKS transport, injected before-statement status changes and real SQLite ignored writes. These are not live Google, browser, enrollment, platform logging, student-value or device evidence. GitHub PR approval is not part of this independent source review.


## Cycle 40 — closed OAuth HTTP transport (2026-11-05)

- Design/scope: [OAUTH-HTTP.md](OAUTH-HTTP.md); independent execution and fingerprints: [QA-OAUTH-HTTP.md](QA-OAUTH-HTTP.md). Production's internal false gate prevents all new routes from opening under complete runtime configuration. Public sample and writesEnabled:false remain.
- Root: types/build passed,378 tests/46 files (11.16s), public PC/mobile48 (10.4s), deployment dry-run passed. No local rerun of unchanged editor164; normal CI covers it. All3 production asset names/bytes equal the sample release archive. Production bundle contains no new fixture/signing/fault/private JSON test markers. Existing auth core/config/generated Env/frontend bytes are unchanged.
- Developer final17 passed (1.07s): adapter10 plus production worker7. Initial tests were corrected for manual redirects, Worker entry export constraints and Cookie attribute ordering; only final results count as passing evidence. The initial missing-manual developer run could have followed an external authorization GET with synthetic ephemeral values; exact external outcome is uncertain. No real credential, identity or actual provider configuration was used and no live probe was attempted.
- Independent73 passed (11.11s): new13 plus unchanged relevant60. Added existing-session/pending separation, partial/invalid config across all5 routes and complete-env source-gate/forbidden-DB cases. Independent HTTP requests used manual redirect mode before their first execution. No browser SameSite/real Google/platform logging/physical device/student-value claim.
- No actual credential/key/grant, provider save, real account, resource/DNS/billing, remote SQL, deployment, screenshot publication, Issue4/38 update or PR approval operation. Real origin/public-information/custody, callback logging/transport, eligibility/operating and dedicated deployment targets remain gates.


## Cycle 41 — closed production configuration preparation (2026-11-05)

- [Design and current command behavior](PRODUCTION-CONFIG.md); [independent QA](QA-PRODUCTION-CONFIG.md). Dedicated production target selection remains unresolved; no actual Worker/origin/resource identifiers are published.
- Developer22/22 (378ms): production10 plus existing preview12. Independent25/25 (390ms): same22 plus3 separate subprocess/filesystem/injection cases. New CLI and legacy entry remain closed with fixed sanitized output, no production deploy path and no implicit SQL. Pure module artifacts use fictional temporary targets only.
- Root build/typecheck and deployment dry-run passed. Existing preview generator, config/generated Env, application/OAuth source and fixture builder are byte-identical to main4a019800. Three frontend assets match the canonical sample release names/bytes. No actual repository production artifact exists. Unchanged runtime/browser tests are left to normal CI rather than repeated locally.
- Matching identifiers only establish local agreement. Remote ownership/existence, private target loading, real origin/public info, credentials/custody, actual callback logging/transport and eligibility/operations remain separate gates. Source/path checks do not prove code/asset integrity against a malicious actor.
- No actual Google/Cloudflare configuration, credential/key/grant, account/resource/DNS/billing/IAM, remote SQL, deployment, screenshot publication, refused Issue4/38 update or PR approval operation.


## Cycle 42 — private sample-only production target (2026-11-05)

- [Private configuration contract](PRODUCTION-CONFIG.md), [local independent QA](QA-PRIVATE-PRODUCTION-TARGET.md). Runtime IDs/origin, actual manifest/configuration fingerprints and operational/live evidence remain ignored/private.
- Developer29/961ms and independent35/989ms passed; actual file read boundaries, stable descriptor mutation refusal, malformed schema/UTF-8, owner/mode/link rules, no argument/environment overrides, sanitized output and safe stale cleanup were executed with fictional temporary inputs.
- Root build/typecheck and selected configuration dry-run passed; source OAuthfalse and production sample asset bytes remain unchanged. Old full runtime/browser suites are verified by normal CI rather than redundant local execution. No preparation command performs deployment, network, SQL or credential actions.
- Separately authorized dedicated empty-DB creation/bootstrap was identity-checked; only public schema/sample data and0001/0002 ledger were initialized. Verified4/2 fictional rows, no auth/private schema and preview untouched. This does not prove deployment or authentication. Actual remote/live results are recorded privately and summarized only after separate verification.
- Google client/secret/key/token, secret insertion/version/deploy effects, IAM, policy/status changes, paid contract/upgrade, real accounts, refused Issue writes and PR approval remain outside this unit. Actual callback logging, admission and operating/privacy gates are not satisfied by these local checks.


# Cycle 43 evidence — content-kind wording

The public detail now calls a project a project and its creator a student who made it, while article wording remains article-specific. Empty search names article/project/both according to the existing selected kind. Shared catalog/recovery/missing/related-empty copy names both kinds. Filtering, route and data semantics are unchanged.

Local final build/typecheck,401 tests across50 files (11.16s),60 public Chromium desktop/mobile cases (10.2s), and deployment dry-run passed. The two initial new mobile sidebar assertions were corrected to match its pre-existing hidden layout; final checks pass without product layout or timeout/retry changes. Separate-context QA adds22 focused browser checks and independently runs the12 new desktop/mobile cases (3.6s). Local captures remain private. See QA-CONTENT-KIND-COPY.md. CI/release results will be recorded in the PR after they actually complete. This does not verify real users/OAuth, student value or physical mobile devices.


# Cycle 44 evidence — discovery comparison update

Reused existing context-return and content-kind-copy behavior evidence without rerunning those journeys. Read CARD-STUDY/DECISIONS/DISCOVERY and Issue5's body/four development comments; no new student-trial result is established by those records. Checked official Qiita search and Behance search/project-creation help on2026-11-05. DISCOVERY-NEXT separates documented mechanisms, existing originator input, source-sample limits and proposed value/priority. Only docs change; no fresh app/browser/operational/student test is claimed. Independent source/claim/link review and documentation checks precede merge; CI results belong in the PR.

Independent planning QA read all three official source pages and checked the H02/decisions/QA/seed evidence, relative links, E23 anchor and claim limits; no blocking finding. Issue5's body/comments were read by the implementer, not independently re-fetched by QA. No new application test or participant evidence is claimed.


# Cycle 45 evidence — callback attempt-cookie ownership

Before changing product source, one new shared-jar fixture case failed: stale callback wrote1 deletion, B-preserved=false/B-session=false/exchanges0. After the minimum adapter fix, focused developer65 tests and independent67 across7 files passed (independent includes2 added cases). Cookie updates are applied before later requests rather than reusing the original start cookie. Independent QA records the exact code/tests, privacy/session assertions and request-time/response-order/DB ambiguity limits. The production source gate remains false and no real provider/config/key/schema or deployment is involved. Full local/CI results are recorded after execution; UI assets are byte-equal to an isolated build of baseline9990116.

Final root checks: build/typecheck,410 tests across51 files (11.28s),60 public PC/mobile cases (11.1s), and deployment dry-run passed. No editor/local auth browser UI or live OAuth check is claimed; normal CI covers the unchanged editor suite.

## Cycle46 — late callback responses

- Before correction, controlled header application reproduced two failures: consumed A's late failure wrote one deletion cookie and erased B, preventing B completion; a saved successful A response applied after B changed the local session identity from fictional B to fictional A.
- Candidate removes every callback attempt-cookie write, including matched outcomes. Controlled consumed-A failure now emits zero cookies, retains B and completes B. The separate session overwrite remains intentionally reproduced as an unresolved release blocker, not a passing safety invariant. See OAUTH-HTTP and FIRST-RELEASE.
- Root final focused run:4files/27tests passed (683ms). Independent final focused run:7files/60tests passed (10.96s), fingerprints and security assessment in QA-OAUTH-LATE-RESPONSE.md.
- `npm run build` passed; `npm test`:52files/415tests passed (11.48s); `npm run test:e2e`:60passed (11.0s); `npm run deploy:check` passed (dry-run only). Frontend output asset names match the preceding baseline; production gate remains false.
- Fixture uses fictional signed provider responses, local D1, public deterministic key bytes and an explicit response-order jar. No real Google, operational key, remote schema/settings, credentials/access or deployment was changed. Local HTTP/viewport evidence does not establish real provider, browser SameSite, physical-device, student-value or platform-log protection.

## Cycle47 — session ordering candidate review only

- Compared current cookies, browser-only locks, finalize-only CAS, account-wide epochs, stable authentication-cookie promotion, device proof and per-browser server generations in SESSION-ORDER-DESIGN.md. No application implementation selected for activation.
- Closed in-memory model: bootstrap emits only a fresh anonymous context once; start/logout advance context generation; final session/private operations reject stale generation/context; recovery requires a new explicit login. It assumes atomic state changes and trusted provider verification, and proves neither actual SQL nor HTTP/browser/crypto behavior.
- Root final focused checks: `npm exec -- vitest run tests/session-order-design.test.ts tests/session-order-design-review.test.ts` passed2files/19tests (70ms). `npm run build` passed (typecheck + Vite). Existing generated frontend asset names are unchanged. `git diff --exit-code main -- worker src migrations wrangler.jsonc worker-configuration.d.ts` passed before commit: no product/schema/config change.
- Independent QA added captured-callback-context enumeration of252 causal schedules, plus context expiry, epoch overflow and an unresolved logout-replay sign-in-loss reproduction. Root's original15 cases include70 narrower bootstrap/start/issue/header schedules. Neither enumeration is an exhaustive formal proof. See QA-SESSION-ORDER-DESIGN.md for exact scope and fingerprints; its final focused run also passed19.
- Remaining before app implementation: choose one-use/idempotent start/logout semantics and ambiguous-commit handling; verify local D1 atomicity/claim ownership/all private final SQL; verify real HTTP Cookie writers, bootstrap retransmission and CSRF. Candidate is supported only for that next closed local-fixture step. Authentication release remains blocked. No Google/key/access/runtime/data/deployment changes or full browser/deploy claims in this analysis-only cycle.

## Cycle48 — real local D1/HTTP fixture

- Added isolated `lab_*` SQL fixture (not migrations), Worker-only test entry and loopback HTTP helper. All provider responses and identities are fictional; outboundService refuses other destinations. No production source, schema/config/gate, operational key, credential, real data or deployment changes.
- Root HTTP run:24tests passed (645ms), typecheck passed. Independent fixture rebuild + HTTP/model run:4files/47tests passed (741ms); hashes and additional account/final-SQL/start-logout rollback/race coverage in QA-SESSION-ORDER-D1.md.
- Full local checks after freeze: build passed; `npm test`56files/462tests passed (11.79s); `npm run test:e2e`60passed (11.3s); `npm run deploy:check` passed (dry-run). The5 frontend output files are byte-identical to the preceding baseline. `git diff --exit-code main -- worker src migrations wrangler.jsonc worker-configuration.d.ts` passed. No full editor/browser or remote D1 claim is inferred from the new fixture.
- Supported in the exercised schedules: old session headers never authenticate stale actor; header loss/reorder may require explicit fresh login; one-owner claim; generation+attempt creation rollback; completion rollback retains consumed claim; expected-generation commands reject stale execution; completed replay acknowledges without Cookie/new epoch; last read/write SQL rechecks context/generation/account/expiry; device contexts isolate start/logout while account epoch still revokes existing same-account sessions.
- This refines PR84's late-command semantics and closes its demonstrated completed-logout replay sign-in-loss within the local fixture. It does not patch the real adapter. SESSION-ORDER-D1.md records account snapshot timing, simplified session policy, unmodified production authorization routes, bootstrap/transport assumptions, cleanup/DoS/UI/real-browser/logging limitations. No blocking finding in closed QA; those limits still block application adoption/release claims.

## Cycle49 — application protection behind the closed gate

- Implemented SESSION-GENERATION-IMPLEMENTATION.md after independent inventory:9repositories/48 SQL sites,36private guards+12public exceptions; fixed project publish's early private read. Central predicate now validates current browser context/generation and retains account status/epoch, per-token revocation, creation/last-seen/idle/absolute checks. Final bindings resample trusted time and reject rollback. Static inventory also detects newly added authenticated repositories.
- Adopted the independently reviewed narrower pending-revocation alternative: global revision is only an ordering stamp; verified subject floors reject affected login/registration without invalidating unrelated pending students. Delete/recreate tombstones, minimum-stamp GC, command replay, rollback and clocks are tested. Quiet physical retention/query-workload and real operating policy remain gates; no real-user erasure or scalability claim.
- Migration0012 invalidates legacy sessions without dropping accounts/content. Active sessions survive expired attempt cleanup through FK SET NULL; cleanup uses RETURNING to count deleted attempts exactly rather than FK side effects in D1 meta.changes. Missing/old schema fails closed; production never automigrates.
- Independent private guard suites:10files/108tests pass (7.95s), typecheck and fixture rebuild pass. Migration/subject/GC/final-clock/compatibility:15pass; with oauth-attempts/browser-flow38pass (4.07s), typecheck pass. See QA-AUTH-GUARD-INVENTORY.md and QA-SESSION-GENERATION-MIGRATION.md.
- Independent actual Chromium HTTPS:5/5pass (2.6s), typecheck pass, final hashes in QA-SESSION-GENERATION-BROWSER.sha256. The server holds A after real session INSERT before headers; after B completes, actual browser Cookie overwrites but real session/private access rejects401. Explicit B login restores authority. Actual AccountSessionLab removes hidden old inputs and waits for explicit continue. Context logout, other devices and retained expired context are covered. Synthetic provider; not actual Google or physical-device evidence.
- Root final frozen-source checks: build/typecheck pass; `npm test`58files/496passed (16.06s); public Playwright60passed (12.1s); editor Playwright164passed (3.4m); deploy dry-run pass. New dedicated auth-browser CI step excludes that suite from public catalog tests. Tailwind source scanning is restricted tosrc so test HTML/docs cannot add production utilities; public behavior regression passed.
- Earlier local editor failures were two superseded deletion assertions, then one held stream interrupted by Worker hot reload while source was edited. Trace showed ERR_INCOMPLETE_CHUNKED_ENCODING during the5-second response spanning the source mtime; UI safely concealed as unavailable. The final fixed-source164 rerun passed with the original mismatch assertion retained. No retries or skipped tests in the final run.
- Main/source gate remainsfalse; runtime binding/config cannot open it. No operational credentials/keys, Google connection, production/preview schema/settings/data, deployment or denied Issue retry. PR/main CI results are separate from these local evidence records and must be confirmed before merge.

Cycle49 artifact boundary: the first PR runtime CI passed496/60/5/164. Automatic artifact collection is kept at the previously approved public-preview paths; local editor/auth traces remain withheld, as DEPLOYMENT.md requires. The follow-up changes only those artifact paths and this record, not the reviewed runtime source; its exact-head CI must also pass before merge.

## Cycle51 — local admission and explicit retention preparation

[Local admission contract](LOCAL-ADMISSION.md) and [authentication maintenance](AUTH-MAINTENANCE.md) separate verified pending receipt, explicitly authorized review and withdrawal, capability cleanup and account/audit retention. All new authority is server-private and source-gated; migrations0013/0014 prepare schema without provisioning a role or running remote SQL. Production and sample UI are unchanged. Exact independent checks and final results follow in the cycle QA records; provisional design is not a live approval or authentication/privacy claim.

Independent [admission QA](QA-LOCAL-ADMISSION.md):26passed/3files4.05s and typecheck; [maintenance QA](QA-AUTH-MAINTENANCE.md):28passed/3files6.68s and typecheck. A reproduced legacy cascade deletion was corrected and independently rerun, preserving unexpected application references. Final root full unit/Worker regression:63files/535passed18.16s; public60passed11.7s; existing real-Chromium synthetic auth5passed4.8s. Full14 local migrations applied through the actual runner with sample-row preservation, FKcheck empty and reapplyno-op; local D1 integrity_check is unsupported, not a pass. These remain local/synthetic results.

Independent [admission QA](QA-LOCAL-ADMISSION.md) passes26 cases, including9 independent regressions and correction of unsafe legacy cascades. Independent [maintenance QA](QA-AUTH-MAINTENANCE.md) passes28 cases including3 independent additions. Final local535unit/Worker tests,60public and5auth browser cases passed; existing public assets retain the same filenames/bytes. Full-chain local migration rehearsal remains private workspace evidence, not remote migration proof.


## Cycle56 — purpose-bound Authorization proof transport

[Current contract](AUTH-PROOF-TRANSPORT.md) replaces application custom command/CSRF header values with a shared exact Bearer purpose grammar. Old/mixed credentials have no fallback; current Cookies, Origin, action/generation, CSRF and final SQL rules remain authoritative. Parser and actual-D1 regression tests supplement existing suites. Source-only preparation does not establish all-platform log secrecy or activate authentication. Final checks and independent QA are recorded separately.

Developer verification: build/editor build/typecheck/diffcheck/deployment dry-run passed;65unit/Worker files560tests passed19.89s; public60passed10.3s; synthetic auth browser5passed5.8s; editor164passed3.5min. Public browser tests initially failed against an uninitialized new-worktree local database, then passed after the existing synthetic fixture initialization with no assertion or tracked configuration changes. Independent QA14files/116tests and typecheck/diffcheck passed. Production authentication remains closed; hosted log secrecy and real-user acceptance are not established by these local results.
## Cycle57 — floor backlog fixture setup

Post-merge CI timed out one subject-floor backlog test at5000ms (559other tests passed). Replaced1000 client-prepared fixture INSERTs with one recursive SQLite statement, retaining exact row values, workload, assertions and timeout. No runtime, schema or configuration change. Local build and full560tests/65files passed15.60s; independent28tests/3files passed3.70s and full1000-row equivalence passed. PR and corrected-main CI must be checked separately; do not deploy while they are unresolved.

## Cycle59 — pending-only pilot

One private selected identity and finite policy window are required in addition to complete Google configuration. Normal login remains source-gated. New synthetic D1/JOSE cases cover wrong email, deadline before callback and after verification, incomplete configuration, closed general routes and accepted pending without session. One Chromium journey uses the actual pilot UI and fictional provider responses. No real email, subject, token or operational policy is included in repository evidence. Final local/independent results follow.

Cycle59 Developer local results: full66unit/Worker files565tests passed16.87s; focused pilot+existing OAuth15tests passed745ms; actual Chromium synthetic pilot1passed1.6s. Typecheck, public build, diffcheck and deployment dry-run passed. The initial browser fixture used an incorrect trigger splitter; reusing the existing statement-marker semantics corrected setup, without relaxing product guards. These are fictional local results, not an actual school-account acceptance claim. Independent QA and normal CI remain separately required.

Pilot routing follow-up: `/api/auth/pilot` and its external JS run inside the existing `/api/*` worker-first assets rule, before the generic auth handler. A local actual-production-entry browser check loads the configured static asset SPA fallback, then the pilot, and completes after a pre-existing context/bootstrap409; command issuance still validates that context. Late canonical GET callbacks after policy expiry/removal clean-redirect without DB/provider access. Other disabled factory and general route contracts remain closed.

Final routing/recovery verification:66files566unit/Worker tests passed17.75s; focused16passed661ms; production-entry plus configured static assets/SPA/worker-first Chromium flow1passed1.5s, including pre-existing context retry. Typecheck/diffcheck and refreshed deployment dry-run passed. Earlier565 count predates the added removed-policy callback case. Two legacy production callback assertions were updated to require the new explicit no-policy clean303 while preserving no DB/provider/Cookie behavior and closed405 for all other routes.

## 本人限定下書きの削除 — 開発側のローカル検証

2026-11-08、main `6bcfe8f`を基点に `feat/private-draft-deletion` で実装。npm ci後、public build/typecheck成功。`npm test`は70 files /602 tests成功（20.54s）。`npm run test:limited`は40 cases成功（34.0s）：既存30件と新規PC/mobile各5件。新規ケースは削除確認・キャンセル・他下書き保持・未保存入力・競合後の新版再確認・確定後の不正acknowledgement・一覧不在で成功を推測しないこと・期限／取消で削除せず閉じることを含む。client単体はDELETEのCSRF・版・厳格DTO・10秒EOF timeoutと非再送も確認。

画面証拠は架空データのローカル `test-results-limited` 内だけに保持し、公開しない。Chromium viewport emulationであり、実学生・物理スマホ・実Google・本番での削除の証拠ではない。試用grant／期限／設定／schema／server認可は未変更。最初のtypecheckは依存未導入でtsc不在のため失敗し、npm ci後にbuild/typecheckを実行して成功した。

impeccable detectorは既存CSSの2件の側面border警告を報告した。変更で追加した削除領域には該当せず、今回の範囲外の既存スタイルは維持した。独立QA・公開E2E・dry-run・CI結果は実行後に追記する。

追加結果：`npm run db:local`成功後、`npm run test:e2e`は60件成功（10.9s）。`npm run deploy:check`成功。独立QAは隔離build/typecheck、関連4 files /46 tests成功（1.98s）、PC/mobile16 browser cases成功（15.9s）。追加QAは503、確定済みDELETE遅着中のsession変更、200文字題名と非表示境界を含む。[独立報告](QA-PRIVATE-DRAFT-DELETION.md)に最終ソース指紋を記録。通常CIとmain反映・本番反映の結果はPRへ記録する。

### CIで見つかった削除後focusの競合

PR #97の初回CI `42437892754` はlimited browser38成功／2失敗。PC/mobileとも削除成功後の「新しい下書き」focus assertionが失敗した。削除後のrequestAnimationFrameがbusy解除のDOM反映より先に実行される可能性があったため、削除完了refを、下書き消去・opening解除・busy解除後のlayout effectで消費してfocusするよう修正した。待機時間・assertion・retryは変更していない。

修正後の開発側 `npm run test:limited` は40成功（30.4s）。限定削除以外のserver／guard／schema／policyは未変更。初回CIの失敗を成功扱いにせず、独立の追試と新しい通常CIを待つ。

修正後の全unit/Workerは70 files /602成功（15.18s）、build/typecheckとdeploy:check成功。独立QAはfocus差分を静的レビューし、隔離build/typecheckと、変更していない成功・キャンセル・キーボード・他下書き保持のPC/mobile2ケース成功（4.8s）。最終DraftEditor指紋を独立照合し、阻害所見なし。共有editor181成功／1既存skip（3.5m）はfocus修正前の結果で、限定削除以外の共有編集へ新しい動作を追加していない。通常CIが最終headの全体を確認する。

## 本人限定試用の撤去 — 開発側検証

ユーザーの明示した撤去範囲に沿い、専用UI／client／起動／build／production接続を除去し、旧パスの拒否と共有機能の維持を検証する。旧試用の成功テストを消したままにせず、stale設定・Cookie・静的ファイルとSPA fallbackを含む拒否回帰へ置換する。

開発側build/typecheck成功。全unit/Workerは68 files /585 tests成功（17.88s）。専用の撤去後Chromium検証はPC/mobile8 cases成功（3.7s）：旧page404、実際のASSETSに残した架空旧JSの拒否、一般SPA fallback維持、公開一覧→記事→投稿者、旧Cookie／設定によるprivate/auth拒否、遅着callbackのclean redirectを確認した。実本人のGoogle・本番書込み・本番設定変更の証明とは別である。

ローカル画像・実運用値は公開しない。独立QA・共有editor・公開E2E・通常CIと本番の実施結果は実行後に記録する。

独立QAは隔離build/typecheck、関連7 files /67 tests（2.08s）、追加の設定getter非参照1 test（95ms）、PC/mobile10 browser cases（3.4s）を実行して成功。開発側8件に加え、エンコードしたprefix・slash・繰返しslashのGET/HEAD拒否を確認した。4画像を目視確認し、17ファイルの指紋を照合、阻害所見なし。[独立報告](QA-RETIRED-DRAFT-TRIAL.md)。開発側公開E2E60（10.8s）・deploy:checkも成功。実際のgrant/session/binding除去と配備は、このローカルQAとは別に確認する。

開発側の共有editor回帰は181 passed／1既存skip（3.4m）、auth browser5（2.5s）、pending pilot1（1.4s）が成功。generated typesに差分なし。独立にレビューした対象限定のruntime撤去手順で、本番の専用grant／既存sessionの失効、専用binding除去を実施し、配備中versionのbinding・他設定・asset経路の保持を照合した。本文・認証情報・試用設定値は取得／公開していない。実URLでは旧entry・既知の旧JS/CSS404/no-store/no-cookie、private/login GET405/no-cookie、health正常と架空catalog4件／2プロフィールを確認した。これはソース配備前のruntime閉鎖の結果であり、専用コード・assetsの配備上の撤去はgreen main後に別途記録する。

## 制作ノートの具体化 — ローカル準備

- 実装commit: `001a9a8765692ead688814b34a2aeab0b947486c`、base main9076294。公開sampleの本文・説明metadataと明示editorial/rollback SQLだけを変更し、既存migration・auth・schema・本番設定は変更しない。
- Developer実行: `npm run build`成功、`npm test`68files／587passed（15.73s）、`npm run db:local`成功、`npm run test:e2e`PC/mobile Chromium60passed（11.1s）、`npm run deploy:check`成功、`git diff --check`成功。
- 実D1テスト: sourceと配信DTOの全公開値一致、初回1件／再実行0件、旧値の各変更・非公開・non-sample保護、他行保持、明示rollbackと再適用を確認。これは架空ローカルデータの動作確認で、実学生の理解や学習成果ではない。
- 公開本番のread-only確認では、対象本文SHA256が既存の閲覧開始時baselineと一致、4samples／2profilesを維持。remote SQL／デプロイは実行していない。public E2Eが自動起動したroot8787のserver・子process・listenerは終了を確認した。
- [PR #99](https://github.com/junhat6/kobe-student-hub/pull/99)はDraftで準備。独立QAとCIの最終結果は追記する。ローカルの画面確認を実端末・学生価値の証拠へ置き換えず、私的回答をこの記録へ転載しない。

**別コンテキスト独立QA（同実装commit）:** 隔離archiveのbuildと実Worker/D1関連9testsが成功。別のSQL読取レビューと補足SQLiteで、forward／rollbackそれぞれ全15列の単独変更（合計30条件）が更新0件・変更値保持となることを確認。これはD1テストの代替ではなく補足検証。

実ローカルWorker/D1とChromiumのPC1440×1000／iPhone13相当390×664の2contextsで、各12受入群（計24）を確認。架空notice、冒頭結論、記録の目的、記入例、説明例、未確認の区別、次の一歩、metadataと全DTO一致、記事→著者→記事→関連作品が成功。各9地点（計18）でdocument横overflowなし、pageerror0。7行のtext記録枠は改行込みで実clipboardへ完全コピーし、手動選択fallbackも全項目を保持した（native選択文字列の末尾改行省略は区別）。

画像20枚を独立担当がすべて目視確認し、実装者も記入例PC／mobile続き／mobile選択画像の3枚を確認。画像とmachine reportはローカルだけに保持し公開しない。QAの18787 serverはarchive内の専用PGIDを子processごと終了し、group生存0・listenerなしを確認。実スマホ／Safari、実学生の理解・実践、実Google／投稿はこのQAで検証していない。

Source照合SHA256:

```text
src/sample.ts d15ee67179983a5c32b04931d25bff6807c7cfc24269056e349b2cde4b896d18
content-revisions/0002_learning_notes.sql 02d630ceec3df792e84e67d278f6eb3e8d756b5a79fa7da2a97fe8248fd9060f
content-revisions/rollback/0002_learning_notes.sql b46f75d53b0dd21aa2c3d911fccbade78c95b1d52df54f876c223fc1fcba03d2
tests/worker.test.ts 9fa92c9b723601315fe13783be4a3213c52822984ef00e56a933411476673663
```

### 制作ノートの本番反映完了 — 2026-11-08

PR #99をmain `5177d957d5fbd70eea1c6fa1e48dc82250bda9c5`へ反映し、PR headとのtree一致を確認した。[PR CI](https://github.com/junhat6/kobe-student-hub/actions/runs/42448649434)・[main CI](https://github.com/junhat6/kobe-student-hub/actions/runs/42449180401)は全成功。両ログで68files／587unit・Worker、公開60、pilot1、retired8、auth5、editor181passed／1既存skip、types/build/localDB/dry-runを確認した。

同日05:14 UTCに、前回の検証済み配備記録と現在の接続先・公開domain・active versionを非公開で照合してeditorial適用した。旧行全15列と他sample/profile・runtimeを再確認後、レビュー済みSQLへ値を戻すとバイト一致する21値のparameterized statementを一度実行。変更1件、改訂行全値一致、他3samples／2profiles・全件数・settings/deployment指紋保持を確認した。schema/auth/secret/grant変更・Worker再配備はない。公開catalog全DTOはmain sourceと一致し、writesEnabled:false、別previewのcatalog指紋も保持した。

別コンテキストの独立本番QAは、明示GET16件、PC/mobile各11受入群、横overflow20地点、記録枠7行、記事→著者→記事→関連作品の往復が成功。画像18枚を独立担当が目視確認し、実装者も3枚を確認した。既存Cloudflare beaconのCSP拒否は厳密に分離し、pageerror・予期しないconsole errorはなし。全通信GETのみ、ブラウザー終了済み、サーバー未起動。画像と運用値は公開しない。詳細と再計画は[PR #99の最終運用記録](https://github.com/junhat6/kobe-student-hub/pull/99#issuecomment-6717645879)。実端末／Safari、改稿後の学生の理解・実践・就職成果は未検証のままとする。

## 学校Google本人確認と自己申告年度の通常参加準備 — 2026-11-08

[採用判断](adr/0001-self-declared-enrollment.md)に沿い、必須2年度を一回の学校Google認証へ結合し、account・私的年度・sessionを原子的に保存する通常登録を実装。本人の年度訂正と卒業後の整理を維持し、新規参加は最終SQLの保存値／server時刻で判断する。手動の在籍審査を必須にせず、自己申告を学校による在籍証明とは表示しない。

build・全74files/658tests・公開E2E60・editor197passed/既存skip1・auth browser・pending pilot1・retired8・deploy dry-runが成功。別コンテキストのwriter26件・登録27件・PC/mobileフォーム16件とSQL inventory29件に阻害所見なし。[実行結果、source指紋、限界](QA-SELF-DECLARED-ENROLLMENT.md)。一時serverと子process／待受は終了済み。

source gateはfalse、public writesはfalseのまま。remote0016/0017、credential／operator grant、production設定／配備変更は実施していない。通常signup入口・実Google／ログ・実端末・実運用の接続は未完了で、登録の離脱率や学生価値の改善も未実測。PR/main CIは実行後にPRの完了記録へ追記する。

## 通常の登録画面と本人の年度確認 — 2026-11-08

base main `4f3fe88`から、本体entryにsignup／login／accountを接続。必須の非公開2年度、一回の明示Google操作、JSON開始応答、固定clean account着地、現在sessionとguarded年度の確認、本人訂正／logoutを扱う。既存のsession境界を共用し、新しい本人限定試用やlabは追加していない。frontend visibilityとserver gateは既定falseのまま。

build・typecheck・76files/686unit、公開62、auth suite36（source gate確認2件を含む）、editor197passed/既存skip1、pilot1、retired8、deploy dry-runが成功。追加public testの見出し指定と旧JSON helperを修正し、各suiteを全件再実行した。独立transport49件、別担当の通常browser14件、独立browser12件に阻害所見なし。fresh visual reviewerは提示11画像の範囲で`ship`、documenterは既存DESIGNの継承を確認。[実行・失敗診断・source指紋・限界](QA-ORDINARY-REGISTRATION.md)。

実装者と独立担当が起動したserver／子processを終了し、全対象portの待受なしを確認。公開画像・私的回答・生ログの追加はない。remote SQL・credential／grant・本番設定／配備の変更は行っていない。実Google／実ログ／実運用、実BFCache／実端末、学生価値と離脱率は未検証。PR/main CIは実行後に完了記録へ追記する。

## 閉鎖プレビューの実ログ照合 — 2026-11-08

base main `37b07fc`、[PR #102の統合完了](https://github.com/junhat6/kobe-student-hub/pull/102#issuecomment-6719136341)とgreen CIを確認。既存の専用プレビューの実配備を固定し、実credentialを使わない6要求を一度だけ送った。health200／閉鎖auth405、全件Cookie発行・Locationなし。

既存権限でevents／calculations計4queryを2round実行したが、6件とも対応rowを特定できなかった。独立相関・full-row／関連ログ検査・canary不在の判定は未成立。ABR1や0rowを非保存・redaction成功と扱わない。service/type条件を外す追加照合も、一意controlのorigin/path・UUID・時間幅だけに拘束した。配備・version・settingsは前後一致し、mainの配備は推定しない。[方法、case表、指紋、独立QAと限界](QA-CLOSED-PREVIEW-LOGS.md)。

設定変更・配備・remote SQL・Tail接続・credential／grant変更は0。生ログ取得・保存も0件で、実ユーザーや実Googleの接続は行っていない。source gate・frontend visibility・public writesは閉じたまま、[実ログゲート](LOGGING-GATE.md)は未達。

別コンテキストのQAはledger／method／adaptiveの指紋と前後pin、時刻・未確認の解釈を照合し、限定的な結論に阻害所見なし。query完了・ページ不足判定と実row scanの未実証を明記した。QA後に一時ledger／probeを削除し、不存在を確認。sanitized結果とQA記録だけをlocal mode0600で保持する。文書差分と相対リンク156参照先の確認が成功。通常CIの正確な結果はPR完了記録へ残す。

## 既存controlのquery完了確認 — 2026-11-08

main `19323dd`、green PR/main CIとopen Draftを確認し、本番homeの架空sample4件・認証／投稿準備中をChromiumの実画面で確認した。確認tabは終了し、serverは起動していない。物理端末・学生価値の検証ではない。

前回controlに対する追加traffic0・query1回でCOMPLETED、dry/account/timeframe、inline parametersの意味上のechoと前後pin一致を確認した。row/count0、ABR1。事前条件adhoc=trueは確認できず、false／欠落の区別も失われているため、全受入条件未達で終了。相関・scan・関連取得・非保存の判定は未成立のまま。専用previewの日次usage集計の陽性も、今回controlや料金余裕の証拠にはしない。[再構成・取得条件・結果・限界](QA-CLOSED-PREVIEW-LOGS.md#既存controlのquery実行を確認する追試--2026-11-08)。

独立QAはmethod／結果の指紋と限定的な結論を照合し、阻害所見なし。sanitized結果・QA・capture前提の調査をlocal mode0600で保持した。実captureの設定変更・配備・schema・Tail・credential／grant変更は0、ログゲートは未達。次は契約・使用枠と復元条件を満たしたcaptureで一件の陽性相関を確認する。文書checkと通常CIの結果はPR完了記録へ残す。

## 技術選定と3項目の制作ノート — ローカル準備

base main `6812f1e`のPR/main CI成功とopen Draftを確認。架空sample一件を、AIと行う技術選定の条件・判断・確認、次の制作／作品説明への再利用へ更新した。[受入条件](LEARNING-NOTES-DECISIONS.md)。私的な回答や実学生の投稿は公開していない。

運営の参考実験は生成100万行／18,139,028bytes、同じSQL、DuckDB2.0.0／SQLite3.50.4／Python3.12.12、M4／16GiBで各3回。全96組の件数・合計が生成時の期待値と一致した。CSV→結果の中央値は0.06495／0.74118秒、取込済みtable queryは別範囲で0.01099／0.28344秒。起動/import・生成は計測外、cacheは未制御、メモリピーク・同時更新は未測定。DB全般の速度順位や学生価値は示さない。[コード・条件・全結果](../experiments/learning-notes-db-choice/README.md)。初回のCSV option指定誤りは計測前に修正し、目標・データ・SQLの順位最適化はしていない。

適用済みmigration／editorial0002を維持し、0003／逆操作で全15列の前提を比較する。実D1で旧0002と新0003の一件更新・再適用・各guard変更・後続編集／他row保持・逆操作を検証。local build、76files/687unit・Worker、公開62、localDB、deploy dry-run成功。一時public server（group25148・workerd25213・8787）はsuite終了時に子process／groupと待受の終了を確認した。

rootの画像確認でtableの行ラベルを短縮した後、最終source `927c015`でもbuild、全76files/687tests（20.17秒）、公開62（11.4秒）、localDBとdry-runが再成功。local sampleの全15列source一致、public runner終了、canonical workerd0・8787待受なしを確認した。

独立QAは最終sourceのbuild／実D1関連20tests・手動27cases、PC/mobile24群、native／fallbackコピー各4、overflow18地点、内側code scroll4点を確認し、12画像を実際に開いた。rootも最終代表5画像を確認。所有server6単位／browserは終了し、8897／9247待受なし。独立再計測はfixture／結果指紋と全96組一致で、元resultsを上書きしていない。[source・画像指紋、診断と限界](QA-LEARNING-NOTES-DECISIONS.md)。

本番preflightは既存の正確な対象と旧値15列、他3sample／2profile、配備版・設定をread-onlyで一致確認した。これは適用ではなく、actual apply直前のmain・対象・旧値再照合を条件とする。通常CIと本番の正確な結果は対応PRへ追記し、source準備だけで反映済みと扱わない。schema/auth/grant・Worker設定／配備の変更はこのeditorial単位に含めない。学生価値・実端末の検証は別に残る。

## 通常アプリから下書きの保存・再開へ — 2026-11-08

base main `fe97bbe`、Issue/PR/CIと公開本体を再確認し、PRDを読み直した。前turnの制作ノート改稿は[PR #105](https://github.com/junhat6/kobe-student-hub/pull/105#issuecomment-6720753283)で実反映・独立GET-only QAまで完了。PR #96/#84/#85はDraftを維持し、拒否されたDraft解除を再試行していない。通常のaccountから既存draft編集へ進めなかったため、[同じ処理を本体entryへ接続](ORDINARY-DRAFTS.md)する仮説を選んだ。

source `198eb4b`でbuild、77files／691unit・Worker（16.77秒）、localDB、公開62（12.2秒）、auth52（追加16＋既存36、1.7分）、editor197成功／既存skip1（3.6分）、deploy dry-runが成功。rootのpublic serverはgroup97821、editorはgroup3816の終了と8787／8788待受なしを確認。認証runnerも所有groupと8790待受を終了した。editorの自己署名TLSのCertificateUnknown出力は別に存在し、試験成功を全server log無エラーとは表現しない。初回auth試験のcancelled reload待機、PATCHのintercept指定、signed-in時の再登録driverを補正し、製品の保護や判定を弱めず全52件を通した。

別worktree／contextの独立QAは関連15tests（6.36秒）、追加HTTP5群、PC/mobile12群を成功。年度missing／将来／終了時のowner read維持・write拒否、本人／CSRF／Origin、実commit後のACK・EOF遅延とsession変更／競合の組合せを確認した。成功12画像を担当者自身が開き、source／test／fixtureの21指紋とhelper／画像をprivateに保持。[独立QA・注入方法・診断・限界](QA-ORDINARY-DRAFTS.md)。

fresh visual reviewの2点だけを通常variantに限定して修正した`cf7035a`は、API／router／認証／状態遷移の変更がないことを独立QAが照合。最終18件（通常16＋capture2、43.2秒）と保存・空・復旧6画像が成功し、実装担当とfresh reviewerが全画像を開いた。verdict passは2指摘をresolved／`ship`と採点した。mechanical detectorは最初の一回のみ、8対象で指摘0。rootも修正後代表2画像と独立代表2画像を確認。画像・proof・運用値・私的回答の公開はなく、sourceのデザイン体系は継承した。

一般のfrontend表示とOAuth／draftのsource gateはすべてfalse、sample-onlyの公開境界を維持する。実Google・実ログ・実運営・学生価値・物理端末は未完了で、新しい本人限定試用やlabを追加していない。実配備のread-only preflightでは既存対象・設定・sample4件／profile2件と記事0003の一致を確認したが、配備完了とは扱わない。PR/main CI・実配備・本番GET-only独立QAの正確な結果は、[PR #106](https://github.com/junhat6/kobe-student-hub/pull/106)の完了記録へ残す。Worker配備にremote SQL／schema・権限・credential・契約変更を含めない。

### 既存作品探索のCI timeoutと診断改善

初期`198eb4b`のCI42476053169は全成功。同じ既存mobile作品探索ケースは1.5秒で成功したが、`1acd561`のCI42477089261では30秒timeoutとなり、finallyのcontext closeがprotocol errorを報告した。actual件数は77files/691unit、公開62・pilot1・retired8・auth52成功、editor196成功／1失敗／既存skip1。merge・deploy・remote変更・CIの単純再実行を止め、job logと取得可能artifactをprivateに保存した。artifact対象は公開用test-resultsだけで、失敗editor caseの画像・traceは含まれず、未閲覧の状態を推定しない。

独立diagnosticで元caseをPC/mobile各1回実行し、全privacy assertionsと各6本のallHeaders、context終了まで成功。9関連ファイルの指紋は両headで一致し、元CIの停止箇所・原因は未確定のままとする。改善はtest-onlyで、段階名、5秒のheader検証、drain中の追加要求を含む明示観測窓、primary errorを覆わないcleanupとした。クリック順序・元assertion・30秒の全体予算、製品code・CI保護・artifactの公開範囲は変更していない。

最終diagnostic source`3976eea`の独立focused6件が成功。private fault5件はすべて意図どおりFAILED／runner exit1で、pending headerは5秒のheader step、Cookie／CSRFと遅い追加batchのCSRFも同stepで失敗した。primary UI失敗＋secondary cleanup失敗では元の失敗を保持した。これらは検出機能の注入試験であり、元CIの再現や原因解明とは扱わない。[独立QAの追補](QA-ORDINARY-DRAFTS.md)。所有runner・context・server子processと8788待受を終了し、製品codeの修正根拠なしを維持した。新headのCIが実際に成功するまでは統合・配備しない。

### 通常下書き接続の最終CI・本番配備

その後、最終head `915b1fc`の[PR CI](https://github.com/junhat6/kobe-student-hub/actions/runs/42479509821)とmain `d0b4cb7`の[CI](https://github.com/junhat6/kobe-student-hub/actions/runs/42480436122)は成功。両runで77files／691unit・Worker、公開62、pilot1、retired8、auth52、editor197成功／既存skip1、types／generated差分／build／localDB／deploy dry-runを確認した。Workerは2026-11-08 12:50:01 UTCに一回配備され、SQL／schema、認証の有効化、収集率・WAF、credential／grant／契約は変更していない。

独立本番QAはPC/mobile18群、公開DTO4件／2人、配信JS/CSS12個のarchive byte一致、copy4、overflow28、閉じた通常route8確認と旧試用2URLの404を確認。12画像を独立担当が開き、rootも代表3画像を確認した。既知beacon CSP拒否10件とunexpected console／page error0を区別した。取得条件によるHTML raw不一致を保持し、現行公式のmodule beacon参照一個とタグ間空白を除くcanonical一致を別に確認した。設定・binding metadata・D1と別プレビューの指紋は不変。所有する一時server／browser・子process・待受は終了した。[配備・独立QAの完了記録](https://github.com/junhat6/kobe-student-hub/pull/106#issuecomment-6721917824)。

## 設定不変の新しい一要求とstored logの相関 — 2026-11-08

base main `d0b4cb7`、main CI成功、PR #96／#84／#85のOPEN・Draftを再確認。PRDを再読し、本番の公開導線4群と4件／2人サンプルを通常ブラウザ操作で再確認した。終了commandのsecondary error1件をrunner exit1のまま保持し、所有browser・子process・待受が終了したことを別に確認。UIのunexpected console／page error0と、helper全体の成功を混同しない。画像3枚を独立担当、うち2枚をrootが開いた。

旧対照の実値は保持資料に残っておらず、同じ検索は再実行しなかった。新しい方法は、querylessな非secret対照一件の完全URLを、二つのURL fieldの単一`in`で取得前から拘束する。独立offline11契約で実通信0のまま方法を確認し、HTTP直前の版・設定照合を実行条件とした。収集率や設定変更、実認証の開放は含めない。

新対照のHTTPは一回だけ実行し、405・閉鎖JSON・Cookie／Locationなしを確認。固定窓のdiscovery一queryはCOMPLETED、dry／account／timeframe／semantic echo一致、result／runの明示ABR1でrow／reported countとも0だった。規定どおりrelated query・追加要求・再送は0で終了。HTTP前／query前／終了時のdeployment・version・settingsは一致した。試験本体はmetadata GET6、rootの予備read2は別に記録した。

陽性invocation・実row scan・敏感な入力位置の検査は0であり、0件の原因や秘密情報の非保存は判断できない。独立事後QAはledgerからHTTP段階とquery条件の指紋を再構成し、30確認成立。初回QAの別々のclock値への過剰な同値期待一件は履歴を残し、正しい呼出順・同window内の判定に訂正した。運用結果の変更・追加通信はない。実行結果と有限保持ledgerの指紋をprivate0600に保持し、HTTP／claimのNodeとCloudflare実行cellは終了。local server・Tail・設定変更・配備・SQL・credential／grant作成は0。ledgerの固定24h期限は2026-11-09 13:44:26.830 UTCで、自動削除は未導入、root所有の明示cleanupが必要。[方法・実結果・独立QAと限界](QA-LOG-CONTROL.md)。
