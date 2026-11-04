# Current work and replanning

## Cycle 01

**Planner:** H01 — reader context plus author/project relationships can help a student choose an article and carry away a next action. Minimal target: browse → article/project → author/related, on mobile and PC. Fictional data only.

**Developer:** Implemented React/Vite + Hono/Workers + D1, search/tag/type filters, detail context, safe Markdown, profile/related navigation, loading/error/empty states, sample-only read boundary, security headers, design guide, migrations, tests and CI/deployment scaffolding.

**Independent QA:** Separate task/context reviewed code and operated macOS Chrome. Findings Q01–Q04 were fixed; report in QA-INDEPENDENT.md. See EVIDENCE.md for final build/E2E and screenshot evidence. Student value testing is not completed.

**Result:** Local discovery behavior verified. Remote Cloudflare setup is blocked, not deployed. Repository source and CI are the handoff, with deployment guard active until real IDs/access are supplied.

## Next priorities

| Priority / task | Acceptance / boundary | State |
| --- | --- | --- |
| P0: resolve preview infrastructure | Specifically authorize new D1 resource/cost implications; use least required access; deploy only new resources; verify literal returned URL/headers/API | Dedicated preview deployed and independently verified; standalone CI deploy activation pending |
| P0: school identity and privacy foundation | Server-side Google identity/verified domain checks, opaque sessions, CSRF, private data model, no automatic name/photo publication, ownership and graduation tests | Verifier/one-time boundaries and authorized remote attempt schema prepared; live OAuth/session settings pending |
| P0: real publishing safety | Private drafts and media, author editing, unique-reporter three-person temporary hiding, protected operator recovery/deletion, failure-safe email outbox and contact/appeal path | Planned; never enable real posting before this gate |
| P1: authoring across devices | Markdown assist + preview, explicit publish, optimistic concurrency, autosave status and safe recovery; image/YouTube policies before enabling | Planned |
| P1: public likes, private history, recommendation | Correct privacy boundaries and deletion; real counts only; simple explainable tag/newness logic | Planned |
| P1: IT-student trial | Recruit an agreed small group and initial content; verify discovery/next-action usefulness on real devices; record consent-safe outcomes, not private data in public issues | Not run |
| P2: search growth / editor media / Safari | Pagination/indexed search before >100 entries, iOS Safari physical device, Mermaid sandbox and upload controls | Planned |

## Decisions still needed before real release

Operator and actual support contact; school relationship and publication rules; graduation-year boundary and exceptions; identity recovery/deletion after loss of school account; history retention; media size/type limits; exact operational email delivery; trial participants/content and expansion criteria; cost ceiling and actual account plan. Implement reversible internal choices autonomously, but do not silently widen publication or identity scope.

## Working protocol

Keep current tasks and evidence in GitHub Issues/PRs. Do not paste student feedback, emails, school identifiers or authentication data into this public repository. A user-request intake in the eventual app must be private to the requester/operator by default; public Issues are currently for development tasks only. Do not create endless autonomous loops or automatic paid agent runs; update this plan from evidence and take one bounded cycle at a time.

## Cycle 02 — reader-context card comparison preparation

**Planner:** H02 asks whether showing prerequisite knowledge and reading outcomes before article selection helps students choose a suitable article. The originator's adopted E08/E23/E24 experiences are one person's input, not validation with other students. Reading-time cues may signal both a short read and a longer, more detailed article.

**Developer:** `/study/cards?variant=a|b` renders the same three fictional articles in the same order. B alone adds prerequisite/outcome fields. Normal home cards are unchanged. The study is linked from `/about`, not presented as an adopted product improvement. No response intake, selection-event collection, personalized ranking or editor was added. [Plan](CARD-STUDY.md) includes neutral prompts, order/memory effects, sample limitations and private handling of any later responses.

**Independent QA:** Separate context re-executed four mobile-viewport tests including study switching/back, study API 503/retry, general API outage/about, deep links/malformed route/overflow. See [QA-CARD-STUDY.md](QA-CARD-STUDY.md) for exact execution and browser evidence, plus [EVIDENCE.md](EVIDENCE.md).

**Replanning:** Do not adopt B based on AI checks. Agree the small voluntary student trial and private recording method, then compare reasons for choosing, expected vs actual content, reselection and scanning burden. Keep both negative and positive observations. Cloud resource setup remains a separate pending task; this cycle does not retry it.

## Cycle 03 — school identity boundary, not sign-in release

**Planner:** Take a narrow dependency of #4 while remote setup is pending: real server-side Google token verification and active-owner-only private-record policy. Check open work first; do not overlap another PR or create live OAuth/permissions/resources.

**Developer:** Added JOSE RS256/fixed-Google-JWKS verification, issuer/audience/presenter/time/nonce/verified hosted-school checks, minimal private identity projection and pure owner policy. Tests use real ephemeral RSA signatures in Node and the same verifier in Workers. Production routes/session issuance/posting are unchanged and closed. [Design and remaining gates](AUTH-BOUNDARY.md).

**Independent QA:** A separate reviewer rebuilt the verifier and production Worker bundles and independently passed 32 tests (28 identity/owner plus four production denial/data-boundary cases). It verified the stateless nonce limitation and reviewed the design wording. [QA report](QA-AUTH-BOUNDARY.md).

**Replanning:** #4 stays open. Next are authorized OAuth configuration, one-time attempts/PKCE/state and session lifecycle, then stored-owner endpoint integration and enrollment rules. Authentication, privacy and moderation gates must all be met before real posting. Cryptographic fixtures are not live Google sign-in, actual current-student verification or student usefulness evidence.

## Cycle 04 — one-time attempts and callback-log gate

**Planner:** Prepare an atomic attempt-consumption dependency of #4, without connecting real callbacks. Check open work before starting; no overlapping open PR was found.

**Developer:** Added a private transient D1 table and unconnected store, fresh 256-bit values, state/browser digests, single conditional UPDATE RETURNING, 10-minute validity and bounded explicit expired-row cleanup. No cleanup scheduler or ten-minute retention guarantee. Test-only composition uses the stored nonce with the real signature verifier. [Scope/limits](OAUTH-ATTEMPTS.md).

**Release gate:** [LOGGING-GATE.md](LOGGING-GATE.md) requires actual platform settings and log inspection before a callback is connected. No real leakage is claimed; an app-only logger check or sampled absence cannot prove privacy. Production routes/UI/config remain unchanged.

**Replanning:** #4 remains open: secure browser/state/PKCE transport, code exchange, session/CSRF, actual log verification, cleanup/retention operation, enrollment and private-endpoint integration are still pending. Do not reset a consumed attempt to recover from an ambiguous or failed callback; start fresh.

**Cycle04 independent QA:** A separate context re-bundled the fixtures and passed 14 tests (10 attempts + four real-app negative/data-boundary cases), including concurrent consumption and real-signature composition. [Report](QA-OAUTH-ATTEMPTS.md). This does not close the real OAuth/session/logging release gates.


## Preview deployment handoff

The [sample preview](https://kobe-student-hub-preview.ideaboost-whiteboard.workers.dev/) was initially deployed from verified main 6e82dfb, then updated to main 10a9ff4 using the Worker-only release path. These are release history, not a live assertion about every later deployment; subsequent releases are recorded in their merged PRs. Dedicated resources and existing authorized connections were used. [Independent deployed HTTP/Chrome QA](QA-DEPLOYMENT.md) passed; real login/write routes remain closed. Public catalog is four fictional entries and two fictional profiles. Current ongoing-deployment procedures/settings are in DEPLOYMENT.md; GitHub-only automatic deploy is not activated and no new persistent credential was created.

R2/image work is a separate next stage in MEDIA-PLAN.md. No paid upgrade or R2 subscription was accepted. Prefer existing/free allowances; exact activation/payment/usage conditions require the applicable confirmation.

Remote auth-state migration 0003 was subsequently applied under new explicit user authorization and verified (see Cycle 10 and QA-AUTH-MIGRATION.md). It was not part of initial bootstrap and is never an implicit deploy step. Do not replay/reset it. Worker-only deployment remains separate from remote SQL.

## Cycle 05 — body-load failure recovery

**Planner:** #13 addresses a bounded reliability gap: the deferred Markdown module can fail to load while the catalog and navigation are available. Preserve the article's context and give the reader a recovery action. No additional data collection or real publishing is involved.

**Developer:** Added a body-only React error boundary. A failed module/render displays an accessible explanation, full-page reload button and link to explore other articles. Reload deliberately creates a fresh document/module cache after a rejected lazy import; it is not a claim of in-place import retry. Header, summary, reader context and related navigation remain outside the boundary. The boundary resets for a different article ID, but a rejected shared lazy module still requires a page reload.

**Verification:** Failure-injection browser tests cover a 503 for the actual production Markdown chunk, context visibility, navigation away/back, removal of the network failure and successful reload, with desktop and mobile viewport screenshots. [Independent QA](QA-BODY-RECOVERY.md) separately passed both viewport tests and visually inspected four screenshots, with no merge blocker. Root build, 59 unit/runtime tests, 20 E2E and deploy dry-run passed.

**Replanning:** Keep #4/#12 blocked remote actions separate. Real OAuth, remote migration 0003, R2 activation and student trials remain pending. AI recovery checks do not establish student usefulness or physical-device compatibility.

## Cycle 06 — article and author combined search

**Planner:** #15 fixes an existing discovery bug, unrelated to PR #14: `Git` and `サンプルの先輩` match individually, but their combination failed because all terms had to be found entirely in content or entirely in a profile.

**Developer:** For each entry, combine its existing searchable content fields with only its corresponding author's public name/department, normalize both stored data and query with NFKC/lowercase, then require every query token to match. Kind/tag intersections and descending updated-date order are preserved. No additional profile fields, private fields, body indexing or cross-entry matching are introduced.

**Verification / replanning:** Regression cases cover mixed-field AND, word order, full-width stored author/query values, other-author/other-entry exclusion, filter intersection, date order and missing profiles. Browser tests enter the mixed query, apply kind filters, try the wrong author, reload/back and open the result. [Independent QA](QA-COMBINED-SEARCH.md) separately passed 10 catalog tests and both form-driven browser cases, visually inspected four screenshots and found no blocker. Root build/64 unit-runtime tests/22 E2E/deploy dry-run passed. Student value validation remains unrun. The remote auth migration and R2 activation are independent pending actions.

## Cycle 07 — continue exploring from the same list

**Planner:** #17 addresses reproduced loss of search conditions when the article's return link always points home. The hypothesis that retaining context improves continued exploration is unvalidated with students. Open work was checked before starting; no overlapping PR was found.

**Developer:** Public card URLs carry an allowlisted list target; explicit article/project return preserves filters. Same-tab list snapshots and a bounded ephemeral view map restore card focus/position and recent browser history. New-tab/direct paths have safe fallbacks. Related content only inherits a real list snapshot, never an article's scroll offset. [Boundaries](LIST-RETURN.md).

**QA / replanning:** Final root build/68 unit-runtime tests/30 E2E/deploy dry-run passed. [Independent QA](QA-LIST-RETURN.md) separately passed four unit and eight browser cases, visually inspected four screenshots and found no remaining blocker. An initial new-test locator omitted the arrow in the link's accessible name and was corrected; it did not establish product failure. Independent review identified the no-snapshot related-navigation edge, which was fixed with regression coverage. Keep student value and physical-device validation distinct. No remote authentication migration, R2 activation or paid contract is part of this cycle.

## Cycle 08 — from reading to local code practice

**Planner:** Compared real publishing, Markdown authoring/preview, image/video use and further card-study work against E23 and the pending gates. #19 selects a current reader action rather than another preparation screen: explicitly copy the displayed code for a practice environment. [Comparison and unvalidated H03](CODE-ACTION.md). Open work was checked; no overlapping PR existed.

**Developer:** A code-block toolbar copies only the displayed pre text, reports success after completion, and offers full-range manual selection on denied/unavailable clipboard. Inline code and safe-Markdown restrictions stay intact. No real posting, storage, event collection, clipboard read or code execution was added.

**Evidence / replanning:** The initial manual-selection assertion incorrectly assumed Selection.toString preserved the last LF; it was corrected to verify the complete selected DOM range while leaving native clipboard behavior explicitly unclaimed. Review's 44px target-size adjustment was adopted. Final root build/68 unit-runtime tests/36 E2E/dry-run passed. [Independent QA](QA-CODE-COPY.md) separately passed six browser cases, viewed four screenshots and found no remaining blocker. Keep #5 student trial and real authoring/privacy/media gates ahead of extra prototypes; no AI test establishes student value.


## Cycle 09 — pending copy fallback and executable practice steps

**Planner:** #21 follows two concrete review observations: manual selection was hidden during unresolved writeText, and copying one mixed Git block did not perform its manual file edit. These affect the E23 action flow; no student value result is inferred. Open work/state/public assets were checked after the interruption notice: #21 was an Issue, no overlapping PR existed, main/deployment remained 9b325d6.

**Developer:** Manual selection is always visible and usable during pending writes. Pending disables only repeat native writes, does not claim cancellation, and late resolve/reject preserves manual guidance. Git sample separates branch, README edit, diff and commit, with explicit practice prerequisites. A guarded one-row content revision preserves immutable bootstrap history and leaves remote auth migration 0003 untouched. Remote editorial application is separate from Worker deploy and still must be verified.

**Verification / replanning:** Root final build/70 tests/38 E2E (16.2s)/dry-run passed. Exact article command blocks ran in a disposable /tmp Git repository with dummy identity, isolated config and hooks disabled: no manual edit caused expected nothing-to-commit; after the README edit, diff/commit succeeded with two commits and clean try-new-title branch. This is fixture operation, not a student practice/learning result. [Independent QA](QA-CODE-PRACTICE.md) separately passed six Worker and eight browser cases and the disposable Git practice, with four visually checked images and no remaining blocker. Remote/public release status is recorded in PR #22. The optional E23 observation now fits the existing #5 plan, without extra study UI or private-data intake. OS clipboard/physical iPhone remain untested; auth/R2 holds remain.


## Cycle 10 — authorized remote attempt schema, login stays closed

**Authorization / action:** The owner explicitly authorized adding the authentication-test table to preview D1 without deleting existing data. This schema addition does not enable login. The earlier rejected operation was checked as unexecuted, then retried exactly once with the new evidence. The unchanged 0003 table/index plus migration-ledger insert succeeded.

**Evidence:** Root reran all 70 local tests, captured before/after full published-sample/profile rows, total counts and old ledger rows, and confirmed exact preservation. The new table is empty; schema/index and ledger 0003 are present. Independent read-only remote and local-runtime QA are in QA-AUTH-MIGRATION.md. No remote attempt/credential/user row, endpoint, secret, permission grant or contract was created. The deployed Worker source remains 4d87f44; this follow-up is documentation only and is not another app deployment. Historical cycle/QA records below/above describe their own execution time and are superseded on this schema status.

**Next development decision:** #4 remains open. Next select the smallest coherent browser-bound PKCE/state/attempt + opaque-session/CSRF flow once the dedicated Google client/redirect/secure settings and relevant operator/enrollment/logging conditions can be verified. Technical local design is possible; table existence alone is not a reason to expose a callback or accept client identity. Real provider exchange, one-time lifecycle, session fixation/replay, stored-owner access and actual secret-bearing log behavior still require implementation/verification. Retention/cleanup is not automatic. This task does not authorize another persistent grant, real sign-in or posting. #5's read-only student trial remains available independently of R2; its value evidence is still missing.

## Cycle 11 — browser binding, PKCE and one-time callback claim

**Planner:** PR23 merged with successful main CI and no open PR. The owner permits progressing toward real login/posting. Choose the next coherent #4 safety dependency: bind existing attempts to a browser and PKCE, with request-origin checks before creating attempts. Real configuration/session/data/log gates still apply; do not equate a code claim with authenticated identity.

**Developer:** Added an unconnected server-only flow with strict HTTPS/client/key configuration, exact-Origin POST start, fresh S256 verifier/challenge, authenticated-encrypted Host cookie, bounded/duplicate-safe callback parsing and atomic attempt claim. Provider denial consumes once without reflecting details. No new remote schema, production key, provider credential, session, endpoint, account, permanent grant or contract was created. Production start/callback/write requests remain refused. [Design and limitations](BROWSER-FLOW.md).

**Validation / next:** Root final build/83 tests/dry-run passed; the unchanged production UI had 38 E2E pass in 16.8s before the later private-clock correction. [Independent QA](QA-BROWSER-FLOW.md) rebuilt fixtures and passed 29 relevant tests, verified public start/callback refusal and found no remaining blocker. Existing Worker binding-name-only inspection found only DB/ASSETS; no dedicated auth configuration was set by this task. The next real integration requires the dedicated Google client/redirect and secure key setup, then provider verification/session/CSRF/stored-owner lifecycle and actual logging gates before opening private writing. Do not use a client-supplied identity, encrypted attempt cookie or test-only JSON result as a session. The #5 read-only trial is independent and still unrun.

## Cycle 12 — opaque sessions and CSRF

**Planner:** After PR25, #26 selects the next necessary private-auth dependency without opening a test endpoint. Separate permanent Google configuration and logging/admission gates remain outstanding.

**Developer:** Added local-only private-account/session schema, fresh opaque tokens with hash-only storage, absolute/idle expiry, status epoch invalidation, current-session logout and same-origin/session-specific CSRF checks. Creation accepts only a trusted verified identity matching an existing active account; no account admission or production route was added. See SESSIONS.md. Migration 0004 has not been applied remotely.

**Independent QA / next:** Separate-context QA rebuilt fixtures and passed 18 relevant cases, identified and verified the correction of a domain-case/subject-contract mismatch, and recorded source hashes in QA-SESSIONS.md. Root's session-stage full run passed 95 tests/build/dry-run. Provider exchange is a subsequent integration with its own verification; these session results do not establish real Google/browser/log behavior or student value. Next connect the real signature verifier through bounded fixed-endpoint exchange in local tests, then evaluate configuration and operational gates before exposing login. Actual protected writes still require ownership predicates and mutation-time account checks.

## Cycle 13 — bounded Google exchange into private sessions

**Planner:** Select the next coherent #4 integration: consume a bound attempt, exchange only with Google, verify the real signature/claims, and create a session only for an existing active account. Dedicated configuration and operational gates remain prerequisites for a production callback; do not add fake login UI.

**Developer / review:** Added an unconnected server-private broker and local Workers/D1 fixture using ephemeral RSA keys. Initial integration found three failed success cases because Workerd rejects redirect:error. Switching to manual handling with explicit redirect rejection restored successful exchange while a hostile-redirect test verifies no second destination. Independent review also requested explicit stalled-response deadline coverage before acceptance. No remote schema, credential, account admission, endpoint or contract is part of this cycle.

**Final evidence / replanning:** Independent review's deadline concern was resolved with an explicit race over fetch/body acquisition, handled non-blocking cancellation and no identity/session side effects in the losing operation. Separate QA rebuilt fixtures and passed 41 relevant tests in 10.70s; source hashes and limits are in QA-GOOGLE-LOGIN.md. Root full run passed 105 tests in 10.94s, local-development migration plus 38 desktop/mobile UI regressions in 8.2s, build and deployment dry-run. No new user-facing flow or real Google/browser/log audit is claimed. The next activation dependencies are dedicated client/key configuration, actual logging verification, browser/controller lifecycle and student admission/operation decisions. Real posting additionally needs private drafts/media, ownership at mutation time and moderation. Avoid more disconnected feature scaffolding while these gates and #5 student trial evidence remain unresolved.

## Cycle 14 — private draft ownership and concurrent saves

**Planner:** After PR27/main CI success, checked open PRs (none), remaining work and latest PRD tab. Choose #28: private article draft persistence is a direct dependency of the requested PC/mobile authoring handoff. Existing pure ownership and session helpers do not protect stored records or stale concurrent saves. Full reporting would require notification/operator/appeal lifecycle and unresolved restoration policy, so do not implement a misleading partial publishing gate. See PRIVATE-DRAFTS.md.

**Scope:** A server-only local store using actual session/CSRF checks, final-SQL owner/live-session/epoch/expiry predicates, bounded drafts/list and optimistic version matching. No production routes, editor/autosave UI, publication, media, admission/graduation policy or remote schema/settings. The hypothesis that this supports later reliable handoff is not student-value evidence.

**Review in progress:** Independent design review requested a fresh timestamp after asynchronous hashing, a cheap bound before counting title code points, and a terminal-version deletion check. The implementation is being corrected before final acceptance; earlier targeted runs are not the final-source QA result. The final SQL checks read/list as well as mutations, and tests inject revocation between initial authentication and final statement. Unsaved client-text recovery remains the future UI's responsibility rather than a storage guarantee.

**Independent QA / final behavior:** The review corrections are applied. Update may increment only below the safe-integer ceiling; deletion still accepts the ceiling. Final tests cover timestamp ordering and status/epoch changes after initial authentication as well as revoked-session races for every operation. Separate QA rebuilt fixtures and passed 40 relevant tests in 10.75s; QA-DRAFTS.md records the source hashes and boundaries. Root final full117 tests passed (11.10s), build/deploy dry-run passed, and local migration0005 plus all38 existing PC/mobile regressions passed (8.1s). No production route or output asset changed.

**Replanning:** This closes only private storage authorization and stale-save protection. Before a real draft editor, provide authenticated controllers with bounded request parsing/no-store/private errors and UI that preserves unsaved text and handles conflicts. The list is deliberately capped at20 without pagination, not a complete cross-device draft-management experience. Dedicated OAuth configuration, real browser/log/admission/graduation conditions remain unresolved; real publication also needs moderation/notifications/appeal and private media. Do not infer current enrollment from active account status. #5 student trial still has no value evidence. Remote0004/0005 and all real credentials/settings stay unchanged.

## Cycle 15 — private draft HTTP transport

**Planner:** After PR29/main CI success, checked open work (no PR) and the remaining PRD authoring journey. #30 selects authenticated bounded HTTP transport and private error/cache behavior. A writing UI without this boundary would not provide real cross-device saving; another study prototype duplicates #5, and media/publication still have separate operational gates. See DRAFT-HTTP.md.

**Scope:** Unconnected handler factory with actual session/CSRF then final store authorization, bounded timed JSON acquisition, fixed private response headers and generic failure responses. Production routing/UI/schema/configuration remains unchanged; future UI must preserve unsaved text on all failures. No real OAuth/account/admission or publishing is introduced.

**Review preparation:** Root review requested fixed-buffer/chunk-count bounds instead of a byte-bounded but allocation-heavy chunk list, and a proper405 Allow header. Independent review additionally called for empty-chunk starvation, late-body/no-insert and session loss during body acquisition evidence. These are transport checks, not actual Cloudflare log/cache or browser-cookie validation.

**Final evidence / replanning:** Fixed-size2MiB buffering and a65536chunk work cap include empty chunks; read timeout/cancellation never runs a late store operation. Unsupported methods include Allow. The fixture explicitly gates account epoch change after initial authentication and before valid body delivery, proving final rejection without insertion. Independent QA rebuilt fixtures and passed41 relevant tests (6.46s); QA-DRAFT-HTTP.md fixes source hashes and distinguishes synthetic streams from real transport. Root final128 tests (11.15s),38 PC/mobile regressions (8.0s),build and deployment dry-run passed. Production code/assets stay unchanged.

The next user-facing authoring unit needs a real authenticated browser lifecycle and a UI that retains unsaved text, handles generic failure/conflict and manages more than20 drafts. This cycle does not manufacture a fake editor or relax production gates. Dedicated Google configuration, actual logs, admission/graduation/operations and remote0004/0005 remain unresolved. Publishing still requires private media and complete moderation/notifications/appeal; #5 student value evidence remains absent. No schema, secret, grant, contract or deployment was changed.

## Cycle 16 — visible local draft editing journey

**Planner:** After PR31/main CI success, checked open PRs (none) and the current PRD journey/Issues. #32 selects actual editing→preview→save→resume and failure/conflict recovery instead of another internal helper. A separate local HTTPS fixture can exercise real private HTTP/session/D1 without pretending Google login or publication is available. Source PRD remains unchanged; see EDITOR-LAB.md for alternatives and boundaries.

**Scope:** Reusable unconnected editor component plus isolated fictional-account browser environment. Manual saving, snapshot-safe pending edits, explicit conflict review/baseline update and unsaved-switch warning. No production entry/routes/assets, remote schema/settings/credentials or real publishing. The first browser QA will assess operation/appearance, not student value or physical-device handoff.

**Implementation and review:** Added the local editor, bounded/validated no-retry browser client, isolated HTTPS fixture/config/scripts and separate browser CI suite. Independent source review found a navigation/create response could overwrite text entered while loading; fields/helpers now freeze only for navigation, while saving permits new typing. Visual review found the negative-offset skiplink in full-page captures; clipped hiding keeps it keyboard-accessible without overlay. The uncertain-success path now explicitly confirms identical saved content without another mutation. These are tested corrections, not student-value results.

**Final evidence:** Root full134 tests (11.17s),38 existing public-preview PC/mobile E2E (8.0s),build and deploy dry-run passed. Independent QA explicitly rebuilt final editor assets and passed14 PC/mobile browser cases (13.1s), with9 source hashes and10 local app-only screenshots in QA-EDITOR.md (7 repository images;3 local images await individual public-sharing approval). Root visually inspected all10 final images as additional review. A stale-build QA run was rejected as final evidence and corrected by rebuilding; final screenshots are only from the verified run. The editor is not in production main or dist; source4d87f44 remains the actual deployed sample preview.

**Replanning:** The authoring flow is now locally reviewable, but students have not validated its value. Observe whether the mobile list-before-editor layout adds friction and whether explicit conflict recovery is understandable before optimizing it. Next real activation work must integrate dedicated Google/session bootstrap and identity-change/logout remount, enrollment/graduation/operations and actual logs/cache. Local Secure/HttpOnly cookie checks do not prove those. Autosave/crash recovery,pagination/deletion UI,media/Mermaid and publication/moderation/notifications/appeal remain unprovided. Do not connect fixture identity injection or expose a fake publish action; no remote0004/0005/settings,credentials,grants,contracts or deployment occurred.

**Evidence publication boundary:** Seven screenshot blobs were saved successfully. Public upload of04-explicit-recovery-mobile was denied because individual image-publication authorization was not established; that operation is not retried or redirected. This image and two unattempted05 images remain local, identified in QA-EDITOR.md. Code/tests and the seven successful images proceed independently. No image is represented as publicly saved unless its repository entry exists.
