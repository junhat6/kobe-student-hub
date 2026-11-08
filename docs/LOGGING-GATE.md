# OAuth callback logging release gate

Status: **PARTIAL OPERATIONAL AUDIT / NOT SATISFIED**. A bounded synthetic probe of the existing closed preview has run; see [scope, capture results and limits](QA-CLOSED-PREVIEW-LOGS.md). It does not exercise an enabled OAuth callback or provider exchange. No actual credential leakage has been established. Complete this gate before real OAuth is connected.

A later [single queryless control](QA-LOG-CONTROL.md) also returned zero stored rows after a completed exact-URL query. Its query execution and condition echo were verified, but positive correlation, full-row inspection and redaction were not. The existing sampling/settings and closed authentication boundary were preserved; this additional result does not satisfy the gate.

A separate [bounded real-time control](QA-REALTIME-LOG-CONTROL.md) first stopped before correlation, then a reviewed binary-representation correction correlated one closed fallback invocation with its request and version. Owned Tail/process cleanup and unchanged settings were verified separately. This is narrow real-time evidence; stored-log, sensitive-field and OAuth-branch coverage remain unresolved. The release criteria below are unchanged.

## Why app-level silence is insufficient

Cloudflare's [Workers Logs documentation](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) describes invocation logs with request/response metadata. Application logger redaction or the absence of console.log cannot establish what an edge/access log, invocation record, tracing layer, exception collector or downstream drain stored. A normal URL redirect or no-referrer header also does not erase earlier request records. Query-to-body changes alone do not prove that bodies/cookies are omitted.

The source's observability settings are not evidence of actual deployed redaction. Sampling is not proof of absence, and a missing sampled event must be marked inconclusive. Do not claim that this repository's current logs are already proven to exclude OAuth values.

## Required preflight

Before enabling a callback:

1. Inventory the actual request path and all logging layers: edge/access/security logs, Worker invocation logs, application logs, traces/exceptions, provider error handling, local debug/tail, CI/deployment logs and any external drains/retention. Keep account-specific settings and raw log exports private.
2. Identify every sensitive field: authorization code, state/nonce/browser binding, PKCE verifier, client secret, Authorization/Cookie headers, session/ID/access/refresh tokens and unnecessary profile/email data. Do not serialize entire Request/Response, URLs, query strings, headers or provider error bodies into application logs.
3. Verify supported platform controls with current docs and the actual settings. Select a scoped solution that retains appropriate error/security signals. Do not silently disable security monitoring globally or assume an unsupported per-field redaction exists; follow applicable permission rules for material protection changes.
4. Design callback transport, browser-cookie behavior, clean redirect/error response and referrer controls together. Provider and browser compatibility must be tested; do not choose a transport merely because one log layer happens not to show it.

## Actual-log verification, in an authorized isolated preview

Use unique **synthetic** canaries, never real credentials, to probe sensitive query/body/header positions for the paths the app will actually use. Exercise success, denial, malformed/duplicate/expired state, provider error, timeout and unhandled-error paths. Verify each expected invocation/error signal was captured; absent coverage is inconclusive, not a pass. Use complete appropriate test capture rather than relying on ordinary sampled negative results.

Inspect the actual authorized log/trace/export destinations for the canaries and for unintended raw request/provider data. Report only sanitized findings and coverage; do not paste raw logs, account details, credentials or personal information into public GitHub. Define private evidence retention and access. No automatic test in this repository currently performs this operational audit.

A valid record states the exact preview release and settings checked, request cases, log destinations covered, capture completeness, observed redaction/omission and unresolved gaps. The conclusion must be narrow: which fields/layers/cases were verified. It must not become an unqualified promise that no sensitive data can ever reach any log.

## Release decision

Connecting a callback requires: one-time state/nonce attempt claim, browser binding/PKCE and server provider verification, secure session/CSRF design, and this platform-plus-actual-log gate. Any unknown logging layer, unsampled-coverage gap or sensitive value found in a destination is unresolved. Keep real login/posting unavailable until the relevant gates are satisfied. A pure helper test or app-only logger check cannot close this gate.
