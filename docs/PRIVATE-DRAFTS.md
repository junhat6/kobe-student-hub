# Private article draft persistence

Issue #28 addresses a necessary part of the PRD's Markdown authoring and PC/mobile draft handoff: only the owner can access a draft, and saving an older version must not overwrite a newer save. This is server-only local implementation, not an enabled editor, autosave UI or real posting service. The source PRD was read without editing or republishing it.

## Why this unit

The existing owner helper is a pure comparison; it does not protect a stored draft. Session authentication alone also leaves a gap if an account is suspended or a session revoked before a later mutation. Draft operations therefore need both authenticated request checks and authorization conditions inside their final SQL statement. Concurrent devices additionally need expected-version checks.

Moderation remains mandatory before real publishing. Its complete experience includes distinct reporters, notifications at one/two/three reports, temporary hiding at three, protected operator decisions and appeals. Re-reporting after restoration and retention remain unresolved. Implementing only a count or hiding flag now would not provide that complete gate. This cycle chooses draft protection without deciding those policies.

## Intended contract

The trusted server store receives a Request and uses the real session store. Read operations are read methods; unsafe operations require exact Origin, compatible Fetch Metadata and the session's CSRF token. A client never chooses the owner, account status or publication state. Final parameterized SQL checks live session hash/account/epoch/expiry and the stored owner together, including at mutation time.

Draft IDs are server generated. Creation starts version 1; updates and deletion require the last observed positive integer version. One concurrent update wins; stale callers receive a generic unavailable result. A future caller/UI must preserve its unsaved text. Missing IDs, another owner's IDs and conflicts do not disclose private content or existence. A future UI must explain recovery without silently merging or retrying stale text over the winning version.

Technical initial bounds, subject to review: title 200 Unicode code points, Markdown 256 KiB UTF-8, newest 20 summaries with deterministic ordering. Empty title/body remain valid while writing. The summary list omits body and private identity/session fields. These bounds are implementation safeguards, not agreed product limits or full pagination. Per-account quotas, automatic retention and bulk operations are outside this unit.

## Release boundary

No production endpoint imports this store. Private fixture endpoints must never be deployed or accept real identities. Local migration preparation is not remote application; migration 0004 and the new draft migration remain unapplied remotely. No Google settings, secrets, permanent grants, contracts or real accounts are created.

Real authoring still requires dedicated OAuth configuration, real browser/controller verification, no-store/private error handling, admission/graduation rules and actual log protection. Public writing also requires the PRD's privacy/media/moderation/operator conditions. Account active status is not proof of current enrollment, and this code does not decide graduation boundaries. No student trial or physical-device result is inferred from local tests.

Storage uses [D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/); all ownership and version values remain bound parameters. The independent report records actual test coverage and final source hashes separately.
