# OAuth HTTP adapter and closed release gate

This is local integration preparation, not a live login/signup release. The production entry keeps an explicit source-controlled release gate disabled. Runtime configuration alone cannot open authentication, even if every value is valid. The existing anonymous sample catalog and `writesEnabled:false` remain unchanged. Real callback protection must pass [LOGGING-GATE.md](LOGGING-GATE.md); configuration and local tests cannot attest platform secrecy or student eligibility.

## Cycle49 current implementation

The server-generation protocol is now implemented behind the unchanged disabled production source gate. See [current contract, subject-scoped revocation, migration and release limits](SESSION-GENERATION-IMPLEMENTATION.md). Bootstrap and action-bound command proof are required before OAuth start. Every final private SQL checks context generation. Late old cookies are rejected as signed-out and may require fresh login. Historical Cycle45/46 sections below do not describe the current session acceptance rule. This is synthetic local/provider/browser evidence, not real authentication release.

## Current proof transport

Browser command and CSRF proofs now use the shared purpose-bound Authorization format; old custom proof fields are rejected without fallback. [Transport grammar, logout dispatch and privacy limits](AUTH-PROOF-TRANSPORT.md). The source release gate remains false.

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
| `POST /api/auth/bootstrap` | Anonymous one-time context only; no account/session/attempt |
| `POST /api/auth/command?action=<intent>` | Action/context/generation-bound one-use start command; no actor or session recovery |
| `POST /api/auth/start` | Same-origin command with `Authorization: Bearer command.<proof>` starts the existing login purpose; no payload-derived authority |
| `POST /api/auth/register` | Same-origin command with `Authorization: Bearer command.<proof>` starts the existing pending-registration purpose |
| `GET /api/auth/callback` | Tries login claim, then only an unmatched claim may try registration; consumed failures never restart exchange. Every handled outcome redirects to the same fixed clean root. Callbacks never write the attempt cookie; its original expiry applies. Only authenticated active login appends a session cookie |
| `GET /api/private/session` | Reuses existing private handler: CSRF only on authenticated inspection; missing/invalid and unavailable remain distinct |
| `POST /api/private/logout-command` | One-use context/action/generation command, usable with an obsolete session Cookie; no actor/session authority |
| `POST /api/private/logout` | Confirms context generation invalidation with current-session CSRF or a one-use context logout command; no Cookie deletion |

Matched transport responses use private/no-store, Cookie variance, no-referrer, nosniff and noindex. Invalid configuration returns a generic unavailable response before database or provider work; an unexpected origin is refused. Production does not enter this adapter while its release gate is false, preserving the previous API fallback rather than exposing a configuration probe. A malformed callback never reflects its query, and the redirect has no caller-selected return URL.

The fixed clean landing page has no authentication-result UI. A redirect is not a pending-registration receipt displayed to a user or evidence of successful admission. Existing pending recording and active-only login remain distinct. This adapter does not mount the editor, profile, draft, publication, moderation or account-management routes. It does not decide enrollment, promotion, graduation, stopped-account recovery, retention or operator policy.

Local signed provider responses and D1 data are fictional. Test-only signing, identity injection, fault hooks and private JSON harnesses must never be imported by production. Raw request code/state, provider payloads, identities and session internals must not be logged or reflected in a public response. Outbound authorization deliberately includes the protocol state/nonce/PKCE values; server code exchange deliberately sends the code/verifier/client secret to Google's fixed token endpoint. That protocol exchange is distinct from disclosure in the clean landing page or JSON.

Actual Google browser redirects, SameSite/cross-site behavior, platform/CDN/browser logging, physical devices and student-value validation remain unverified by local HTTP tests. A successful current-session read discloses only CSRF to its same-origin holder; it is not a public identity API. Logout revokes the current session with existing CSRF and final-write checks; it does not revoke every session or undo completed writes. The existing session lifetime still applies to a previously issued session replaced by a later browser login.

Before any real release: select the exact origin and callback, confirm provider/public information and credential custody, verify dedicated deployment/database targets, separately authorize required remote changes, finish actual log/transport audit and eligibility/operating policy, then review the source gate and browser lifecycle under real configuration. No environment flag is a substitute for those steps.


## Historical request-time attempt-cookie ownership (Cycle45; superseded by Cycle46)

A later start replaces the single browser attempt cookie. A stale callback carrying that newer cookie has no authority to clear it: only a non-null broker result, after a matching one-time claim, supplies attempt removal. Malformed/missing/mismatched callbacks, replay losers and unconfirmed claim failures retain the same clean303/private headers without any Set-Cookie. Matched denial, verification/exchange failure and successful completion still remove the claimed attempt; only active login adds a session. Existing session cookies are not removed by callback failure.

The fixture regression applies every response's Set-Cookie to a shared jar before the next request. It reproduces A-start/B-start/stale-A-with-B-cookie and verifies B can complete after the stale response, along with matched failures, cross-purpose registration/login, replay, concurrent callbacks and DB/cookie refusals. These are local signed fictional provider/Worker/D1 tests, not a browser SameSite or real Google test. See [independent QA](QA-OAUTH-COOKIE-OWNERSHIP.md).

This is request-time ownership, not an atomic browser compare-and-delete. If A already matched and claimed with cookie A, then B starts before A's delayed clearing response arrives, the shared cookie name can still be affected by response order; that separate race is not solved here. [RFC6265 storage and concurrent-response semantics](https://httpwg.org/specs/rfc6265.html#storage-model) describe replacement by cookie identity rather than by its previous value. A null result after an ambiguous DB failure does not prove whether a claim committed. Do not reset consumed markers or automatically replay an exchange; the attempt may require a fresh start or expire. No new cookie format, schema, provider configuration, operational key or production gate change is made.

## Response ordering and remaining release blocker (Cycle46)

Callbacks now never set or delete `__Host-kobe-oauth`, including matched denial, provider/verification failure, registration and successful login. Only start writes that cookie. This also prevents an already-claimed A response from deleting B after B starts; matching the request cookie cannot authorize a later browser compare-and-delete. Lower-level `clearCookie` return fields remain for API compatibility but the HTTP adapter ignores them. No attempt schema or format changes.

The encrypted cookie can remain for the rest of its original maximum600-second browser lifetime after consumption, instead of being removed early. It contains state, browser binding and PKCE verifier plus JWT context/time claims, without code, provider tokens, client secret or session token. AES-GCM encryption and host-only Secure/HttpOnly/SameSite=Lax attributes remain; callbacks neither refresh the cookie nor its JWT expiry. Atomic DB consumption still rejects replay, and JWT/DB expiry refuses an unconsumed old attempt even if a client ignores browser expiry. Retention is a tradeoff: encrypted verification material accompanies later same-origin requests during that remainder and could appear in Cookie/header logging. HttpOnly does not protect platform logs; compromise of the operational encryption key could reveal captured ciphertext. No such key is created by these tests. Existing [logging gate](LOGGING-GATE.md) must still cover Cookie headers, callback URLs and platform/error traces; absence of app logging is insufficient evidence.

**Historical Cycle46 finding, superseded by the gated Cycle49 implementation:** latest-identity session response ordering was not satisfied. A success response prepared for active identity A, held until active B completes, replaces the shared session cookie with A when applied last. Both sessions remain independently valid server-side. This candidate fixes attempt deletion only. The executable fixture deliberately asserts that hazardous A-after-B result as a release-blocker reproduction, not a safe acceptance condition. The production source release gate stays false, with no real Google flow or remote changes. See [independent QA](QA-OAUTH-LATE-RESPONSE.md).

Before enabling authentication, choose and validate a server-side coordination protocol. A candidate uses a browser coordination generation, atomically records the verified result for that generation, and finalizes through a same-origin CSRF-protected command rather than issuing the session directly in the provider callback. Every authenticated request must reject sessions from an obsolete generation. A finalization CAS alone is insufficient: a response authorized before B may still arrive after B. Generation validation can fail closed on stale A but can leave the browser signed out; recovery and the user's intended identity require explicit acceptance tests. A stable anonymous coordination cookie needs fixation, rotation, stolen-cookie and multi-device review and must not become a reusable authentication credential. This requires separately reviewed state/schema design, not an unreviewed gate flip.

An alternative serializes identity transitions using server coordination and acknowledgment, but delayed responses, lost acknowledgments and timeouts must not reopen the race. Browser-only locks/BroadcastChannel, per-attempt cookie names, or JavaScript ignoring a stale body cannot alone stop the browser applying a shared session Set-Cookie header. Required evidence includes controlled reverse header application, different active identities, concurrent tabs, replay/expiry, logout, fail-closed handling and recovery. Actual browser/Google transport remains separate from this local fixture.

## Pending-only pilot exception

The normal `OAUTH_HTTP_RELEASE_ENABLED=false` remains unchanged. Complete Google configuration alone opens no route. The explicit pilot integration additionally requires the private, strictly parsed `OAUTH_PENDING_PILOT` JSON policy with `allowedEmail` and `expiresAtMs`; the deadline must be future, at most24hours away, and an integer epoch millisecond value. Do not commit the selected identity or operational policy. Invalid, missing or expired policy closes the pilot.

The pilot serves `/api/auth/pilot` and a same-origin external script, then permits only bootstrap, a pending-registration command, register and registration-purpose callback. Register returns private no-store JSON containing the Google authorization URL and the existing sealed attempt Cookie. The browser navigates explicitly; it does not try to read the Location of an opaque manual redirect. The callback performs actual Google JWT verification, then exact email equality and a fresh deadline check immediately before the existing pending receipt store. Other identities are not persisted. It never falls back to login, creates a session, grants an operator role or enables private/posting routes. Callback outcomes are only `/api/auth/pilot#received` or `#unavailable`, without identity/token details.

This is consent to save the verified school email/subject privately for a pending application, not enrollment approval or posting permission. Removing the private policy closes the pilot; it does not erase a deliberately accepted pending account. Existing protected retention/withdrawal procedures govern stored records. UI and responses do not embed the selected email. Normal OAuth, logging, admission and production release requirements continue to apply. Local synthetic JOSE/browser results do not prove real Google consent-screen configuration or acceptance of an actual school identity.

Pilot routing follow-up: `/api/auth/pilot` and its external JS run inside the existing `/api/*` worker-first assets rule, before the generic auth handler. A local actual-production-entry browser check loads the configured static asset SPA fallback, then the pilot, and completes after a pre-existing context/bootstrap409; command issuance still validates that context. Late canonical GET callbacks after policy expiry/removal clean-redirect without DB/provider access. Other disabled factory and general route contracts remain closed.
