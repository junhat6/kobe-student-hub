# Independent QA — local authentication maintenance

Verified 2026-11-05 in a separate implementation context. Scope: `AuthMaintenanceStore`, local migration0014, existing attempt/floor cleanup and their actual Miniflare D1 interactions. No production, remote database, Google, real identity, credential, probe, log query or setting was used or changed.

## Actual result

`npx vitest run tests/auth-maintenance.test.ts tests/auth-maintenance-independent.test.ts tests/session-generation-migration.test.ts`: **28 passed across3files**, final fixture rerun duration3.96seconds. This is developer10 maintenance cases, independent3 additional cases and existing15 migration cases. `npx tsc --noEmit`: **passed**. Miniflare loopback ran through the existing authorized local-test execution path.

## CI fixture setup correction

The parent reported PR87 CI41998521538 timed out at the existing five-second test deadline while creating the1000-per-category backlog (534passed/1failed). This report does not claim a first-hand CI diagnosis or a passing replacement CI run. Independent comparison of commit345cded to its parent confirms the only test change is `seed`: four recursive `INSERT SELECT` statements replace4000 client-side prepared statements for that backlog. Counts, field values, foreign keys, real SQLite triggers, query-plan/deletion assertions and test deadlines are unchanged. `printf('%064x',i)` produces the same lowercase64-character identifiers as the prior hexadecimal padding for all exercised nonnegative indices. The inserts remain actual D1 writes, not mock rows or precomputed query results. Seed setup is now one batch rather than many50-row client batches; no setup failure/transactionality claim is made by these tests.

Independent execution of the final fixture: the same28 tests passed in3.96seconds. Maintenance implementation, migration0014 and the independent test fingerprints are unchanged. This fixes setup/RPC overhead without reducing the finite backlog or weakening assertions; CI success still must be verified by the parent.

No blocking correctness defect found within this bounded scope. Production source gate remains false, and the public Worker does not import or route the maintenance store.

## Independently reviewed and exercised

- Explicit policy has no implicit grace/frequency default. Malformed values, origin, clock, missing singleton/schema fail closed. Fixed100-row category budget cannot be raised through the policy.
- The conditional persisted reservation selects one of8 equal-time concurrent calls. Another instance shares that throttle. This is deliberately not a job lease; operators must prevent long-job overlap separately.
- Attempt cleanup reuses `DELETE RETURNING` row count and FK `ON DELETE SET NULL`. A live eight-hour session survives deletion of its ten-minute attempt. Callback replay and clock rollback cannot recreate the missing attempt/session authority.
- Expired commands and absolutely expired sessions are removed before unreferenced expired contexts. Retained children pin a context rather than causing unsafe cascading deletion. Grace is a conservative captured cutoff for all phases.
- Subject-floor cleanup reuses the existing atomic minimum-watermark advance plus bounded delete. Old attempts/commands protect floors. Once retired, the permanent watermark still rejects old capabilities after time reversal.
- Independent added case: an unexpired old command alone, with no attempts, blocks floor retirement. At its exact expiry, maintenance removes the command and floor and advances the watermark; FK checks remain clear.
- Independent added case: already revoked and idle-expired sessions remain until absolute expiry; a third absolutely expired session is removed. The implementation does not silently invent a shorter physical-retention policy.
- Independent added case: clock rollback after attempt deletion returns unavailable before later category deletion, preserving that committed deletion and the stored throttle. A deliberate later run safely completes remaining expired command/context work.
- Developer failure injection independently inspected: command-delete trigger failure occurs after attempts commit, returning unavailable with reservation retained. The result correctly makes no all-job rollback claim.
- Actual-D1 query plans use the intended expiry, context and floor indexes.1000-record category and floor backlogs retain a100 deletion budget, and205 expired rows drain over three explicitly spaced runs. These finite checks are not production performance evidence.

## Limits and remaining conditions

`completed` does not mean a category is empty. Frequency throttling is not a guarantee of single-job ownership over arbitrarily slow execution; an actual runner must serialize jobs and inspect uncertain failures. Scheduling, monitoring, selected grace/frequency, maximum backlog/cleanup lag and trustworthy time remain uninstalled operational decisions. No remote migration or schedule is authorized by this QA.

Indexes and LIMIT100 bound selected/deleted rows, not all query work. Correlated floor checks and child-pin scans can inspect an accumulated backlog. The tests do not establish a production latency SLO, distributed-abuse resistance, backup/export deletion or secure erasure. Accounts, admission evidence/audits, private drafts and publication content are outside this store's deletion authority. Their policy and implementation are assessed separately.

## Source fingerprints

| File | SHA256 |
| --- | --- |
| worker/auth/maintenance.ts | fa7588858afd2875f7f8c20ebb74c1a8c4aefb3d6a27cfb3ace4427b5a397b37 |
| migrations/0014_auth_maintenance.sql | e19d6056d1e1412376fac29f6e00edbdc57435f6b2594e5cceea937032035f27 |
| tests/auth-maintenance.test.ts | 6f0f0a66665f26065782af8166507ce59bffeeb5c58374391d9b2e8c4bbbb966 |
| tests/auth-maintenance-independent.test.ts | d7a69d7fb6fcd9c50dbe791061128b1b965d42c146df7751274786e344d7c11d |
| docs/AUTH-MAINTENANCE.md | 6597fb25ae3a2f2061b66888ccd2559c06f2756da6fbad09856c5f41b0306976 |
| worker/auth/oauth-attempts.ts | 2a8c87b3418e6fc7183d0016e3472b375d3b16ba617cbbb9d6ddfa1db5f9e895 |
| migrations/0012_browser_session_order.sql | 7b392d1eda741cba23e48fd0f7704cf5021723586852ccd599e792f120f9b381 |

The parent is concurrently editing browser issuance limits. That separate protocol change is not frozen or approved by this maintenance-only report; final combined validation must bind its final source as well.
