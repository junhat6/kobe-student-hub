# Browser proof transport

The source-controlled OAuth release gate remains false. This change prepares browser proofs for future real controller use; it does not enable login, posting, enrollment review or any new endpoint. No schema, production configuration or secret changes are required.

## One sensitive header, two explicit purposes

`src/shared/auth-proof.ts` is a pure client/server module. Its generator writes only:

- `Authorization: Bearer command.<43-character base64url proof>` for a one-use browser command.
- `Authorization: Bearer csrf.<43-character base64url proof>` for an authenticated session mutation.

The parser accepts that exact grammar. The purposes cannot substitute for each other. It rejects unknown schemes/purposes, wrong lengths/characters, extra separators and comma-joined duplicate credentials. Fetch Headers combines duplicate fields and normalizes HTTP optional whitespace before this API; the parser does not claim to reconstruct raw wire bytes or reject whitespace already removed by that normalization.

The old `X-Session-Command` and `X-CSRF-Token` fields have no fallback. Their presence, including an empty field mixed with a valid Authorization value, invalidates proof handling. Session inspection and browser-context operations also refuse those legacy fields rather than silently treating them as an alternate credential. The HTTP adapter returns a generic refusal without issuing a context cookie for a legacy/mixed bootstrap.

These are browser proofs, not independent login credentials. A command still needs its bound context Cookie, exact Origin/same-origin checks, action, expected generation, one-use database record and expiry. A CSRF mutation still needs the current opaque session/context Cookies, matching CSRF value, Origin, ownership and the shared final SQL authority check. Read-only clients do not attach a proof. CSRF values returned by session inspection remain raw private values in memory; clients format the header only when sending a mutation.

## Logout and clients

Logout branches on the parsed purpose, never on whether an Authorization field merely exists. A csrf-purpose request uses the existing authenticated logout path. Its internal one-use logout command replaces the Authorization value with command-purpose formatting before final execution. A context-command logout uses only its one-use command path; a CSRF value labeled as a command cannot acquire that authority, and a command value labeled as CSRF cannot bypass the session comparison.

Editor clients import the same generator used by trusted server code. Fictional browser fixtures encode the same wire format directly where `page.evaluate` cannot capture imported functions. Deliberately malformed wire tests continue constructing raw invalid strings rather than calling a validating generator. Two old publication-client fixtures used a short placeholder; they now use a valid43-character fictional value so their original publication/timeout assertions still exercise the request rather than being stopped by header validation.

`X-Lab-Command` and `X-Lab-Session-CSRF` in the older isolated session-order model are separate test-only protocols. They are not application proof transports or production imports. They are intentionally not renamed as if they were live credentials.

## Privacy and remaining gates

Proofs belong in a field recognized as sensitive by standard tooling; custom field names should not be assumed confidential. This source contract is not proof that every platform, proxy, trace, exception, tail or downstream destination redacts Authorization correctly. Do not log whole requests/headers, move proofs into URLs or bodies, persist them in browser storage, or reflect failed proof values. Continue to satisfy [LOGGING-GATE.md](LOGGING-GATE.md) and the actual release/privacy/eligibility gates before enabling real authentication.

The transport change preserves the existing session generation, one-time claim, revocation, expiry, CSRF and final SQL rules. Tests cover purpose separation, old and mixed headers, duplicates/malformed values, missing Cookie/Origin, and both real logout paths in local D1. Existing cryptographic/provider, actual browser ordering and editor regressions remain separate evidence rather than being replaced by parser tests.
