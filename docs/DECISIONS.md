# Decisions and hypotheses

Recorded 2026-11-03. These records supplement the PRD; they do not rewrite it.

## Source and priority

PRD: user-provided Google Doc. Latest tab: 設計判断・MVP方針｜Q01〜Q40; also read the original draft and 実現したいユーザー体験. The private source document is not republished here. Original v0.1 is a draft; later tab broadens the emphasis to articles × student activities. Adopted experiences are not promises to implement every feature at first release.

Confirmed direction: public reading; school Google verified current-student writing; articles/projects/profiles/search/likes with simple recommendations; independent projects may link to articles. Markdown editing and saved drafts across devices are important. Images and YouTube before direct video upload. Three distinct reporters trigger temporary hiding, not deletion; operator email and protected moderation are required for real publishing. No follow notifications. Avoid unnecessary personal data, protect drafts/history and private media.

## Cycle 01 — narrow discovery hypothesis

Hypothesis H01: seeing an article's topic, intended reader, prerequisites and author/project context helps a student choose something relevant and identify a possible next action. This has not been validated with students.

Scope: sample-only browse/search/detail/profile/related navigation. Real authentication and UGC are excluded from this cycle because identity, moderation, private data and operational conditions must be provided together, not simulated by weak client checks. This is a development artifact, not the agreed full product.

Acceptance: mobile/PC discover → read → author/project; keyword/tag/type and empty states; API outage recovery; explicit sample notice; no private data or writes. AI tests establish operation only. Next student trial must ask whether an experience informed an actual action, not merely whether cards were clicked.

## Architecture

Use TypeScript end to end: React/Vite frontend + Hono Worker + Static Assets + D1. A single Worker origin avoids unnecessary services and cross-origin auth. Tailwind v4 and Base UI follow the PRD. react-markdown/remark-gfm/rehype-highlight avoid custom Markdown parsing, and raw HTML is disabled. No image/iframe renderer in this cycle. Mermaid/YouTube are deferred until their security and privacy conditions are designed.

D1 stores structured public sample content with explicit status. The SQL projection excludes every non-published state and non-sample row, including at final API delivery. No real private fields are added merely to scaffold unused features. Current search loads at most 100 sample entries and filters locally; this is intentionally unsuitable for a production-size catalog. Future indexed search/pagination is a separate task.

No AI inference, embeddings, R2, email or subscriptions are enabled. Related entries use explicit relationships then shared tags; this is not personalized recommendation or popularity ranking. Do not invent likes/counts/history.

Name `kobe-student-hub` is a reversible working name chosen after checking accessible owned repositories. No school logo or official affiliation is claimed. No open-source license for original code has been selected by the owner; public visibility alone is not a license grant. Reference notices are preserved in DESIGN.md.

## Infrastructure constraints

A dedicated sample-only preview was subsequently authorized, provisioned and deployed; see DEPLOYMENT.md and QA-DEPLOYMENT.md for the intended public URL and verified scope. Do not bypass approval rejection. Account-specific operational and billing details remain outside this public repository.

The prepared automated deployment requires a specifically authorized D1 database and an appropriately scoped credential supplied securely through Actions secrets. Do not create persistent access or activate a paid service without the applicable confirmation. Do not reuse or modify unrelated resources.
