# Author session lifecycle — bounded local privacy checks

Issue #47 addresses the already required #4/#38 logout/session-change boundary while external school Google settings and operating decisions remain unavailable. The selected unit is an observable local author session shell, not another unconnected policy placeholder. Source PRD is unchanged. This is not actual Google integration or proof that real-user data protection is complete.

## Current-token HTTP

The unconnected GET `/api/private/session` authenticates an existing cookie and returns only its CSRF value. It does not create an account, return actor/email/provider identifiers or grant authority. The value also distinguishes a particular session for UI remounting; it is not a new authentication credential or proof of which human is present.

POST `/api/private/logout` requires the existing Origin/CSRF/session checks and an empty command. Actual local Workers exposes an empty POST as a non-null stream with Content-Length0; this zero framing is accepted and cancelled without reading. Declared nonzero/unknown streamed framing, transfer encoding or a content type is rejected; the handler never accumulates an unused body. The raw browser client sends neither body nor Content-Type. Actual provider/edge framing remains to be tested before live use.

Logout confirms and clears its cookie only after the current token's revoke statement changes exactly one row. A successful SQL call with zero changes does not prove revocation: actual local D1 fault injection can suppress that update while the token stays usable. That case returns unavailable without a success cookie. Other sessions remain valid; this endpoint does not claim to log out every browser/device.

A session lookup distinguishes confirmed missing/invalid sessions from unavailable storage. A database failure returns503, so an outage cannot be treated as proof of sign-out and discard retained author input. Existing store callers keep their previous fail-closed authentication contract.

All session responses/errors are private/no-store with Vary:Cookie, no-referrer/noindex/nosniff and bounded generic JSON. An unauthorized GET is not a real Google sign-in flow. No production route imports this handler.

## Local author controller

`/lab/account` checks only an existing session. It never invokes a fictional identity helper or silently logs a user back in. The old `/` editor fixture keeps its original test bootstrap behavior; it is separate from this account lab and must not be confused with a real login controller.

Authenticated author components receive an optional guarded fetcher; existing standalone labs keep their previous defaults. Their subtree is keyed to the captured session value. Known logout/invalid session or a detected changed value discards that subtree before further private UI is shown. A changed value needs a fresh check and explicit continue before a new editor/profile state is mounted; previous input is not copied to it.

Focus/pageshow/visibility checks conceal and make the retained subtree inert while verification is pending. A transient unavailable proof keeps the same-session text in memory but hidden; a successful same-value check resumes the same component instance. A signed-out/changed result discards it. Explicit logout always discards author state immediately, including pending work, even if the server response later fails. A manual active-session check after uncertain logout does not automatically reopen the editor.

The logout action explains that unsaved text/publication preparation will be lost and asks for an explicit discard decision. A successful logout is current-token only. An unconfirmed response remains visibly unconfirmed rather than claiming that server revocation occurred.

## Consumption guard and races

The guard uses raw, bounded, nonrecursive session lookups before a private request, after response headers and before body EOF is released to an SDK. It compares the observed value with the captured one. Responses remain bounded by their existing SDK readers. Invalidated generations and linked abort signals reject old fetch/body results. A stable outer fetch proxy preserves SDK/component identity when the same hidden session resumes.

This blocks the exercised case of old private response bytes arriving after a detected account-cookie change or explicit logout. Existing server CSRF/owner/live-account checks remain the write authority. Cancelling a fetch cannot undo a mutation already committed by the server. Error responses may be cancelled early by SDKs, so the header check also matters.

This is not an atomic observation of an HttpOnly cookie at every possible instant. Each proof is a network observation; a cookie can change after the last lookup. No instant cross-tab detection, secure heap erasure, clipboard/file/browser-history clearing, provider callback coordination or all-route identity controller is claimed. Actual OAuth/login/logout/controller integration, platform logs/cache, admission/graduation and private media still need their own evidence before real data is accepted. Standalone report/operator labs are outside this author-shell completion scope.

## Evidence and release boundary

Use actual local D1/session revocation for HTTP checks, and targeted stream/generation/cancellation tests for the guard. Final PC/mobile browser checks should cover anonymous no-autoidentity, current-token logout, unknown logout/manual state, same-session focus preservation and changed-session delayed-response rejection. A localhost-only fixture header can return actual saved-draft headers/first bytes immediately and delay the rest/EOF by5seconds. This separates header-time proof from body-completion proof in a browser instead of pretending a held whole response is a delayed body. It uses no global mutable request state and must never be deployed. Fault/latency injection is synthetic; actual local Cookie/session/private-store behavior is distinct from actual Google/Cloudflare deployment behavior.

Independent QA runs after source freeze, records hashes and keeps app-only screenshots local. AI operation checks are not student usefulness or physical-device validation. Production entry/assets/sample-only gates remain unchanged; no new migration, remote0004–0007, credentials/real grants, contracts/R2/mail, deployment or screenshot publication is part of the cycle. Previous held originals are not retried.
