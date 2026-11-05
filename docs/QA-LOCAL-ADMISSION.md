# Independent QA — local admission and issuance limits

## Result and scope

No blocking correctness finding remains within the reviewed local/server-only scope after the preservation correction below. Independent execution: `npx vitest run tests/admission.test.ts tests/admission-independent.test.ts tests/browser-issuance-limits.test.ts` — **26 passed across3files,4.05seconds**. This contains13 developer admission cases,9 independently added cases and4 issuance-limit cases. `npx tsc --noEmit` also passed.

Separate-context review used fictional data and real Miniflare D1 with migrations0003/0004/0012/0013. Session creation uses existing browser coordinator/flow/SessionStore with fictional verified identities; there is no production identity bypass. No actual student identity, Google login, operator grant, remote request/database/configuration, production POST or public operational metadata was used. This is server-side/runtime evidence, not a user-facing or physical-device trial.

## Independent acceptance evidence

- Expired never-active pending accounts can be purged, while previously transitioned, role-holding and session-referenced pending accounts remain. The retained-session fixture deliberately models an inconsistent legacy state with epoch0 rather than letting epoch alone explain refusal.
- A final audit-delete fault rolls the complete purge batch back, including earlier account deletion, subject fence, audit row and interval reservation.
- Eight concurrent purges have one reservation winner and delete one100-account batch, leaving5 of105.
- A future-dated operator grant cannot authorize a valid active session.
- A target-state change after session preflight defeats the final status/epoch CAS without creating an audit.
- Actual `SessionStore.logout()` succeeds after that browser exhausts its20 start-command budget, and its session then fails authentication. Logout has its own command budget.
- A fictional expired pending account with an unexpected private draft under the real0005 `ON DELETE CASCADE` schema is retained with the draft unchanged.
- An unknown application table named `sqliteX_retained_records`, referencing the unique Google-subject column with `ON DELETE SET NULL`, retains both its account and owner link. This covers a legitimate non-ID FK target and a table name that a mistaken `LIKE 'sqlite_%'` filter could omit.
- A case-insensitive SQLite `REFERENCES PRIVATE_ACCOUNTS(id)` target is retained rather than cascading its child.

Source review confirms the final decision statement uses the central live-session predicate plus the current operator grant, CSRF/same-origin protection, target status/epoch CAS and self-operation refusal. Audit insertion and target transition are one SQLite statement/trigger operation. Existing status/epoch/floor triggers are reused for withdrawal. The store and migration grant no operator roles. The opaque review reference does not prove correct enrollment review.

## Finding and correction

An independent preservation regression originally failed: a fictional legacy pending account with epoch0 and a private draft was deleted, and the real application FK cascaded the draft. Thus the original statement that other FKs necessarily fail rather than cascade was false. The failing baseline was6passed/1failed in1.98seconds; the test was kept unchanged as a preservation requirement.

Root corrected purge to discover actual FK references from server-owned SQLite schema, then include child absence in the final DELETE. The final implementation quotes identifiers, respects the referenced target column, handles case-insensitive table names and refuses oversized or failed schema inspection. It excludes only known managed D1 metadata and the reserved SQLite namespace. Individual PRAGMAs are used because D1 rejects table-valued PRAGMA functions; inspection of managed `_cf_METADATA` also returned SQLITE_AUTH during diagnosis and was not counted as a pass. An intermediate fail-closed version returned null even for valid purge cases and was corrected before the final26-case run.

Final regressions now protect both CASCADE and SET NULL references, including unknown tables and legal subject references. The run must be serialized with migrations: introspection followed by final guards does not protect against concurrent schema creation. No production data was touched.

## Limits

All policy durations are explicit fictional server configuration. This review makes no choice about actual student qualification, reviewer authority, graduation, appeal or real retention. An active account is not automatically an operator. The initially trusted operator-provisioning chain remains a separate reviewed operation.

Final SQL checks use the dispatch/binding clock, not a database-commit clock. Quotas constrain accepted live contexts and per-context commands, not incoming request rate, distributed abuse, shared-cap starvation or all query costs. The global cap can deny legitimate sign-ins. Pending purge's100-row deletion limit does not bound arbitrary FK inspection or child-query scan cost; full-schema workload/index validation remains necessary. Existing finite transport-maintenance benchmarks are not evidence for every pending-purge application schema.

Remote logging/Google/browser/retention and actual lifecycle/notification policy gates remain separate. The authentication source gate remains false. These tests do not authorize remote schema changes, actual erasure, role assignment or real-user activation.

## Reviewed fingerprints

| File | SHA256 |
| --- | --- |
| `worker/auth/admission.ts` | `ceb87145469ef35b4cce3bfa262c19342fcbcd5607bbe92860d169ea17085f6e` |
| `worker/auth/browser-session.ts` | `de4e60c19d5d5691d150ff04115e41191c2ef73318d32dc9acdad333dec34a76` |
| `worker/auth/session-guard.ts` | `479a01042cac34a20b7b17416e1f9f6b4556fc0df09eb86f0039d4c0bbd1d0d7` |
| `worker/index.ts` | `03841336c978198149e144619fbae35c6a0d0f97c13ef5ac105f620c00531f89` |
| `migrations/0013_local_admission.sql` | `9544c1f3ef913b31f2d4ac23e24c42b1903ef96aeca52dac208f94451a5e85d4` |
| `tests/admission.test.ts` | `d6dadfcac98a541a0c76c87372305632be5d9b1909d000b6ced1d4fbac773a1c` |
| `tests/admission-independent.test.ts` | `f01b85dcaf482a33c2bc3afe22e275ef74f67a1263f6b500237c12387b37ad94` |
| `tests/browser-issuance-limits.test.ts` | `8d9c4b0a1610b11a87f1b8f436c4e9add92bdd5e773b16c9bd02a072fb206f7c` |
