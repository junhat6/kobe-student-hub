# Report to operator review — fictional local journey

Issue #45 follows the first-publication journey (#44). Comparing #38's release gates, the confirmed report→three distinct accounts→temporary hiding→operator review path is valuable and can be exercised without external OAuth/mail settings. Restoration/re-report/retention and real contacts are unresolved; this cycle makes those operational gaps concrete rather than inventing a policy. Source PRD is unchanged.

## Selected reader and operator contract

The initial anonymous reader still performs only cookie-free public reads, with no private session/bootstrap call. Only an explicit report action obtains a CSRF token from an already existing authenticated local session. It never creates a school identity or silently logs the reader in. An anonymous caller gets an honest unavailable-login state.

Report reason and optional detail are private plain text. The bounded POST uses real local sessions/CSRF/final SQL checks and records only an eligible published article report. One account contributes once; the existing atomic trigger records pending notification work at1/2, and at3 records temporary hiding and pending work together. This proves distinct local accounts, not distinct eligible humans or completed abuse prevention.

A lost response is not automatically retried. Private own-report GET returns received:true for the caller's accepted report, including after hiding, or false only for an eligible published article without that caller's report. Hidden-without-own-report, invalid target, missing/other inaccessible content and invalid authentication remain unavailable, not false absence. Neither receipt reveals report count, identities, reasons, detail, outbox contents or operator status. The form retains text until the user confirms the actual outcome.

The local operator route is read-only queue→case. Trusted server allowlist is empty by default in the reusable handler; browser role fields are never authority. The fictional local fixture alone permits its explicit test operator. Anonymous/regular users cannot read cases. The bounded case projection contains only the article and private report text needed for review, not reporter/account/provider/session identifiers. Text is escaped, and article Markdown uses the existing safe renderer. Failed loads do not keep a stale previous case on screen.

Accepted storage and pending outbox work are not email delivery or an operator decision. No judgment, restore, deletion, real operator provisioning or contact submission is implemented. Fresh public GETs exclude hidden content, but already received text cannot be retroactively erased by that SQL filter.

## Decisions required before actual operation

| Area | Confirmed direction / current evidence | Still to resolve before implementation or activation |
| --- | --- | --- |
| Operator authority | Limited authenticated operators review private cases; local read-only allowlist works | Real responsible operator(s), least-privilege provisioning/revocation, coverage and authenticated management UI |
| Judgment and audit | PRD calls for operator review/restore/delete | Reasoned decision states, author-facing explanation, audit actor/time/content version, notification and failure handling; read-only viewing is not judgment |
| Restoration and re-report | Three reports temporarily hide rather than erase | Whether a restored article starts a new report cycle, who may report again, and how earlier reports are closed while retaining audit history. Current schema caps accepted reports at3; setting status back to published alone is not a complete restoration algorithm |
| Delete and retention | Private drafts/report reasons must be protected | Soft hide versus permanent erasure, evidence retention/anonymization, accounts re-registering, backups, graduation/account deletion. No data is deleted to simulate a policy |
| Author explanation and appeal | Author needs an explanation and a route to challenge a decision | Safe summary without revealing reporters/raw private reasons, authenticated appeal ownership, case reference, reviewer and response handling |
| Notifications | Existing outbox stores pending work for1/2 and third-report hiding | Real recipient/transport, sent/failed/retry state and delivery evidence. Pending-only storage cannot prove an email was sent |
| Inquiry/contact | A real operating contact is needed, including for graduates unable to log in | Owner-approved destination/channel, privacy handling, proof of ownership and reply responsibility. No email is guessed from infrastructure accounts and no fake contact form claims delivery |
| Eligibility and abuse | Current-school identity and current-student writing are required | Actual Google/admission/graduation rules, distinct-human/account re-registration handling, intake quotas and operational abuse response |
| Public delivery | Local new reads reject hidden articles | Real CDN/client/media invalidation and platform-log checks, distinct from erasure of previously received content |

These are explicit unresolved choices, not new agreed requirements or an authorization to publish private content. Real contacts/roles/credentials and any data policy change need their applicable concrete scope. No actual notification is sent in this unit.

## Local setup, evidence and limits

The dedicated editor fixture initializes existing0006 in its isolated local database alongside previous schema. It seeds a fictional editor-operator and provides an explicit localhost-only test session helper; neither is a real account/permission grant. Operator page navigation itself never invokes that helper. Tests can use three fresh fictional reporter accounts to establish the actual local hiding and read the private case with that fixture operator.

Independent QA should run only after the implementation is frozen, reuse prior evidence where unchanged, and execute relevant actual D1/HTTP/PC-mobile boundary tests plus required regressions. Images remain local; previous held originals are not retried or uploaded. AI checks establish operation only; student value, physical devices, real school Google, actual notification/contact/appeal/restore, CDN/logs and real-world operating readiness remain unverified.

Production entry/assets/sample-only gates remain unchanged. No new migration, remote0004–0007, credentials/grants, real operator configuration, email/R2/contracts, deployment or screenshot publication is part of this cycle.


記事の読み取り専用運営画面は、フォーカス・画面切替・セッション変更・確認不能時に以前の一覧と通報詳細を閉じます。再開には明示的な既存セッション確認と新しいサーバー権限確認が必要です。実運営・実認証の有効化ではありません。境界と制約は[MODERATION-SESSION.md](MODERATION-SESSION.md)を参照してください。
