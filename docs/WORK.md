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
| P0: school identity and privacy foundation | Server-side Google identity/verified domain checks, opaque sessions, CSRF, private data model, no automatic name/photo publication, ownership and graduation tests | Internal verifier/one-time boundaries prepared; live OAuth/session settings pending |
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

The [sample preview](https://kobe-student-hub-preview.ideaboost-whiteboard.workers.dev/) was deployed from verified main 6e82dfb using dedicated resources and existing authorized connections. [Independent deployed HTTP/Chrome QA](QA-DEPLOYMENT.md) passed; real login/write routes remain closed. Public catalog is four fictional entries and two fictional profiles. Current ongoing-deployment procedures/settings are in DEPLOYMENT.md; GitHub-only automatic deploy is not activated and no new persistent credential was created.

R2/image work is a separate next stage in MEDIA-PLAN.md. No paid upgrade or R2 subscription was accepted. Prefer existing/free allowances; exact activation/payment/usage conditions require the applicable confirmation.
