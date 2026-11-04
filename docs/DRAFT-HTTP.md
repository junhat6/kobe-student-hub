# Private draft HTTP boundary

Issue #30 follows private draft storage with the HTTP boundary needed by a future editor: bounded input, actual session/CSRF checks, explicit private responses and a failure contract that cannot overwrite the winning version. This handler is not connected to production. No real login, editor/autosave, account, migration or posting is activated.

## Scope and alternatives

Compared the remaining journey with current Issues #4/#5/#11/#12 and PR29. A new writing screen without authenticated private transport would not provide cross-device saving. Another card-study prototype would duplicate the existing unrun student trial. Media still depends on R2 conditions; real publishing still needs complete moderation/notifications/operator/appeal. The next coherent unit is therefore a locally testable private HTTP controller, while the dedicated Google configuration remains unresolved.

The factory receives trusted server database/origin/clock configuration. It does not accept an identity or owner from request JSON. The real session store checks authentication and unsafe-method Origin/CSRF before reading JSON; the draft store authenticates again and repeats live session/account/owner/version predicates in the final SQL. Parsing a body never authorizes a later stale session.

## Intended transport contract

Only canonical `/api/private/drafts` and single-ID paths are supported. The collection supports GET/POST; an ID supports GET/PUT/PATCH/DELETE. Queries and unexpected path segments are refused. The unconnected handler returns null for unrelated paths; its future production integration must retain closed fallback behavior.

Every matched success/error response is JSON with private,no-store, Vary: Cookie, no-referrer, nosniff and noindex/nofollow. No CORS permission, login cookie or redirect is added. Success returns only the existing explicit draft or summary DTO. Missing, other-owner, stale-version and storage-unavailable results use the same generic unavailable response without reflecting supplied IDs, text or internal errors. Authentication and transport errors also contain fixed messages only.

Unsafe input is UTF-8 JSON only, uncompressed/identity encoding. The raw transport cap is 2 MiB to accommodate JSON escaping of the existing 256 KiB Markdown limit; it is not an increase to the stored content limit. Declared Content-Length is an early check; actual streamed bytes remain authoritative. Acquisition also caps total read chunks at65536, including empty chunks, to bound work that a byte limit alone would miss. A fixed-size buffer avoids an unbounded list of tiny chunks. A five-second body-read deadline rejects stalled input and cancels best effort without waiting indefinitely. Losing or late reads never perform a store operation. This bounds body acquisition, not the entire handler's database/cryptographic wall-clock time.

## Future UI and release gates

Any non-success save response must preserve the editor's unsaved text. The controller does not implement client text recovery, silent retry, conflict merge, autosave or a special existence-revealing conflict result. A future owner-only read can retrieve the latest version for an explicit recovery decision. The current list is capped at20 without pagination.

Local tests use real Workers/D1/session/store processing with fictional accounts in an isolated fixture. The fixture's session injection and clock control are never deployable. Production remains the read-only sample preview. Remote0004/0005, dedicated Google client/key configuration, browser/Cookie lifecycle, admission/graduation policy, actual secret-bearing logs, quota/abuse protection and real-user privacy validation remain gates. Publication additionally requires private media and moderation/notifications/appeal. Local HTTP success is not student-value or physical-device evidence.

References: [RFC9111 caching directives](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2) distinguish private shared-cache exclusion from no-store; both are emitted without claiming actual platform-cache verification. [Workers Request](https://developers.cloudflare.com/workers/runtime-apis/request/) exposes the incoming body as a stream; tests exercise the runtime rather than assuming declared length is the received size.
