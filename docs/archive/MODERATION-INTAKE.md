# Article report intake before real publication

Issue #36 follows the local writing journey with a confirmed operational prerequisite of publication. The latest PRD was re-read: the author explicitly publishes; different three reporters cause temporary hiding, one/two reporters also notify operators, three reporters notify hiding, and operators review/restore/delete with explanation/appeal. School-account access is not current-enrollment proof. The source PRD is unchanged.

## Selected unit and journey gaps

Current journey: sample discovery works publicly; actual editing/save/resume is locally reviewable through fictional sessions. Real Google/admission remains unconnected. Rather than expose a publish button while operational conditions are absent, this unit implements the confirmed report intake→deduplication→temporary hiding→pending notification/review core against local D1.

This is not the full publishing gate. Actual publication metadata/profile, admitted-author authorization/graduation, public delivery/cache revalidation, private media, real mail transport/recipient, operator UI/decisions, author explanation/appeal and student trial remain required. Restore/re-report counting and retention/deletion are explicitly unresolved. No restore/delete/sender/publish method or user-facing availability is created by this unit. Project/scrap reporting is not inferred from article reporting.

## Intended local contract

Only a currently published article is reportable. The real session store checks POST Origin/CSRF and loads the actor; the final parameterized statement checks live session/account/epoch/time again. A request never supplies its reporter identity or operator role. One account/target pair contributes one accepted report; repeat submission before hiding returns the same generic receipt without another notification. IDs, count, reason, reporter and internal errors are not returned through the receipt.

A single inserted report and its database trigger create the durable pending event and, at the third accepted report, change content from published to hidden. First/second events are report_received; the third is temporarily_hidden. Failure to record the pending event must abort the whole statement, rather than leave an accepted report or hidden item without that event. Concurrent requests must produce at most three reports/events and one hide event. Nothing here sends email or claims delivery; pending storage is not a substitute for the PRD's real operator notification/retry requirement.

Reason/detail are private. Initial technical limits are200 Unicode code points for a required reason and2000 code points/8000 UTF-8 bytes for optional detail. The account reference can become null when its account is removed, preserving the already accepted report and pending case instead of silently un-hiding or losing review work. New null reporters are forbidden. This local storage behavior is not an agreed retention/anonymization policy; real account deletion/re-registration and unique-person eligibility need decisions before use. Local account uniqueness is not a universal proof of distinct humans.

Operator access is a trusted server allowlist, empty by default, with active-session/final-SQL checks. No actual operator identity/grant/configuration is created. Queue metadata is bounded to20 cases with titles projected to200 code points, while a reported article case can return private reasons and article text to that authorized caller; unreported drafts are outside that access. A legacy body above the existing256KiB article draft bound is unavailable to case reading while bounded queue metadata remains available; handling such legacy content is not a completed operator UX. The allowlist is not a client field or a blanket administrator override. Operator delivery, adjudication, pagination and quotas remain unprovided.

## Release boundary and verification

The module and local migration are not imported or applied by production. Remote0004/0005/new0006 are not changed. Existing public sample routes must still refuse reporting/auth/writes. Local tests must establish duplicate/concurrent semantics, atomic outbox failure, session/CSRF/operator boundaries, privacy and public projection after hiding. Local request-time filtering does not erase content a reader already received or prove all frontend/CDN caches revalidate.

No new screenshots are published, and earlier rejected images remain held. No actual email, real student content, credential, permanent grant, contract or deployment is part of the cycle. See independent QA for executed cases and hashes; server/SQL tests do not establish a complete student or operator journey.

References: [SQLite trigger and RAISE semantics](https://www.sqlite.org/lang_createtrigger.html),[D1 foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/). Tests exercise the actual local Workers/D1 behavior rather than treating documentation as execution evidence.

## Follow-up local journey

Cycle22/#45 connects report intake/own receipt and read-only operator HTTP/UI in the fictional localhost lab. See MODERATION-JOURNEY.md for the implemented journey and concrete unresolved judgment, restoration/re-report, retention, notification and inquiry/contact decisions. Production remains unconnected; the local fake operator is not real role provisioning. No mail or restore/delete/contact submission is implemented.
