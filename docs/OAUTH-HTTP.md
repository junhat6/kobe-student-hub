# OAuth HTTP adapter and closed release gate

This is local integration preparation, not a live login/signup release. The production entry keeps an explicit source-controlled release gate disabled. Runtime configuration alone cannot open authentication, even if every value is valid. The existing anonymous sample catalog and `writesEnabled:false` remain unchanged. Real callback protection must pass [LOGGING-GATE.md](LOGGING-GATE.md); configuration and local tests cannot attest platform secrecy or student eligibility.

## Configuration contract

The adapter accepts optional request-scoped bindings rather than reading process environment or keeping mutable configuration globally. No actual origin, provider project/client, user contact, key or secret is committed. The deployment configuration and generated Env still describe the existing sample bindings. Optional authentication input types describe validation, not installed secrets or a new secret store.

| Input | Intended future placement | Validation / scope |
| --- | --- | --- |
| `AUTH_ORIGIN` | Non-secret server configuration | Exact canonical HTTPS origin, without path/query/fragment/userinfo |
| `GOOGLE_CLIENT_ID` | Non-secret server configuration | Dedicated Web client audience, bounded provider format |
| `GOOGLE_CLIENT_SECRET` | Worker secret binding | Bounded printable secret; never client assets or public vars |
| `OAUTH_COOKIE_KEY` | Worker secret binding | Canonical base64url encoding of exactly 32 bytes |

Cloudflare [secret bindings](https://developers.cloudflare.com/workers/configuration/secrets/) expose encrypted text through the Worker environment; ordinary vars are not encrypted. Choosing a specific Worker, access scope, safe custody and the mechanism for generating/inserting real credentials requires a separate concrete operation. This change creates none. No required-secret declarations are added to the sample config: absent authentication inputs must keep the existing sample deployable. Later dedicated deployment configuration must declare and generate matching types for its actual bindings.

## Deliberate limits

With an explicitly enabled local adapter and fully valid fictional configuration, the transport contract is:

| Endpoint | Behavior |
| --- | --- |
| `POST /api/auth/start` | Same-origin command starts the existing login purpose; no payload-derived authority |
| `POST /api/auth/register` | Same-origin command starts the existing pending-registration purpose |
| `GET /api/auth/callback` | Tries login claim, then only an unmatched claim may try registration; consumed failures never restart exchange. Every handled outcome clears the attempt cookie and redirects to the same fixed clean root. Only authenticated active login appends a session cookie |
| `GET /api/private/session` | Reuses existing private handler: CSRF only on authenticated inspection; missing/invalid and unavailable remain distinct |
| `POST /api/private/logout` | Reuses existing current-token CSRF/logout handler, including its empty-body and final-write checks |

Matched transport responses use private/no-store, Cookie variance, no-referrer, nosniff and noindex. Invalid configuration returns a generic unavailable response before database or provider work; an unexpected origin is refused. Production does not enter this adapter while its release gate is false, preserving the previous API fallback rather than exposing a configuration probe. A malformed callback never reflects its query, and the redirect has no caller-selected return URL.

The fixed clean landing page has no authentication-result UI. A redirect is not a pending-registration receipt displayed to a user or evidence of successful admission. Existing pending recording and active-only login remain distinct. This adapter does not mount the editor, profile, draft, publication, moderation or account-management routes. It does not decide enrollment, promotion, graduation, stopped-account recovery, retention or operator policy.

Local signed provider responses and D1 data are fictional. Test-only signing, identity injection, fault hooks and private JSON harnesses must never be imported by production. Raw request code/state, provider payloads, identities and session internals must not be logged or reflected in a public response. Outbound authorization deliberately includes the protocol state/nonce/PKCE values; server code exchange deliberately sends the code/verifier/client secret to Google's fixed token endpoint. That protocol exchange is distinct from disclosure in the clean landing page or JSON.

Actual Google browser redirects, SameSite/cross-site behavior, platform/CDN/browser logging, physical devices and student-value validation remain unverified by local HTTP tests. A successful current-session read discloses only CSRF to its same-origin holder; it is not a public identity API. Logout revokes the current session with existing CSRF and final-write checks; it does not revoke every session or undo completed writes. The existing session lifetime still applies to a previously issued session replaced by a later browser login.

Before any real release: select the exact origin and callback, confirm provider/public information and credential custody, verify dedicated deployment/database targets, separately authorize required remote changes, finish actual log/transport audit and eligibility/operating policy, then review the source gate and browser lifecycle under real configuration. No environment flag is a substitute for those steps.
