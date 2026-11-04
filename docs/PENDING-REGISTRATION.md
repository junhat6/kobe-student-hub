# Verified pending registration — local server-only step

Issue75 adds the missing first-registration step while preserving ordinary login. The existing broker verifies Google signature/issuer/audience/nonce/verified school email/domain, but session creation only accepts an existing active Google subject. Registration records a pending request; it neither establishes current enrollment nor grants login or writing access.

## Explicit purpose and verification

Trusted server code selects ordinary login or pending registration before starting OAuth. Registration uses a distinct encrypted-cookie audience, bound to the same configured client/origin/callback plus its explicit purpose. Default login keeps its previous audience and behavior. A callback for the wrong purpose must fail before one-time attempt consumption, so a mismatched handler cannot convert a login attempt into registration or burn the intended attempt. Invalid purpose/configuration fails closed. No client JSON field is authority for the purpose.

The registration callback uses the existing fixed-endpoint exchange, stored PKCE verifier and actual Google RS256/nonce/domain verifier. Provider/JWKS responses in tests are supplied locally, with existing ephemeral in-memory RSA fixtures; the production verifier is not replaced by decoded client identity. No real Google client, account, new permanent key or secret is generated/configured.

## Pending-only storage and receipt

A parameterized atomic statement creates a random internal account ID with status pending and epoch0, or reconfirms an existing pending record for the same Google subject and exact stored email. It preserves ID, email, creation time and epoch. An existing active/suspended/deleted subject, changed email, invalid input/time or storage failure is unavailable. A different subject with a matching email is conservatively rejected, including ASCII case variants; email is never an account-linking key. This technical fail-closed rule is not a recovery or graduation policy.

The final statement checks current status; a status step before it cannot be acknowledged as a pending reconfirmation. The receipt confirms what was recorded at that statement, not permanent/current review state or immunity from a later authorized operator change. No active step, session issuance, private draft access or profile creation occurs on this path.

Only a generic pending receipt and cleared attempt cookie leave the broker's registration method. New and repeated pending requests have the same receipt. No private subject/email/account ID, provider payload, token/verifier/secret, session cookie, actor or CSRF is returned. Failure stays generic; a failed/unknown operation is not success. Retrying requires a fresh bound/verified attempt, never automatic replay of a consumed callback.

## Scope and activation gates

This remains a server-private local integration, with no production route or public form. It closes a tested step from verified identity to pending storage; it does not provide a live signup service or decide who may become active. Enrollment approval responsibility, graduation/recovery/retention and actual operator controls remain unresolved. Existing login still creates sessions only for active accounts; pending registration never calls that operation.

Google's current Audience documentation explicitly exempts requests limited to openid/email/profile equivalents from the Testing trusted-user-list restriction. Current openid/email scope must not use Google Testing as the app's allowlist or school-admission control. School-domain verification is separate from current enrollment. [Google: Manage App Audience](https://support.google.com/cloud/answer/15549945?hl=en).

Before live signup/login: confirm the dedicated Google project/client owner, target origin/registered callback and safe secret placement; complete the actual logging/transport gate and enrollment/admission decisions. Before real posting, additionally satisfy moderation/notifications/explanation/appeal/contact and other FIRST-RELEASE.md gates. No live callback, real account, permanent access, remote data or actual deployment belongs to this cycle. AI/runtime checks are not student-value or physical-device evidence.

Implementation references: [Cloudflare prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/), [SQLite UPSERT](https://www.sqlite.org/lang_upsert.html). Runtime tests establish the affected statement behavior; documentation alone is not execution evidence.
