# Server-only Google exchange and ordinary self-registration

`GoogleLoginBroker` joins the browser-bound one-time claim, Google ID-token verifier and private account/session stores. The [HTTP adapter](OAUTH-HTTP.md) imports it, but its ordinary production routes remain behind the unchanged disabled source gate; the separately configured legacy pending pilot has a narrower contract below. This source change configures no live OAuth client, secret or encryption key and opens no production signup.

Start and callback require complete canonical HTTPS/client/key/secret configuration before creating or consuming an attempt. A successful callback claim is consumed before the outbound exchange, so a provider failure cannot replay it. The broker sends a form only to `https://oauth2.googleapis.com/token` with the exact server callback URL and stored PKCE verifier. It requests no refresh-token/offline access and exposes no provider payload.

Workerd supports manual redirect handling rather than `redirect: 'error'`; the broker uses manual handling and rejects non-success or redirected responses. Token headers and body acquisition race an explicit five-second deadline, aborting the upstream operation. Late results cannot verify identity, provision an account or create a session; cancellation is handled without waiting for a stalled cancellation promise. The streamed body limit is 32 KiB. Google signing-key retrieval has its existing independent five-second timeout; the exchange budget is not a guarantee for the entire callback's wall-clock duration. The returned ID token is verified by the existing RS256 Google JWKS verifier, including exact audience, issuer, nonce, verified email and school-domain claims. Account/session work occurs only after that verification.

## Three distinct broker paths

| Broker methods | Local contract |
| --- | --- |
| `start` / `callback` | Ordinary login; unchanged login audience and existing active Google subject only. Creates no account and does not require a current participation period to issue an identity session |
| `startSelfRegistration` / `selfRegistrationCallback` | Ordinary registration; two required private academic years, distinct sealed `\|self-registration` audience, verified identity and one terminal account/declaration/session transaction |
| `startRegistration` / `registrationCallback` | Legacy `pending-registration` purpose and `\|pending-registration` audience; generic pending receipt only, with no activation or session |

Ordinary registration follows the accepted [school Google identity and self-declared participation policy](adr/0001-self-declared-enrollment.md), using the [glossary](../CONTEXT.md). Manual enrollment review and document submission are not required registration stages. The two fields are `admissionYear` and `graduationYear`, interpreted as academic years by [src/shared/enrollment.ts](../src/shared/enrollment.ts). The app's period starts April 1 at 00:00 JST in the admission academic year and ends, exclusively, April 1 after the graduation academic year. This convention is not school-certified enrollment or an inferred course length; Google name/photo and the private years are not auto-published.

The HTTP controller validates an exact two-field, bounded JSON body before executing a registration start command. The database action/attempt intent remains `login`; the distinct sealed audience and immutable metadata bind registration years to the exact executed command/attempt. A wrong-purpose handler fails before consuming that claim. No year, client email or public-profile year is sent to Google as authority. The local protocol uses one Google authorization/exchange without a separate approval or second-login step.

After verification, `SelfRegistrationStore` performs one D1 transaction: resolve the stable Google subject, create a new account or activate a pending account, save its initial declaration, create a session and complete the attempt. Its temporary commit guards the exact epoch/fence transition caused by its own activation; it does not weaken normal subject-fence or browser-generation checks. Missing final session creation rolls back all partial account/declaration/activation changes. Existing active accounts without a declaration can explicitly supply one; existing declarations are retained on repeat callbacks. Corrections use the separate private version-checked enrollment form. Suspended/deleted accounts remain blocked, stored contact is not overwritten and a different subject's matching email never links accounts.

An active account is distinct from current student participation. Final student contribution SQL additionally checks saved participation dates and fresh server time. Identity login, year correction, private ownership reads/cleanup and logout use their base authority even when a period is missing, upcoming or ended. Registration and year correction do not restore a suspended/deleted account.

## Results and callback cookies

Matched failure returns a generic private result. Provider bodies, error details, code, verifier, secret, identity and tokens are not included in failure results or application logs. Successful ordinary login or self-registration returns private cookie/CSRF/actor data to trusted server code only; the pending path returns only its generic receipt. Never serialize these broker internals as a public JSON endpoint. The test-only JSON harness is never deployed.

Lower-level `clearCookie` fields remain for compatibility, but the current HTTP adapter ignores them. Only a start response writes `__Host-kobe-oauth`; callbacks never set/delete it, including denial, failure and success. Its original expiry and atomic attempt consumption remain in force. A successful ordinary login or self-registration appends only the session cookie. Other callback outcomes set no cookie, and every handled ordinary outcome redirects to the same fixed clean root. The redirect itself does not prove success. Current context-generation checks refuse obsolete session cookies even if an old successful response arrives later. See [HTTP and historical response-order evidence](OAUTH-HTTP.md).

## Scope and release limits

Tests use ephemeral RSA keys and fixed-endpoint outbound stubs in local Workers/D1. They establish bounded fictional behavior, not live Google acceptance, browser/device behavior, platform-log protection, school-certified enrollment or student value. Migrations [0016](../migrations/0016_self_declared_enrollment.sql) and [0017](../migrations/0017_self_registration.sql) have not been applied remotely by this implementation. The ordinary production source gate remains false and the public sample-only boundary remains unchanged.

Real connection still requires the verified deployment/database migration ledger, dedicated Google configuration, [actual logging gate](LOGGING-GATE.md), real browser lifecycle evidence and the other applicable [release gates](FIRST-RELEASE.md). Posting additionally requires stored-owner checks, draft/media privacy and moderation/operational conditions. The accepted declaration policy and local tests do not complete those remaining gates.

## Historical pending-only preparation

The initial broker provided existing-active-account login without account provisioning. Later [pending-registration preparation](PENDING-REGISTRATION.md) added a separate pending receipt, leaving approval/activation outside that path. That historical contract is retained by `startRegistration` / `registrationCallback` and the explicitly configured [legacy pending pilot](OAUTH-HTTP.md#distinct-legacy-pending-only-pilot-exception). It is not the ordinary self-registration path or a mandatory manual-approval stage. A legacy pending receipt still provides no active account, session or posting permission.

The ordinary browser controller uses JSON start responses and the fixed clean `/account` landing; [the actual app routes, private state confirmation and closed frontend/server gates](ORDINARY-REGISTRATION.md) are separate from broker issuance. Callback landing alone never establishes registration success.
