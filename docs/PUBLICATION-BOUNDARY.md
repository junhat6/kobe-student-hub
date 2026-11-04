# Local article publication snapshot boundary

Issue #39 advances the remaining author journey in #38. The PRD calls for the author to press publish, public reading without login, private drafts/identity and temporary hiding after three reporters. Restore/re-report/appeal/retention details remain unresolved; real Google/mail/operator settings are unavailable. This unit chooses the saved-draft/public-content boundary because it can be verified locally without deciding those policies.

## Selected contract

The server-only store requires an authenticated POST, Origin/CSRF and a final-SQL live session/account/owner check. A request includes the saved draft version, explicit confirmPublic=true and bounded publication metadata. That flag expresses the server command's intent; it does not prove a physical human button click or replace the future confirmation UI. It cannot override any eligibility/operational gate.

Title/body come only from the matching saved private draft. A stale version, another owner's draft, empty content or client-supplied title/body/author/status/sample flag is rejected. An already configured manual public-profile mapping supplies the author; private account/email/Google profile fields are never used as public-profile defaults. Creating that mapping/profile with genuine consent remains an unprovided onboarding flow. An active account/profile is not proof of current enrollment or graduation eligibility.

A single statement records the private publication linkage and creates a new non-sample published article snapshot. Failure must leave neither an orphan public row nor an orphan linkage. Concurrent identical requests yield one snapshot and the same receipt. While the draft remains owned and its manual profile mapping still matches, an exact replay of the original version/metadata can confirm the existing published snapshot even after a later private edit. After draft deletion removes that private source link, replay is unavailable while the public snapshot remains. Different metadata/version never silently updates an existing public article. First publication is the only write operation in this unit; published editing, unpublish, restore and deletion need separate policies/actions.

Example: saved draft v1 contains A, and publication copies A. A later private save v2 containing B leaves public A unchanged. Deleting the private draft does not silently remove that snapshot. If three distinct accepted reporters hide A, publication replay must not restore it, and anonymous new reads must stop returning it. This is not retroactive erasure of content previously received by a reader.

## Metadata and public projection

Initial technical bounds are title200 Unicode code points/body256KiB from the existing draft model; summary300,at most five normalized unique tags of24codepoints,optional audience/prerequisite/outcome200 each,and a1–240 minute estimate. These are implementation safeguards,not fixed product agreements or automatic reading-time accuracy. Requests do not select owner/profile/publication IDs or dates.

A separate public read function returns explicit Entry and Profile fields only for a publication-record-backed published non-sample article and a matching manual non-sample profile. Unvetted legacy rows without that linkage are not opened by the new reader. Private owner/draft/source-version/Google identity/report/outbox fields are excluded. Legacy projections are bounded. The production catalog still intentionally selects fictional samples only; the new public read function is not mounted on a real HTTP route or used by the production app.

The local profile-link/publication schema can null private source links on deletion without deleting the copied public content. This is a technical fixture model,not an agreed real account-deletion/anonymization/retention policy. Real use must settle those cases. Public IDs must not accidentally reuse private account or provider subject IDs. Profile ID format must be consistent at publication and public reading so a successful publication cannot create an unreadable author reference.

## Release gates and evidence

The local fixture composes real sessions,draft storage,publication and article-reporting code with fictional accounts. Tests must cover explicit owner/version/profile boundaries,atomic failure,concurrent receipts,public DTO privacy,private edits/deletion and report-triggered hiding without replay resurrection. It remains a programmatic local journey,not an actual author's publish-button/browser experience or student-value result.

Production routes/assets stay unchanged. No remote0004/0005/0006/new0007,real profile/operator/admission configuration,credentials,permanent grant,mail,contract,deployment or new screenshot publication is part of the cycle. Real activation still requires the Google/browser/logout lifecycle,enrollment/graduation,profile/confirmation UI,notifications/operator decisions/explanation/appeal,cache/media privacy and the existing actual-log gate. Previously held screenshot originals are not retried.

## Follow-up local journey

Cycle21/#43 connects a bounded private owner receipt/first-publication HTTP boundary and explicit saved-version/profile/metadata confirmation inside the fictional local lab. See PUBLICATION-JOURNEY.md for the current local journey. Production endpoints remain unconnected and real activation conditions above still apply. Stored NUL-containing Markdown bodies are rejected before new publication, and legacy public bodies containing NUL are unavailable, matching the strict reader/client contract. No historical migration is rewritten.
