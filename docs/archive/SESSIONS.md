# Private session primitives

Issue #26 adds unconnected server-only sessions. Production routes and deployed sample remain unchanged. `0004_private_sessions.sql` is local source only; remote D1 has not received it.

A trusted server caller passes the existing Google verifier's result to `SessionStore.create`. The TypeScript identity structure is not cryptographic proof; accepting client JSON in this position would defeat authentication. Creation only matches an existing active private account by verified subject. It neither creates an account nor establishes student eligibility. The schema's pending default is defensive, not a settled admission policy.

Each successful creation issues fresh 32-byte random opaque cookie material. D1 stores its domain-separated SHA-256 hash and account epoch; browser material contains no email or Google subject. A separate derived CSRF token is returned only to trusted server code. Cookie attributes are `__Host-`, Secure, HttpOnly, Path=/ and SameSite=Lax. Controllers must serve private responses with no-store and must never expose these test fixtures.

Authentication checks the server-stored active account and epoch, absolute eight-hour and idle thirty-minute expiration, and rejects clock rollback. These durations are technical defaults for review, not an agreed product policy. Unsafe methods additionally require exact Origin, compatible Fetch Metadata and this session's CSRF header. Protected record operations still need stored-owner predicates and account-state checks at mutation time; an earlier authentication check does not eliminate races.

Logout revokes the current session. Creating another session keeps existing sessions; this is not comprehensive credential rotation or all-device logout. Account status changes increment the epoch, preventing old sessions from reviving after reactivation. Account deletion cascades sessions. Expired-row cleanup is bounded to 100 rows per explicit call and has no scheduled retention guarantee.

Local tests exercise actual Workers/D1 with fictional accounts. Manual request Cookie headers do not prove real browsers enforce cookie attributes. Real Google configuration, provider/browser lifecycle, enrollment/graduation decisions, platform log protection, moderation and private-writing policy remain separate gates. See [independent QA](QA-SESSIONS.md).
