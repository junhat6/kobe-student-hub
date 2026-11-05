# Local authentication data maintenance

`AuthMaintenanceStore` is an explicit server-only operation over already-expired authentication transport records. It is not imported by the public Worker, exposed as an HTTP route, or scheduled remotely. Migration0014 is local preparation only. It does not erase private accounts, enrollment evidence, admission audits, drafts or published content. Those purposes and retention decisions remain separate.

## Explicit policy and execution

The caller must supply a canonical HTTPS origin, a trusted server clock and all three policy fields: `expiredGraceMs` (a nonnegative safe duration), `minimumIntervalMs` (at least1000), and `batchLimit:100`. There is no default retention grace or job frequency. A local fixture may choose zero grace to exercise boundary behavior; that is not a production privacy policy. Existing capability TTLs remain unchanged.

One conditional database update reserves the next run. Equal-time concurrent calls have one winner; a new store instance shares the same persisted throttle. Backward time or a future previous reservation cannot accelerate another run. The reservation persists even if later steps fail. It is a frequency guard, not a running-job lease: an operator/scheduler must keep a single bounded job active and must not overlap long jobs merely because the interval elapsed. No scheduler is installed here.

The run captures `cutoff = start - expiredGraceMs`, then invokes the existing attempt cleanup, deletes expired commands, deletes absolutely expired sessions, deletes expired contexts without child references, and invokes the existing subject-floor cleanup. Every category deletes at most100 rows. Attempts use the existing `ON DELETE SET NULL` behavior, so deleting a ten-minute attempt does not terminate its valid eight-hour session. Existing subject-floor cleanup advances the permanent watermark before deletion in its own atomic batch; older capabilities cannot regain authority after clock rollback.

The result contains counts only. `completed` means that all steps returned successfully, not that the database is empty or that every eligible record was deleted. FK updates, the reservation and watermark updates are not counted as deleted category rows. Remaining children may pin expired contexts for a later run. The operation intentionally does not purge idle sessions before their absolute expiry or revoked sessions before that expiry; it must not quietly introduce a new retention choice.

`unavailable` means work may have partially committed. There is no all-job transaction or automatic retry, and no misleading all-or-nothing receipt. An explicit later run may continue safely after inspection. A backward or malformed clock detected between steps aborts remaining work; already-deleted expired capabilities stay deleted. Forward time jumps can cause premature fail-closed expiry, so a trustworthy clock remains an operating condition.

## Quiet services and retention

Unlike opportunistic cleanup tied only to login/bootstrap activity, this operation can be called by an explicitly reviewed server maintenance procedure during quiet periods. Choosing and installing an actual schedule, access restrictions, health/alerting, retained evidence and maximum cleanup lag remains a release task. Without that procedure, there is still no fixed physical-deletion SLA. A backlog may require multiple spaced runs. This local implementation cannot establish provider log, database backup, downstream export or secure-erasure behavior.

## Query work and bounded-load evidence

Migration0014 adds expiry indexes for commands/contexts, child-context lookup indexes, a generation index for subject floors, and composite/partial indexes for old live attempt/command checks. The command-context index also supports issuance-window checks without a duplicate prefix index. Existing attempt/session expiry indexes are retained.

The test suite uses actual Miniflare D1 and `EXPLAIN QUERY PLAN`, rather than mocked query results. It verifies indexed expiry/context/floor paths, a1000-record-per-category synthetic backlog with a100-row deletion budget, and1000 subject floors held by one old live attempt then reduced by100 only after expiry. These are finite local capacity checks, not production throughput, a latency SLO, a proof of constant query work or a defense against distributed creation abuse. Correlated subject-floor eligibility can still inspect accumulated live capabilities/floors; production query metrics and backlog limits remain necessary.

Acceptance also covers205-record draining across later runs,8 simultaneous reservations, explicit grace, retained child references, missing singleton/schema failure, partial failure, clock rollback and a live session surviving attempt deletion. Accounts remain present and foreign-key checks stay clean. Independent QA and exact final results are recorded by the parent work cycle.

## Safe local procedure

1. Use a disposable local D1 with migrations0003/0004/0012/0014; use the complete chain when testing the whole application. No real identity, client secret or session token belongs in the fixture.
2. Choose fixture-only policy explicitly, record the trusted clock and call once. Inspect sanitized result counts and foreign-key state. Do not print rows containing identity or capabilities.
3. If throttled, inspect the previous reservation and wait for the chosen interval; do not reset state to bypass it. If unavailable, inspect the affected category before another deliberate run.
4. Check backlog counts privately and rerun at the explicit interval until the intended synthetic categories are drained. Verify watermark/replay and live-session preservation separately.
5. Do not translate this local procedure into remote SQL or a scheduled production job without verifying target, schema, policy, restore/stop behavior and applicable authorization. Account/pending/audit retention belongs to its separate admission procedure.
