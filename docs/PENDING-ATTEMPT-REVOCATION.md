# Pending-attempt revocation: independent design assessment

Reviewed 2026-11-05. The comparison below records the recommendation made before the implementation changed. The parent subsequently implemented subject floors plus a permanent low watermark and opportunistic cleanup. See [current independent QA](QA-SESSION-GENERATION-MIGRATION.md) for actual results and remaining limits. No application source was changed by this independent assessment; the auth gate remains closed.

## Recommendation

Replace global equality as an authorization condition with an account/subject-specific revocation floor. Keep the existing global monotonic revision as an ordering stamp, incremented only when an account is revoked. Snapshot it when issuing a command and preserve that snapshot into its OAuth attempt. After Google identity verification, the final database write must compare that attempt stamp with the verified subject's latest revocation floor. An unrelated account's revocation then cannot invalidate this login.

This is smaller than allocating a new global sequence number on every start: the existing revocation counter already orders every relevant revocation relative to command issuance. Commands/attempts may share a revision. The acceptance comparison is `attempt_revision >= subject_floor`, not strict greater-than: a command issued after a revocation sees the new revision and must work. A command issued before the revocation sees a lower revision and must fail for that subject.

Do not accept the present blanket fence as the final default. It provides conservative revocation correctness but creates unnecessary cross-student interference.

## Previous global-equality behavior and impact

In the previous implementation, the triggers advanced `auth_revocation_fence.generation` on an account's `session_epoch` change and account deletion. The existing status trigger changes `session_epoch` on every status transition, so suspension, reactivation, and other status changes also advance it. Updating unrelated profile fields or assigning an unchanged epoch/status does not advance it.

Every advance invalidates all outstanding command nonces, including login, pending registration and logout, and all OAuth attempts from earlier revisions, whether unconsumed or already claimed during token exchange. Existing sessions on unrelated accounts remain valid: their authority checks use their account epoch/status and browser context generation. A student whose login was in flight must restart; an unrelated signed-in student is not automatically signed out. A freshly issued logout command normally recovers, although a concurrent revocation can also make that operation fail and require retry.

The initial 7 passing migration tests established this blanket behavior, not its desirability; the revised suite now checks narrower behavior. In particular, they demonstrate rejection of unrelated pending completions and survival of unrelated existing sessions.

Bulk operator status changes or deletion jobs can repeatedly interrupt every pending login or registration. If future self-deletion or other student-accessible revocation becomes available, one account could cause cross-account disruption, subject to its ability to repeatedly trigger genuine changes. No public endpoint currently provides arbitrary status/epoch updates, so this is a design exposure rather than a demonstrated public exploit. High administrative churn alone is sufficient to expose the availability problem. Current duplicate/no-op updates do not create unlimited increments by themselves.

## Alternatives

| Design | Revocation correctness | Unrelated impact | Assessment |
| --- | --- | --- | --- |
| Current global equality at command, claim and completion | Rejects all pre-revocation attempts | Every pending student and command | Too broad as the default |
| Per-account epoch captured only after identity verification | Misses revocation during the earlier anonymous attempt | Narrow | Unsafe alone: verification would capture the new epoch and resurrect an old attempt |
| Per-subject wall-clock `auth_not_before` | Can work with a rigorously shared clock/order policy | Narrow | Avoid: timestamp equality, backward clocks and concurrent operations complicate the boundary |
| Allocate global start/revocation sequence on every event; per-subject floor | Strong database ordering | Narrow | Viable but adds a serialized write per start unnecessarily |
| Existing global revocation revision as stamp; per-subject floor | Strong database ordering with atomic writes | Narrow | Preferred smallest change |
| Revocation event log queried by subject after verification | Strong if retained and queried correctly | Narrow | Equivalent principle, more rows/cleanup; latest floor suffices |

## Minimum correct mechanism

1. Maintain one server-private floor per Google subject, not email, display name, browser-provided account ID or client-supplied identity. Use the same canonical subject namespace as verified identity/account lookup; if multiple issuers/providers are supported later, include that namespace in the key.
2. On every actual epoch change and deletion, advance the global revision and upsert the affected subject's floor to that new revision in the same database transaction/trigger. Preserve the floor on reactivation; never reset it when an account returns to active. Counter exhaustion, missing schema or missing required counter state must abort/fail closed.
3. Command issuance snapshots the database's current global revision atomically with its insert. Execution retains that issued revision when creating the attempt. Do not refresh the snapshot at claim, exchange, or completion: doing so would let an older operation cross a revocation boundary.
4. Remove global-equality rejection from anonymous command execution and claim. Preserve origin/body rules, command expiry, context generation ordering, single consumption, intent binding and claim ownership. Logout still requires the final live-session/account/context authority guard; another account's revocation should not block it.
5. After verified identity exists, session creation must atomically require `attempt_revision >= subject_floor` in its final insert, alongside active account, current epoch, context generation, expiry, claim owner and incomplete-attempt guards. The attempt's stored revision must agree with its server-only proof. Missing/NULL legacy attempt revisions remain rejected.
6. Pending registration must apply the same verified-subject floor condition inside the account insert/upsert. Checking only session creation leaves a delete/recreate path through pending registration. Completion remains one-time and bound to the same owner; retries cannot change identity binding or replay a consumed success.

The revision comparison is evaluated in the final SQL statement. A preflight query followed by a separate insertion is insufficient: revocation can occur between them. If completion commits before revocation, the subsequent epoch/status/delete must invalidate its session; if revocation commits first, the floor rejects completion. Existing per-account epoch guards retain that behavior.

## Deletion, recreation and privacy

An account-row floor alone is insufficient. Deletion removes the row; recreating the same verified Google subject must not erase the revocation boundary, and an older registration attempt must not recreate that account. Keep a minimal subject revocation tombstone independently of the account row, without an `ON DELETE CASCADE` relationship. A newly recreated account consults the retained floor. In an intact initialized schema, a subject with no revocation row has floor zero; that is a legitimate never-revoked subject, distinct from a missing table/counter or malformed stored floor, which must fail closed. Never key tombstones by email: email collisions and changes must not link provider identities.

The smallest robust local design retains only the existing server-private Google subject and its latest numeric floor in a dedicated table. It needs neither email nor profile fields, nor a complete event history. This is still retained identity data after account deletion, so its purpose and retention must be explicit before real users/deletion are enabled. Do not quietly treat account deletion as erasure while retaining an undocumented subject tombstone. A plain unsalted subject digest is also a persistent identifier; it does not remove that privacy issue. A keyed digest introduces key provisioning/rotation requirements and is not a free local simplification.

A bounded tombstone scheme is possible only with a specified, enforced maximum lifetime of every outstanding command/attempt and a reliable database-time cleanup policy. Cleanup must occur only after no pre-deletion capability can complete or produce a still-live attempt. Current command lifetime is 60 seconds and attempt lifetime is 600 seconds, so conservatively retaining beyond their combined horizon is required if an old command may execute near expiry. Clock rollback, delayed execution, transaction timing and future TTL changes must not reopen the boundary. The implemented alternative uses the permanent minimum-generation watermark to make deletion safe after capability expiry, including clock rollback. The initial recommendation preferred retained tombstones to avoid that complexity; current independent QA verifies the added watermark mechanism. Keep the gate closed and resolve the opportunistic physical-purge limitation before real deletion is offered.

## Required independent acceptance checks

- For each epoch/status/delete transition: target-subject unclaimed and claimed attempts fail; unrelated subjects' pending attempts and commands succeed, including pending registration and logout.
- Reactivation never revives pre-suspension attempts; new attempts succeed after reactivation.
- Deletion followed by recreation of the same subject still rejects the old login/registration; a new attempt can proceed under account policy. Different subjects sharing/changing email never share a floor.
- Exercise both database commit orders between revocation and completion; no preflight-only check can authorize a later insert.
- A command issued before revocation but executed afterward preserves the old stamp; refreshing the claim/proof cannot bypass its floor.
- Equal stamp/floor after revocation succeeds; lower stamp fails; unrelated higher global revision alone does not fail. Exercise same-millisecond and backward application clocks to prove ordering depends on the revision, while ordinary time validity still fails safely.
- Claim-owner substitution, duplicate completion, stale browser generation, missing schema, legacy NULLs, trigger failures and counter exhaustion remain fail closed and atomic.

These are design acceptance criteria; consult the current migration QA report for the exact subset executed against the narrowed implementation. Parallel race scheduling and production load/privacy validation remain outside that local test evidence.
