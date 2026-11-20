# Article operator read session boundary

Issue69 fixes the existing local read-only article operator screen, before adding new operating actions. Independent PC/mobile baseline tests switched operator A to regular B: a fresh raw case read returned404, but A's already displayed private reason/detail remained visible. That is a browser display defect, not evidence of a server permission bypass.

The article screen now discards the read-only queue/case on focus, visibility or pageshow, and whenever session proof fails or changes. Old private DOM is hidden/inert immediately and then unmounted. Resuming requires an explicit existing-session check and new guarded server reads. It does not auto-select the previous case. Session confirmation proves identity only; the trusted server operator allowlist remains the authority on each read and defaults to empty. The UI cannot log in or grant roles.

The existing session guard checks before a request, after headers and before consuming the completed response. Invalidated generations cannot reveal an old case. A failed selected-case read clears queue titles and detail, instead of reporting empty success or leaving stale data. Read-only operator state has no editable buffer to preserve. Project report input and project operator boundaries retain their existing distinct contracts.

This closes a local rendering/response-consumption gap. It does not claim complete erasure of received bytes or browser memory, protection from a compromised browser, immediate detection without a lifecycle/request event, actual school OAuth, actual operator provisioning or production readiness. The local-only fixture can delay one exact successful article-case GET at EOF for testing; no production handler accepts that hook. Real settings, migrations, credentials, grants, billing and deployed sample assets stay unchanged.

Operating decisions, restoration, reasons, notifications, author explanations, appeal/contact and retention remain unresolved or unconnected. Passing synthetic and local D1 checks is not student validation, physical-device validation or real authentication/logging/cache proof.
