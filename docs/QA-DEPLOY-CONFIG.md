# Independent QA — preview deployment handoff

Reviewer: independent QA agent in a separate task/context from implementation. Date: 2026-11-03. Scope: `feat/preview-deploy-handoff`, working-tree changes based on `f5b60893014f9babe6b50df4e45127ee4ea62554`.

## Initial source review

The source/local Wrangler template keeps its placeholder database and disabled workers.dev setting. `prepare-deploy.mjs` reads four private runtime settings, validates selected/expected account and database pairs, fixes the intended Worker/main/DB binding, and writes an ignored runtime configuration. The token is not copied into that configuration. Package deployment commands re-run preparation and use the same generated file for pending migrations and Worker deployment. CI passes all four settings and refuses a missing token for actual deployment rather than initiating a new grant. Opt-in/main-only workflow restrictions remain.

Matching selected/expected pairs are an accidental-target check, not an independent authorization boundary: a person able to alter both settings can select another resource. The documentation correctly requires actual resource verification and existing authorized access.

Initial improvement requested: restrict assets/migration source paths rather than accepting arbitrary strings and resolving them. The current template is correct, so this was not a claim of observed unintended deployment. Guarded fixed paths reduce accidental exposure of another asset directory or application of unrelated SQL. The implementer adopted this improvement before final testing: assets directory must be `./dist`, assets binding `ASSETS`, and migration directory `migrations`; all three unexpected-value rejection cases were added. Independently rechecked in final source and tests; resolved.

## Documentation review

README and deployment documentation distinguish the reachable sample-only preview from an available real student service; login/posting and student recruitment remain unavailable. The initial deployment's source and prior independent HTTP/browser QA are identified, while later internal auth preparation is not called a working OAuth flow. Runtime resource IDs and credentials are kept outside tracked source, and the generated config must not be committed or uploaded as an artifact.

The media plan separates R2 activation/terms, Workers plan pricing, usage allowances and total budget. It does not treat a free allowance as a hard cap or imply that Workers Paid includes R2. Private buckets, stored ownership/publication state, current retrieval authorization and cache transitions are required before real upload; unguessable keys are not treated as access control. New credentials, contracts and paid services are not silently authorized by this plan.

This reviewer independently checked the published [R2 pricing](https://developers.cloudflare.com/r2/pricing/) and [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) pages. The documented Standard free allowances/unit prices and Workers minimum-plus-usage description matched those primary sources. This is not verification of any private account invoice, selected payment method, actual subscription agreement or budget cap. This reviewer did not open or accept activation terms, create an R2 bucket/key, alter a plan, provision remote resources or grant permissions.

## Independent execution

After the implementer confirmed its final shared run was complete, this reviewer independently ran the final deployment-config subset below. No real deployment command was run.

### Final independent execution

```text
npx vitest run tests/deploy-config.test.ts

Test Files  1 passed (1)
Tests      11 passed (11)
Duration   698ms
```

The tests use temporary isolated directories and synthetic account/database/token fixtures. They invoke only the preparation script, inspect its local JSON result, and remove temporary data. They do not call Cloudflare, mutate remote configuration or start a login/grant. The Mac temporary-path expectation uses canonical real paths, matching Node's resolved working directory.

Verified cases:

- Intended Worker, enabled named-preview workers.dev setting, disabled preview URLs, selected runtime IDs and absolute entry/assets paths are generated; a synthetic token is not copied into configuration.
- Missing account/database, mismatched expected account/database and placeholder D1 settings are rejected without writing a config.
- An unrelated Worker is rejected.
- Unexpected assets directory, migration directory and assets binding are rejected.
- CI actual-deployment preparation without a token is rejected without starting authentication.

Final source/workflow recheck confirms the production package command re-runs preparation with `--for-deploy` before build/migrations/deployment and uses the generated config for both remote commands. The workflow passes all four runtime settings at preparation and deployment, supplies the existing Actions secret only at deployment, and remains opt-in/main-only. The tracked ignore rule covers `.wrangler/`; configured CI report paths do not include the private runtime config.

These 11 passing tests are this independent subset, distinct from the implementer's larger suite. The tests prove local configuration generation/refusal behavior, not actual resource ownership, credential permissions, successful migration or deployment. The selected/expected values must still be independently verified by the authorized deployment actor. An invalid-but-present credential will be left to Cloudflare/Wrangler authorization; no new access is minted by this helper.

## Final documentation and privacy recheck

The final deployment guide reflects the fixed asset/migration paths and the unchanged activation boundary. README distinguishes the existing public preview from unimplemented real login/posting. The public live-QA document now omits the individual runtime-version UUID and describes those metadata as privately retained; intended public preview URLs and public source commit references remain. No real account/D1 identifiers or private billing data were introduced in this report. Synthetic IDs in tests are test inputs, not actual deployment resources.

This reviewer did not inspect an account invoice, saved payment method or the final R2 activation screen; reported non-acceptance of an agreement is deployer evidence. No legal terms, payment, upgrade, bucket, credential or permission change was performed during this independent QA.

## Final reviewed identity

Working-tree changes based on the base commit above. SHA-256 at independent final execution:

```text
scripts/prepare-deploy.mjs       ff3bd4a2a447799f869514b0d0b9e1d40aced14aee43c08d90dade61394ec98d
tests/deploy-config.test.ts      a4b1ba46410cc546e5ca2d3948abfd557de1015c271b0e2e09624c053b7eda77
.github/workflows/deploy.yml     cd778f126ec18f994ac6a9c710a205699725098fa8304ae894ab67bb6a2a1e15
package.json                    9ae24a9911d58442169a6fadfec5844a38d179f35c07233d41af63e0bafe7e5c
docs/DEPLOYMENT.md              edbc19a59fe05ecb72ab03f7ae55a834211b641f44a8c379c9b94d56bf8e0bd7
docs/MEDIA-PLAN.md              22bf5803a6a3c5738f95c868baa54952372ec3d074de6a58353f4d3540379c2e
```

## Disposition

No blocking finding remains for this local configuration/documentation handoff. The requested path restriction was fixed and independently tested. Only this QA report was edited by this reviewer. No deployment, remote migration, contract, credential or permission change was performed; automated deployment activation, real media/authentication safety and operational logging gates remain separate work.

## Follow-up: Worker deployment separated from remote schema mutation

This follow-up supersedes the earlier handoff description that `deploy:production` automatically applied pending migrations. The earlier 11-case run remains historical evidence; the current command is Worker-only.

The deployer reported that automatic approval review rejected remote migration 0003 because the initial sample-preview authorization did not specifically cover a persistent auth-state schema change. The reported action was not executed and was not retried. This reviewer did not reissue it, use another route or independently query/change the remote schema. The documented current remote scope remains initial migrations 0001/0002, with the sample preview and real-OAuth write gate unchanged.

Independent source recheck:

- `deploy:production` now runs preparation, build and `wrangler deploy` only. It contains neither `d1 migrations apply` nor `d1 execute`.
- The preparation helper only validates/generates local ignored configuration; it does not execute SQL. The build script remains TypeScript/Vite compilation. No migration step is hidden in that dependency chain.
- `deploy.yml` still delegates to that package command. Its only database-migration command is `npm run db:local`, which explicitly uses `--local` for verification.
- `DEPLOYMENT.md`, `OAUTH-ATTEMPTS.md`, `WORK.md` and `EVIDENCE.md` now distinguish remote migration 0003 as pending separate authorization and prohibit alternate CLI/CI routes to bypass that boundary. Local tests/migrations are not presented as remote application.

Independent final subset rerun:

```text
npx vitest run tests/deploy-config.test.ts

Test Files  1 passed (1)
Tests      12 passed (12)
Duration   431ms
```

The additional negative case checks that the package deployment command does not include remote SQL mutation; the other eleven local configuration checks also pass. This reviewer ran only the local subset, not the implementer's reported 59-test full suite. No Cloudflare command, permission grant, contract acceptance, remote migration or deployment was executed by this reviewer. No permission-dependent work was attempted.

Final changed SHA-256 identities for this follow-up:

```text
package.json                  dc7c476b66a48d01c38166dc1aa9984ccd04156ae6bd251e308062169c359550
tests/deploy-config.test.ts    66050e52b4b94455430ab13cd4e5918c5d99a458746fc7327a0e4e8e65143bcf
docs/DEPLOYMENT.md            670909fd9258c0614257a6de45fe7eb0ecca2abbb146c32e1db22f2208ea1b7b
docs/OAUTH-ATTEMPTS.md         75eb2f2636212886349c42d12a481bea26999f13a4c1d7f4eedecb564c2ae8c6
docs/WORK.md                   2c5f618537fd2735f4cc5230d71f8948b90ab5938ba212bc501d4ed75b0cd047
docs/EVIDENCE.md               ceffc6e1a8e9e505b4addf952778baa0d30e6813db4e302ac3e2d2cf693bf9bd
```

The preparation helper and workflow hashes remain as recorded above. No blocking finding remains for this Worker-only handoff; remote auth-state schema changes and all live-authentication/logging gates remain outside this approval.
