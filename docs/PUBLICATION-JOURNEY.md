# First publication journey — fictional local lab

Issue #43 connects the saved-draft snapshot (#40) and explicitly entered public profile (#42) into a reviewable author action. This is selected over inventing operator restoration/re-report/retention policy or waiting on external Google/mail settings. The source PRD is unchanged. Genuine enrollment, consent/terms and real operations remain release gates in #38.

## Author contract

The author first saves the draft and creates a public profile. A local confirmation panel shows the saved title/body/version, public author and bounded article metadata before explicit confirmation. Dirty private text, missing profile, unresolved read or validation failure prevents a new request. Metadata/profile/saved-version changes clear the confirmation. The server accepts only metadata and expectedVersion; it never copies a browser-supplied title/body/owner/profile into public content.

The confirmed saved version is copied once. Later private edits do not change that public snapshot. During submission or receipt lookup, navigation/create/save operations are coordinated so an older asynchronous response cannot replace a newly selected draft; typing must retain its private buffer. Success refers to the captured version and distinguishes any new private edits from the published version. Publishing an article again, published editing/deletion/unpublish and operator restoration are outside this first-publication unit.

An uncertain mutation is never automatically retried. A manual owner-only receipt read can prove either the exact original accepted snapshot, a different existing publication or absence on the owned draft. Absence requires new explicit confirmation before another request. A failed read, missing draft, other owner, invalid linkage or hidden/deleted article is unavailable, not proof of absence and not permission to republish. Input must remain available for recovery rather than being silently overwritten.

## HTTP and local reader

The unconnected private `/api/private/publications/:draftUUID` supports GET receipt and POST first publication. It uses real local session/CSRF and final SQL owner/live status/epoch/time checks, bounded transport, private no-store headers and generic errors. GET returns only an explicit published snapshot receipt (`contentId`, `sourceVersion`, `entry`, `author`), or `publication:null` for an owned existing draft with no publication. No private account/provider identifier, report reason or outbox state is included.

The local reader `/lab/articles/:UUID` uses fixture-only `/__lab/articles/:UUID`, requires no cookie or fixture login bootstrap, and reads the record-backed published snapshot through the existing bounded public reader. It renders safe Markdown and distinguishes an unavailable article. Responses are no-store; no retroactive erasure of already received text or real CDN/client cache validation is claimed. A new-tab link preserves the author's private editor buffer.

## Scope of evidence

Fictional local accounts, actual local Workers/D1 and browser PC/mobile viewports can establish this bounded journey. They do not establish school Google login, admission/graduation, real consent, mail delivery, protected operator decisions/explanation/appeal/restore, media safety, actual platform logging/cache, Safari/physical devices or student usefulness.

Production worker/index.ts, frontend entry/assets and sample-only catalog stay unchanged. No remote0004–0007, new schema, credentials/grants, operator configuration, mail/R2/contracts, deployment or screenshot publication is part of this cycle. Images stay local; previously held originals are not retried. Any fixture identity or lab publication handler must never be deployed as a shortcut to actual authentication and operations.
