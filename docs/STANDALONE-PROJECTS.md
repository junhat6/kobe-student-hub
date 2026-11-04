# Standalone projects — fictional local journey

Issue #61 selects a small activity-sharing entrance for a student with no article: private project fields → saved-version review → explicit local publication → anonymous project → that author's projects. Published editing remains separate because it intersects immutable snapshots, report versions and restoration. The source PRD is unchanged. Project value is a hypothesis; no student demand or learning benefit is established.

## Fields and publication contract

The initial form has a title, plain-text explanation and optional repository/demo URLs. It does not require an article, image, invented reading time, popularity signal or portfolio taxonomy. Images and related-article linking are later work. A small bounded explanation is deliberately not a new Markdown/media editor.

Private saves use server sessions, ownership, CSRF and optimistic versions. Valid HTTPS URLs are canonicalized before storage, and the saved canonical addresses are shown before publication; title/explanation text stays unchanged. Credentials, whitespace/control characters, invalid Unicode, unsafe protocols and oversized values are rejected. No external page, preview, favicon, embed or image is fetched. Query strings and fragments are part of the deliberately public address; syntactic validation is not a secret detector or verification of the destination.

Publication accepts only an expected saved version and an explicit public action. Server-stored fields and the current confirmed chosen profile supply the snapshot; client owner/profile/body claims are not authority. Dirty private inputs cannot become an unexpected publication. Later private edits do not change the existing public snapshot. Public editing, cancellation, deletion and restoration are not offered by this unit.

Unknown create/save/publication outcomes are not automatically retried. An unknown create without an acknowledged ID cannot be proven absent; the user must inspect owned candidates and deliberately choose a saved record. Known-record recovery displays the server version separately, retaining local input until an explicit open/rebase choice. An uncertain publication uses the owned receipt; an unavailable/hidden/deleted/malformed record is not proof that no publication exists.

## Public project and author views

Public DTOs are separate from article DTOs. Readers receive project fields, a publication day and explicitly chosen public author fields; they do not receive private draft/account/provider IDs or source-version metadata. A project-only author can have a bounded public project list without publishing a dummy article. Up to20 eligible projects appear in publication order, with a short explanation preview. No eligible public project means the project-author view is unavailable; storage/corruption failure must not become false empty success. Existing article-author endpoints keep their prior semantics.

Fresh reads exclude hidden/deleted records and validate bounded fields. Private draft deletion in a test does not erase the public snapshot; that structural independence is not a real retention/deletion policy or a deletion UI. Previously received content cannot be erased by a fresh-read filter. Actual CDN/cache/log behavior needs separate evidence.

## Boundaries before real users

Migration0009 and all project routes are local/test-only. Production entry/assets and actual sample delivery remain unchanged. The lab's active fictional account is not school authentication, admission or a graduation decision. Real authentication, eligibility, privacy and operating prerequisites in FIRST-RELEASE.md remain unfinished.

Project reporting is not connected to actual service. A separate local intake/read-only review experiment is scoped in [PROJECT-REPORT-REVIEW.md](PROJECT-REPORT-REVIEW.md); accepted storage is not notification, hiding or judgment. The article three-reporter rule, article likes and article moderation are not silently applied to projects. No project report/restore/delete button pretends that policy or operating responsibility exists. Images/R2, article relationships, project likes and public editing require their own scoped work. No remote SQL, credential/grant, contract, real posting or screenshot publication is part of this unit.

AI/D1/browser checks establish local behavior only. A future voluntary trial should ask whether the work explanation and links help a reader understand the activity or choose a next step, including reasons the form or disclosure is unsuitable. Clicks, registrations and command success are not student value. Physical devices, Safari/IME, real accounts and data protection remain separately unverified.
