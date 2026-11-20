# Browser-bound PKCE attempt — closed integration stage

## Purpose and priority

After preview migration 0003, the next #4 dependency is tying the real one-time store to the initiating browser and PKCE. This is more useful than another sample UI: it tests a concrete login-CSRF/replay boundary before real identity can authorize private writing. The owner permits progressing toward enabled login/posting. That permission does not supply a Google client, create a production key or prove the remaining release gates.

`worker/auth/browser-flow.ts` is server-only and unconnected to production routes. It neither exchanges a provider code nor issues an authenticated session/account. The test-only entry returns internal values for assertions; publishing it would expose secrets and is forbidden. Production `worker/index.ts` and its `/api/*` refusal remain unchanged.

## Start and transport

Configuration must supply an exact canonical HTTPS app origin, dedicated Google web client ID and a 32-byte cookie-encryption key. Missing/invalid settings fail before a DB attempt is written. There are no production defaults or generated/persisted real keys. A real key or OAuth credential must be provisioned only through the applicable authorized secure setup, never source/chat/log output.

The start action accepts only a POST to the app's `/api/auth/start`, with exact Origin and compatible Fetch Metadata. This is a login-start request-origin check, not authentication or complete session CSRF protection. Caller config comes from trusted server settings, never JSON/Host claims. The fixed Google endpoint receives response_type=code, scopes openid/email, nonce/state, exact own callback URI, and S256 challenge. The hosted-domain parameter is only a UI hint; it never establishes school identity/enrollment.

A fresh 256-bit verifier is kept with state/browser-binding in an authenticated-encrypted JOSE JWE (dir/A256GCM). The cookie uses __Host- prefix, Secure, HttpOnly, Path=/, SameSite=Lax and 600-second Max-Age, without Domain. Issuer/audience bind it to this client and callback; iat/exp/max age are checked against trusted server time. Time is read again after crypto; expired cookies and a backwards clock at that boundary fail closed instead of using the earlier instant. This is a request-side decision timestamp, not a guarantee about the remote database wall clock at commit. No raw verifier/browser-binding goes in the provider URL or D1. State/browser digests and nonce remain in the existing attempt table.

One cookie name means a later start replaces an earlier tab's cookie; the earlier tab can fail safely. This stage does not claim parallel-tab UX or key rotation. Crypto/response failure after attempt creation can leave an orphan row. Ten-minute validity is not retention; cleanup/rate limits and operational monitoring remain required.

## Claim and failure behavior

A provider callback is a cross-site top-level GET; it must not be subjected to the start POST Origin rule. Only the exact configured callback origin/path is accepted. Lengths are bounded, duplicate security query/cookie fields and ambiguous code+error are rejected, and malformed or wrong-cookie/state/time/client contexts fail closed without burning the legitimate attempt.

After decrypting and matching state/browser context, the existing single conditional D1 UPDATE claims the attempt before any provider exchange or session side effects. The winning server caller receives the private code, verifier and stored nonce. They are not an HTTP JSON DTO, a log record or authenticated user identity. A bound provider denial consumes once and returns only a generic denied result. The caller receives a clearing Host cookie for a successfully claimed result/denial; invalid unmatched callbacks must not clear a different valid in-progress browser flow.

No failed/ambiguous exchange may reset the consumed attempt. Restart with fresh values. Code exchange, real signature verification with the existing Google verifier, enrollment/admission and stored-account/session issuance must follow; a claim alone cannot authorize data access. Future HTTP integration must set no-store/referrer protections, apply clear-cookie/clean redirects on the appropriate paths, and never serialize internal results. Current sample API middleware is not proof of a future controller implementation.

## Session, CSRF and logs remain gates

Opaque sessions need trusted identity/admission, stored lifecycle, rotation/revocation/expiry, fixed server-loaded actor/owner policy, secure session cookies and CSRF protection for authenticated writes. This stage does not create a session token, session table, user role, draft endpoint or CSRF-token bypass. Technical local design can proceed, but real credentials/grants require the applicable setup confirmation.

[LOGGING-GATE.md](LOGGING-GATE.md) is still NOT SATISFIED. Query codes/state, request cookies and provider errors can reach platform layers even when this helper contains no logger. Real callback wiring requires actual settings/coverage and synthetic-canary log verification; neither app-only silence nor these local tests close that gate. No real credentials or secret queries were sent to the public preview.

## Evidence limits

Real SHA-256/JWE crypto and actual local Workers/D1 exercise the RFC7636 vector, fixed-provider fields, exact Origin, settings failure before DB writes, encrypted context tampering, wrong browser/client/state, duplicate inputs, expiry, one-time replay/concurrency and provider denial. Cookies are supplied as Request headers in a test-only fixture; this does not demonstrate a browser enforcing Secure/Lax/Host, Google redirects, Safari behavior, real token exchange or platform-log secrecy. No test attempt is written remotely. Independent QA records its own subset and production refusal checks separately.

Primary references: [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect), [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636), [JOSE EncryptJWT](https://github.com/panva/jose/blob/main/docs/jwt/encrypt/classes/EncryptJWT.md), [JOSE jwtDecrypt](https://github.com/panva/jose/blob/main/docs/jwt/decrypt/functions/jwtDecrypt.md). These sources inform the protocol/library choices; they are not evidence of this app's live integration.
