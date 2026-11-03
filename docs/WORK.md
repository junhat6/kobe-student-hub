# Current work and replanning

## Cycle 01

**Planner:** H01 — reader context plus author/project relationships can help a student choose an article and carry away a next action. Minimal target: browse → article/project → author/related, on mobile and PC. Fictional data only.

**Developer:** Implemented React/Vite + Hono/Workers + D1, search/tag/type filters, detail context, safe Markdown, profile/related navigation, loading/error/empty states, sample-only read boundary, security headers, design guide, migrations, tests and CI/deployment scaffolding.

**Independent QA:** Separate task/context reviewed code and operated macOS Chrome. Findings Q01–Q04 were fixed; report in QA-INDEPENDENT.md. See EVIDENCE.md for final build/E2E and screenshot evidence. Student value testing is not completed.

**Result:** Local discovery behavior verified. Remote Cloudflare setup is blocked, not deployed. Repository source and CI are the handoff, with deployment guard active until real IDs/access are supplied.

## Next priorities

| Priority / task | Acceptance / boundary | State |
| --- | --- | --- |
| P0: resolve preview infrastructure | Specifically authorize new D1 resource/cost implications; use least required access; deploy only new resources; verify literal returned URL/headers/API | Blocked by automatic review / missing D1 write path |
| P0: school identity and privacy foundation | Server-side Google identity/verified domain checks, opaque sessions, CSRF, private data model, no automatic name/photo publication, ownership and graduation tests | Planned; no OAuth secret available |
| P0: real publishing safety | Private drafts and media, author editing, unique-reporter three-person temporary hiding, protected operator recovery/deletion, failure-safe email outbox and contact/appeal path | Planned; never enable real posting before this gate |
| P1: authoring across devices | Markdown assist + preview, explicit publish, optimistic concurrency, autosave status and safe recovery; image/YouTube policies before enabling | Planned |
| P1: public likes, private history, recommendation | Correct privacy boundaries and deletion; real counts only; simple explainable tag/newness logic | Planned |
| P1: IT-student trial | Recruit an agreed small group and initial content; verify discovery/next-action usefulness on real devices; record consent-safe outcomes, not private data in public issues | Not run |
| P2: search growth / editor media / Safari | Pagination/indexed search before >100 entries, iOS Safari physical device, Mermaid sandbox and upload controls | Planned |

## Decisions still needed before real release

Operator and actual support contact; school relationship and publication rules; graduation-year boundary and exceptions; identity recovery/deletion after loss of school account; history retention; media size/type limits; exact operational email delivery; trial participants/content and expansion criteria; cost ceiling and actual account plan. Implement reversible internal choices autonomously, but do not silently widen publication or identity scope.

## Working protocol

Keep current tasks and evidence in GitHub Issues/PRs. Do not paste student feedback, emails, school identifiers or authentication data into this public repository. A user-request intake in the eventual app must be private to the requester/operator by default; public Issues are currently for development tasks only. Do not create endless autonomous loops or automatic paid agent runs; update this plan from evidence and take one bounded cycle at a time.
