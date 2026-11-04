# Project report intake — fictional local experiment

Issue #63 compares public editing with work reporting/operations. Published editing affects saved snapshots, reported versions, evidence and restoration. Actual notifications and decisions require real recipients, responsibility and agreed rules. A smaller experiment can test an explicit reader report, own receipt and trusted read-only case review against existing fictional sessions.

This does not settle the source PRD's unresolved application of article moderation to works. The source PRD stays unchanged. The experiment is local/test-only and cannot justify real project activation. Intake is not notification, hiding, review or a decision; no three-reporter rule, status change, pending-mail outbox, restore/delete or public revision is introduced.

## Reader and receipt boundary

Anonymous project reading keeps its existing public projection and credential-free requests. Only explicit report preparation checks an already existing session. No school login, account admission, identity bootstrap or role provisioning is performed by the page. Session uncertainty hides or clears the private scope as appropriate; a different session cannot consume the old reason/input or delayed response. Atomic cross-tab detection and reversal of committed writes are not promised.

Reason and optional detail are private plain text, with technical bounds of200 and2000 Unicode code points (detail up to8000 UTF-8 bytes). The target is the existing immutable public project snapshot; the form cannot supply a reporter identity, project fields or operator role. Current eligibility, deduplication and a final live-session/target check are server responsibilities. The prototype's active fictional account is not real school or current-student eligibility.

One account/project pair has one accepted report. Repeating a request does not overwrite its original reason/detail. No report-count threshold is implemented. An unknown POST is not automatically retried; the input stays separate until manual own-receipt confirmation. The receipt exposes only received:true/false. A true receipt establishes that this account has a record for the target; it does not establish that the currently visible reason/detail, rather than an earlier or concurrent same-account submission, was stored. No UI should label it as an exact confirmation of the new text. Accepted own receipts remain recognizable after a target is hidden/deleted; false is meaningful only for a valid currently published target. Invalid, inaccessible, malformed or failed reads are unavailable, not proof of absence. No other reporter, reason, count, internal state or operator progress is disclosed through receipts.

## Trusted read-only review

Operator authority is a trusted server allowlist, empty by default. The isolated fixture uses its existing explicit fictional operator; neither a browser role field nor navigation creates that authority. Server session and final SQL checks protect both queue and case. Ordinary/anonymous callers cannot read the private reports.

The queue lists at most20 reported targets with bounded title, project reference, current status and latest report time. It is not an all-cases dashboard or completed workflow. A case contains the bounded immutable project snapshot, its chosen public author, current status and at most20 newest private reason/detail/time entries. An explicit reportsTruncated flag tells the reviewer when more reports exist; the UI must not imply it showed the whole case. Reporter/account/provider/session identifiers are outside these DTOs. Corrupted values and storage failure cannot become a falsely empty successful case. Target changes and failed reads remove stale case text.

All private reason text is escaped. Project links remain validated HTTPS addresses and are not fetched/embedded automatically. No notifications or decisions are simulated. Reviewing content is not proof someone investigated, acted on or replied to it.

## Unresolved real-use requirements

Work reporting scope, thresholds/manual action, abuse and distinct-person handling, real operators, notification recipients/delivery/retries, judgment/audit, safe author explanation/appeal/contact, restoration/re-report, account deletion/re-registration and retention remain separate decisions. Keeping accepted local records after account removal is structural prototype behavior, not an approved data-retention policy. No actual student or report data is used.

No production route/assets, remote migration, actual OAuth/admission, permanent credential/grant, paid contract, R2/mail, deployment or screenshot publication belongs to this unit. The local schema and localhost hooks do not authorize actual connection. Existing logging/cache/privacy gates and student/physical-device evidence remain unfinished. AI checks can establish local operation; whether the report wording helps a reader describe a concern and understand its actual outcome still needs voluntary student/operating feedback.
