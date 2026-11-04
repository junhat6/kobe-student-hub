# Own publication records — fictional local author view

Issue #65 chooses a small MyPage journey before public editing or work moderation actions. The author needs to find existing article/project publications and distinguish stored visibility from an unavailable reader/receipt. Public revisions would require reported-version/evidence/restoration decisions; work reporting scope/thresholds and real operations remain unresolved. This list changes none of those policies or the source PRD. Its usefulness to students is a hypothesis.

## Read-only contract

The existing verified author subtree reads GET /api/private/own-publications through its session consumption guard. No page bootstrap, identity creation or role grant is added. One server query rechecks live session and stored publication ownership across both article/project candidates. The response is at most20 combined records ordered by initial publication time descending, kind and public ID, plus moreExists when additional records exist. It is neither20 of each type nor a promise of a complete history.

Each record contains only kind, public reference, bounded title, stored published/hidden/deleted status, initial publication timestamp and the private saved version used by the publication. The source version is the publication's saved snapshot, not the current private draft version. No draft/account/provider/profile identifiers, body, report reason/count/person, notification/outbox or operating decision is included. Other owners' records do not become visible through a client-supplied account string.

Ownership comes from the stored publication, independent of later private draft removal or public profile/reader eligibility. The list does not claim the public reader currently succeeds. Selected malformed/orphan candidates or storage failure are unavailable, not silently dropped into false empty success. An authoritative empty list requires a live authorized query. Additional-record indication is bounded observation, not proof of retention after account removal or physical row deletion.

## What the author can infer

The UI labels stored state, initial publication time and publication source version explicitly. A published record can open the existing reader in a new tab while preserving the private editor. Hidden/deleted records get no public reader link from this view. A stored deleted status is not proof every copy, cache, backup or log was erased. A status alone does not establish a reason, a report threshold, a notification, an operator action or completion of appeal handling.

An article may become hidden after the existing three-account local report flow. Many local work reports leave a project published because the work intake experiment does not apply that article rule. The list observes these states; it does not change visibility, republish or restore content. It cannot bypass existing hidden-publication receipts or replace the original public snapshot with a later private save.

Refresh removes stale visible rows while waiting and on failure. Existing session uncertainty hides private author state; same-session recovery preserves editor input. Confirmed invalidation or a different token discards the old subtree and requires the established continuation flow. Bounded session observations are not instantaneous atomic cross-tab detection, heap erasure or reversal of committed actions.

## Remaining release and value gates

This unit is local/test-only, using existing schema. It adds no publication/edit/restore/delete/appeal/notification action, real operator, migration, remote SQL, credential/grant, contract, R2/mail, deployment or screenshot publication. Production sample entry/assets and actual connection remain unchanged. Real school Google/admission/graduation, operating responsibility/notification/judgment/explanation/contact/retention, project reporting scope, actual log/cache/privacy and student/physical-device evidence remain unfinished.

A future voluntary author check should ask whether the record helps distinguish an old public snapshot from a private edit or an unavailable reader, and whether the wording makes clear that no reason or resolution is supplied. AI/D1/browser checks establish local behavior only; list clicks and successful HTTP requests do not prove student value.
