# OAuth callback logging release gate

Status: **SCOPED FORM-POST PLATFORM VERIFICATION COMPLETE**. The attempted real Google code flow returned query parameters despite `response_mode=fragment`; registration did not complete and production OAuth was closed again. The replacement requests `form_post`, seals a separate 60-second encrypted return cookie and resumes the original Lax-cookie broker through a fixed clean GET. An anonymous Google browser probe confirmed this POST delivery, not successful real-user login. [PR #120](https://github.com/junhat6/kobe-student-hub/pull/120) records the independent checks and release evidence. Real posting remains closed.

The new carrier's isolated platform audit covered five phases: POST staging, successful completion, duplicate input, tampered carrier and replay. Independent stored-query inspection found all five target invocation events and five completion signals, with no tested sensitive marker/fingerprint match. The malformed 400 was confirmed by D1 and its signal, not a stored event status; span correlation remains unproven. Both temporary Workers and scratch D1 were deleted and confirmed absent before their fixed expiry. Production logging settings were unchanged. This scoped synthetic result does not establish actual student registration or unrestricted log secrecy.

On 2026-11-08 UTC, three closed-production synthetic requests were correlated by Ray in the built-in HTTP query layer; a synthetic marker was present in the old callback query. Real credentials were not used in that audit. The first replacement requested `response_mode=fragment`, cleaned the browser URL and sent a bounded same-origin POST. Discovery's supported-mode list and local fixtures did not establish compatibility for the actual Google code flow; query GET correctly did not consume an attempt. The unchanged broker's earlier synthetic evidence follows.

The subsequent isolated platform audit exercised eight branches of the production modules with a synthetic provider: success, denial, malformed input, expiry, replay, provider HTTP error, timeout and opaque outer exception. Stored-query inspection returned 23 rows, matched both tested source versions, found empty queries on all 16 invocation-like rows and zero sensitive prefix/identity/fingerprint matches. D1 response proofs and safe completion signals covered all eight cases. Each case had one request-ID event candidate; span-ID correlation and a distinct event bijection were not established. Six stored response statuses were 303; the malformed 400 and outer 503 statuses were confirmed by D1/safe signals, **not** by a stored event status. Raw log rows were not saved locally. The two temporary Workers and scratch D1 were deleted and confirmed absent before expiry; existing production logging settings were unchanged. Private sanitized proof is retained under `.wrangler/oauth-fragment-platform-audit-20261109/`; independent stored-query proof SHA-256: `2030a0287116a022cf779c81c7305efb0d63b606235f7d04ed09f3e8fd5dcd0c`.

## Historical incomplete probes

A bounded synthetic probe of the existing closed preview ran earlier; see [scope, capture results and limits](QA-CLOSED-PREVIEW-LOGS.md). It did not exercise an enabled OAuth callback or provider exchange.

A later [single queryless control](QA-LOG-CONTROL.md) also returned zero stored rows after a completed exact-URL query. Its query execution and condition echo were verified, but positive correlation, full-row inspection and redaction were not. The existing sampling/settings and closed authentication boundary were preserved; this additional result does not satisfy the gate.

A separate [bounded real-time control](QA-REALTIME-LOG-CONTROL.md) first stopped before correlation, then a reviewed binary-representation correction correlated one closed fallback invocation with its request and version. Owned Tail/process cleanup and unchanged settings were verified separately. This is narrow real-time evidence; stored-log, sensitive-field and OAuth-branch coverage remain unresolved. The release criteria below are unchanged.

A later [four-position synthetic POST](QA-SENSITIVE-LOG-INPUTS.md) received the expected closed response but no Tail frame within its capture lease. All eight synthetic fields remain unassessed. A separate [outer Worker exception boundary](WORKER-ERROR-BOUNDARY.md) handles non-Error rejections without inspecting or logging the caught value; this source protection does not attest platform logs, callback URL shedding, private-data retention or actual OAuth branches.

## Why app-level silence is insufficient

Cloudflare's [Workers Logs documentation](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) describes invocation logs with request/response metadata. Application logger redaction or the absence of console.log cannot establish what an edge/access log, invocation record, tracing layer, exception collector or downstream drain stored. A normal URL redirect or no-referrer header also does not erase earlier request records. Query-to-body changes alone do not prove that bodies/cookies are omitted.

The source's observability settings alone are not evidence of actual deployed redaction. Sampling is not proof of absence, and a missing sampled event must be marked inconclusive. The scoped result above must not be generalized to untested settings, destinations, provider responses or future releases.

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
