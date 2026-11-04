# Explicit first public profile — local author preparation

Issue #41 follows the first-publication boundary (#40/#38). That store needs a manual public-profile mapping, but no author-facing confirmation creates it. An explicit input/preview/confirm journey is the selected next unit. Operator restoration/re-report/retention and actual recipients remain unsettled; this cycle does not invent those rules. Source PRD is unchanged.

## Contract and boundaries

The local lab starts with empty display fields. It never defaults to Google name, photo, email, account ID or provider subject. The author enters display name and optional department, year label and biography, sees an anonymous-reader preview, then explicitly confirms the public information before first creation. Department/year are self-entered descriptive text, not verified enrollment or eligibility. This confirmation is not consent to all future terms or proof of a physical human action.

The unconnected private GET/POST endpoint uses real session/CSRF and a final SQL live account/epoch/time guard. It returns a strict profile DTO with no private identifiers. Display name is required, at most80 Unicode code points; department80, year label32 and biography800. These are technical limits, not new product commitments. Profile ID is random server-generated, initials derive only from explicitly entered display name, and is_sample is fixed0. The command cannot choose its owner, public ID or sample status.

Previously configured valid manual public profiles can be read without rewriting their public ID or initials; new creations use the stricter generated-ID/derived-initial contract. Invalid or private-ID-based legacy mappings are unavailable rather than silently overwritten.

Creation of the public row and private owner mapping must be atomic. A retry with identical canonical fields confirms the same profile; a different request does not overwrite a previous profile. This is first creation only. Public-profile editing/deletion, identity switch/logout integration and account retention need separate decisions and implementation. The future authenticated controller must remount this form and the editor on account/session changes and clear private buffers; changing a csrfToken prop alone is not a supported identity-switch lifecycle. A profile mapping never substitutes for school identity verification, current-student admission or graduation policy.

The UI retains input on errors and uncertain outcomes and does not automatically repeat a mutation. An explicit read can confirm the stored profile. It must distinguish matching acceptance from a different existing profile without silently replacing the author's current input. No localStorage or other persistent browser draft storage is added.

## Availability and verification

This is an isolated fictional-account localhost HTTPS lab, not a production onboarding service. Profile browser tests request a fresh server-generated fictional local account/session for each run; they do not reset existing lab profiles or impersonate actual school identities. The fixture-only account/session route is origin/config guarded and must never be deployed. The new private handler is not mounted by worker/index.ts. Production sample-only catalog and assets remain unchanged; anonymous public profile delivery still depends on the separately unconnected publication reader. Creating a local profile does not publish an article. No actual school Google, enrollment, student demand, physical device, CDN/cache/log, mail/operator/appeal or real-world consent validation is implied.

Verification requires atomic ABORT/IGNORE/concurrent behavior, live ownership checks, strict input/private projection, first-create/retry semantics and real local HTTP/UI in PC/mobile viewport. Record independent source hashes and screenshot hashes, with images kept local. Existing held screenshots are not retried. No remote migrations/settings,credentials,new grants,contracts,email or deployment belongs to this cycle.

D1 transaction basis: [D1Database batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) documents rollback of the entire batch when a statement fails. Local D1 execution, including injected failures and zero-change behavior, supplies the actual evidence rather than documentation alone.
