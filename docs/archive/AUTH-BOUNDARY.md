# School identity boundary — Cycle 03

## Purpose and actual scope

Prepare the cryptographic and ownership boundaries before implementing real sign-in. This cycle adds server-only helpers and tests. It does not add a login/callback route, exchange an authorization code, create Google credentials, issue sessions/cookies, create real accounts, activate a new permission grant, provision D1 or enable posting. The production Worker still refuses write/auth attempts and exposes only published fictional sample content.

This is part of [#4](https://github.com/junhat6/kobe-student-hub/issues/4), not completion of authentication or release readiness. Open PRs and current main were checked before implementation; no other open development PR overlapped this work.

## Real verifier, not token decoding as authentication

`worker/auth/google-identity.ts` uses JOSE `jwtVerify` with Google public signing keys from the fixed HTTPS JWKS URI in Google's discovery metadata. It does not use client-provided keys, a client-provided JWKS URL, a decoded-only payload, a mail suffix alone, tokeninfo debugging, or a development bypass.

Checks:

- Only RS256, as advertised by Google's discovery metadata; real signature verification.
- Google issuer (`https://accounts.google.com` or the documented `accounts.google.com`) and the server-configured dedicated web-client audience. Multi-audience tokens are deliberately unsupported initially. If `azp` exists it must match that client.
- Required `sub`, `exp`, `iat`, nonce, email, verified-email flag and hosted-domain claims. Expiry and issued-at are checked by JOSE; 5 seconds of clock tolerance and a 10-minute maximum token age are conservative local choices for a future sign-in callback, not a claimed Google requirement.
- An exact nonce match against the server-bound attempt's expected value. Missing/short expected nonce, invalid/missing client configuration, malformed or >16KiB token fail before key lookup.
- `email_verified` must be boolean true; the signed `hd` claim must equal `st.kobedenshi.ac.jp`. Also require a well-formed email with the exact school domain, not a lookalike suffix.

The key resolver has a bounded request timeout and caches public signing keys only. A cached valid public key can still verify a token while Google is unavailable; if lookup/verification fails, return null without a decode-only fallback. No token or private identity is retained in module state or logged. Return only private provider/subject/email, deliberately excluding Google name/photo. Google `sub`, not email, is the stable external identity key. Public profiles must use an independent explicit DTO and chosen display name.

## What nonce verification does not do

The verifier is stateless. Comparing a nonce does **not** atomically consume an OAuth attempt or make a token single-use. A future flow must generate high-entropy state/nonce plus PKCE, bind them to the browser/attempt, validate state and a registered redirect URI, exchange a code server-side, verify the resulting ID token, atomically consume the attempt, then issue/rotate an opaque server-side session. Replay, CSRF, concurrent callback, fixation, logout/revocation and expiry tests are required before opening that flow. Do not expose this helper as a public accept-a-token login endpoint.

No clientId, secret or nonce is configured in the current app, and no session actor is being created from this helper. The future trusted context must come from server settings and a verified, unconsumed attempt, never request JSON or a client-chosen nonce.

## Identity, enrollment and ownership are separate

A verified school Google account is not proof of current enrollment. Graduation-year boundary, exceptions and authoritative enrollment status are still unresolved; real posting remains closed. Do not infer current enrollment from email availability, a client-supplied graduation date or a public profile year.

`worker/auth/private-access.ts` is a narrow pure policy: a future trusted server session's active local account may read its own private record; missing, suspended, deleted, other-owner or empty-account cases are denied. It is not authentication, session validation, a database query or an administrator bypass. Callers must load the actor from the future verified server session and the owner from stored data; accepting either from a client would invalidate the policy. Real draft/history/media endpoint integration and negative IDOR tests are still pending.

## Tests and boundaries of evidence

Tests generate ephemeral RSA keys in memory, sign real JWTs with JOSE, and supply their public JWKS only at the fixed Google key-fetch boundary. The production verifier is not mocked or replaced. Tampering, another private key, unknown key ID, HS256 confusion, foreign issuer/audience/presenter, missing/expired/old/future claims, unverified email, lookalike domains, nonce failure and missing configuration are rejected.

The same production verifier runs inside a Miniflare Workers instance. `tests/fixtures/auth-worker.ts` is a separate test-only entry point bundled under ignored `.worker/`; production `wrangler.jsonc` does not reference it. Its outbound fetch service supplies the fixture's public keys, without contacting a real Google account. No private key is stored or published. The real app's callback/write attempts remain refused, even when a client sends identity/admin claims; no session cookie is issued.

These are cryptographic/runtime/negative-boundary tests, **not live Google integration, session security, real record authorization, enrollment verification or student value validation**. The independent QA report records its own execution separately.

## Follow-up gates before real users

1. Authorized OAuth client configuration, restricted registered redirect URIs and secure secret delivery, with no new broad grants as a shortcut.
2. Server-bound one-time attempt/PKCE/state/nonce store and opaque session lifecycle, CSRF/rate limits and callback replay tests.
3. Private account vs public profile schema; server-loaded actor/owner; draft/history/media access tests; graduation and recovery/deletion policy.
4. Moderation, distinct-reporter temporary hiding, protected operator controls, reliable notification/contact/appeal path and release rules.
5. Real OAuth and browser/device tests, independent QA, and an agreed small student trial. Do not activate real posting merely because token verification passes.

## Primary references

Checked 2026-11-03:

- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect): signature, issuer, audience, expiry, nonce, hosted-domain claim, subject vs email.
- [Google discovery metadata](https://accounts.google.com/.well-known/openid-configuration): issuer, JWKS URI, RS256 and S256 PKCE support.
- [JOSE jwtVerify](https://github.com/panva/jose/blob/main/docs/jwt/verify/functions/jwtVerify.md) and [remote JWKS resolver](https://github.com/panva/jose/blob/main/docs/jwks/remote/functions/createRemoteJWKSet.md): real signature/claim validation and signing-key lookup/cache.
