# Author publication stop — fictional local experiment

Issue #67 chooses an owner stopping an unintended public article/project snapshot before public revision. Editing public rows would need reported-version/evidence/restoration decisions. A smaller local action can stop further fresh reads without rewriting the snapshot or private draft. This is a value hypothesis, not student validation or an agreed real withdrawal/retention/republication policy. The source PRD is unchanged.

## Explicit target and limits

The author selects a stored publication record, reviews its kind/public reference/title/initial publication time/publication source version, and explicitly confirms stopping that current public snapshot. The source version is the version used for publication, not the latest saved or unsaved private edit. The form never submits a title/body, author identity, report reason or a browser-chosen ownership claim. Private editing remains independent.

Before the action, the UI explains that stopping is not body/draft erasure, recovery of content already received, or a reversible toggle. This prototype provides no republish, restore, deletion, public revision or appeal/contact operation. It does not decide actual service policy. A future voluntary check should establish whether an author understands these limits and can distinguish the selected public snapshot from current private text.

## Atomic state and private receipt

GET/POST /api/private/publication-stops/:kind/:publicUUID use existing sessions, owner checks and private no-store transport. GET and POST return200 with an exact kind/publicId/sourceVersion/status/stopped state; POST accepts only expectedSourceVersion and confirmStop:true. Inputs are bounded to16KiB/4096chunks/5seconds. No stop timestamp, private draft/account/provider/profile ID, report count/reason/identity, notification or operator decision is returned.

A final live-session/owner/source-version INSERT selects only a currently published target. A unique marker plus an AFTER INSERT status update makes published→hidden atomic. If the update is ignored or fails, the marker rolls back too. Duplicate/concurrent commands can acknowledge the same owned marker and exact publication version without rewriting a snapshot or creating another effect. Existing draft removal/private edits/public-profile changes do not authorize a different target or prevent checking that original record.

An already hidden/deleted target with no own marker remains a generic non-public state. POST does not add a marker or claim the author initiated that state. Reasons are not inferred from visibility. A valid own marker confirms an owner-stop record only when the stored target is non-public; marker/version/ownership contradictions or an allegedly stopped-but-published record are unavailable, not success.

Accepted article reports and pending outbox work are untouched. If two reports exist before an owner stops, they stay recorded and later reports cannot target the hidden article. If the third report hides first, an owner command does not relabel that report-hidden state. Works intake still has no automatic article threshold; an explicit owner action is a separate cause of visibility change.

## Recovery and public boundary

A lost POST response is not automatically retried. The selected target panel persists outside the refreshed list, preserves the unresolved reference and only offers manual own-state checking. A hidden status alone is not proof of the author's stop. Pending actions serialize target selection/list refresh; unrelated private typing is retained. After reopening the author screen, non-public rows provide a read-only stop-record check, so an acknowledged or uncertain earlier action is not discoverable only through a memory-only panel. That lookup cannot become a stop action even if a fresh state says published; the author must select a freshly published row and confirm a new preparation. Existing session guard checks before requests, after headers and before consuming EOF; same-session uncertainty hides/retains author state, while a confirmed different/invalid session discards it. Aborting a response cannot undo an already committed stop.

Fresh article/project readers, author/feed/liked lists use their existing hidden exclusions. The own publication record remains available as a stored state, with no reader link for hidden records. Already-open pages, cached or third-party copies and actual CDN/media/log invalidation are not reclaimed or proved erased. Earlier publication acknowledgments are historical confirmations, not permanent delivery guarantees.

## Schema and actual operation

Local/test migration0011 adds separate article/project marker tables referencing their publication records. All tables/guards use IF NOT EXISTS so the isolated preview can apply the complete file on each startup. Normal INSERT/UPDATE attempts to publish a marked original target are rejected; no marker removal or restoration API is offered. This is not tamper-proofing against an administrator who changes schema, deletes markers or executes unsupported arbitrary SQL. It is not a completed retention/account-deletion or restoration policy.

Production handlers/assets and actual sample delivery remain unchanged. No remote migration, actual role/account/grant, credential, contract, R2/mail, deployment or screenshot publication belongs to this unit. Real school Google/admission/graduation, operating responsibility/notifications/judgment/explanation/appeal/contact, project reporting scope, actual privacy/log/cache/media/retention and student/physical-device validation remain unfinished. Local fictional operations and synthetic latency/failure tests must be distinguished from real service availability.
