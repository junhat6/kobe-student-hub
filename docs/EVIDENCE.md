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
