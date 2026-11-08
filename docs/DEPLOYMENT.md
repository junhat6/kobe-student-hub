# Cloudflare preview deployment

## Verified public preview

https://kobe-student-hub-preview.ideaboost-whiteboard.workers.dev/

The initial deployment used verified main `6e82dfbd70669c3bc869fd5cc35e8cfe5c5b80fd` from an isolated archive/build. Only fictional public samples are served; no real login or posting is available. The dedicated preview D1 was bootstrapped with migrations 0001/0002 and the compatible migration ledger. The deployer checked four sample entries/two fictional profiles and HTTP headers/denials. [Independent live HTTP/browser QA](QA-DEPLOYMENT.md) separately confirmed the public behavior. Later internal auth preparation is not evidence of a working OAuth flow.

Resource identifiers, account/payment settings and credentials stay outside this public repository. The source template keeps the placeholder D1 ID and workers_dev:false for local development. Runtime deployment settings are generated into ignored `.wrangler/preview.deploy.json`; never commit that file or upload it as a CI artifact.

## Reproducible configuration

Use an already authorized connection and verify the dedicated resource name/ID before preparing. Supply private runtime variables:

- CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_EXPECTED_ACCOUNT_ID
- CLOUDFLARE_D1_DATABASE_ID and CLOUDFLARE_EXPECTED_D1_DATABASE_ID

`npm run deploy:prepare` requires valid matching account/D1 pairs, rejects the placeholder, unrelated Worker/binding and unexpected asset/migration paths, resolves source/assets/migration paths, and enables only the named preview's workers.dev URL. It does not create a resource, credential, grant or contract. It never writes CLOUDFLARE_API_TOKEN into the runtime configuration. Matching settings prevent accidental target errors; they do not replace Cloudflare authorization or independent resource verification.

```bash
npm ci
npm run types
npm run build
npm test
npm run db:local
npm run test:e2e
npm run deploy:check
npm run deploy:prepare
```

After independent QA and successful CI, an authorized deployment actor can run `npm run deploy:preview`. That command preserves the existing preview procedure: prepare settings, build, then deploy the dedicated preview Worker with the same generated config. The legacy `deploy:production` name now refuses execution and directs the caller to the explicit preview command; it must not silently target either preview or dedicated production. It deliberately does not execute remote SQL or apply migrations automatically. Schema changes are a separate reviewed and authorized operation, not a hidden deployment side effect. It requires the appropriate Workers deployment access. In CI it refuses a missing credential rather than initiating an interactive login/grant.

When existing authorized connections differ in capability, the agent can apply specifically authorized migrations through the authorized D1 connector and deploy through existing Wrangler authorization, using this same generated config. Check migration ledger and actual schema first; verify each result. Do not blindly replay migrations, reset the ledger, switch to another resource, or broaden permissions as a shortcut. The first bootstrap followed this split approach; no new persistent CI credential was created. After new explicit user authorization, auth-state migration 0003 was applied once to the dedicated preview and verified; see QA-AUTH-MIGRATION.md. Existing content/profile rows and the prior ledger entries were preserved. Do not replay it or reset its ledger entry. Real OAuth remains closed, and later schema/grant changes require their own applicable authorization.

## CI and ongoing deployment

`ci.yml` runs lockfile install, generated-type consistency, build, local Worker/D1 tests and migrations, 38 desktop/mobile E2E and dry-run. It needs no production credentials. Reports/screenshots/failure traces are retained for 14 days.

`deploy.yml` remains opt-in via repository variable CLOUDFLARE_DEPLOY_ENABLED=true. It checks out main, validates the same source, prepares the ignored runtime config from the four private settings, and deploys using Actions secret CLOUDFLARE_API_TOKEN. It is **not activated** and no token was created. Standalone GitHub auto-deployment therefore remains pending an authorized narrowly scoped credential/settings; a connected agent can continue verified deployments with existing access. New persistent access requires the applicable confirmation; do not create account-wide admin tokens.

Do not change unrelated services or the shared account namespace. Keep this sample preview clearly labelled and noindexed. Before reporting success, use the literal returned URL and verify health, catalog, deep link, headers and write denial. Preserve release source/version evidence privately; publish only intended preview URLs and sanitized project evidence.

## Costs and recovery

Prefer existing allowances; no upgrade is required merely to serve this sample preview. Published [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) lists Free and a Paid minimum of $5/month plus usage; [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) includes a free allowance. These are platform prices, not an account invoice or a promise of a $5 total cap. [R2](https://developers.cloudflare.com/r2/pricing/) has separate free allowances and usage charges; see [MEDIA-PLAN.md](MEDIA-PLAN.md). Recheck actual contract/limits privately before any change. No payment, upgrade or new R2 subscription was accepted in this setup.

For a bad Worker release, select a verified previous version and use Wrangler rollback. Database migrations are independent: Worker rollback does not undo schema/data changes. Before real users, add backup/retention policy and backwards-compatible migrations. Do not delete remote data as a rollback shortcut.


## Guarded sample editorial revision

The historical bootstrap migration 0002 is unchanged. `content-revisions/0001_git_practice.sql` updates only the published fictional git-branches body when its exact old text still matches; it makes no schema, auth, migration-ledger or real-user change. The local setup command applies this idempotent revision after local migrations; Worker tests apply it to their isolated fixture as well. The legacy seed generator now writes an ignored current snapshot instead of overwriting applied migration history.

Remote editorial application is a separate reviewed operation through an already authorized connection to the verified preview target. Read the intended public sample first; if already equal to the new body, do not replay it. If it differs from both old and new expected text, stop rather than overwrite someone else's edit. Apply only this guarded content statement, verify one changed row/new public body and unchanged sample counts. Never run remote migrations to apply an editorial revision. Auth migration 0003 was later applied under separate explicit authorization; that does not authorize additional schema changes or implicit remote SQL during a Worker deploy. Worker-only deploy still never runs remote SQL. Record actual remote status in the release PR; preparation/local success does not mean the public body changed.

`content-revisions/0002_learning_notes.sql` prepares a separate editorial update to the published fictional learning-notes sample. It compares every old row field before changing only its body, summary, reader/outcome descriptions, update date and reading estimate. Local setup and the Worker fixture explicitly apply it after the historical migrations and Git revision. It is not a migration or an implicit remote deployment step.

`content-revisions/0003_learning_notes_decisions.sql` follows the applied0002 without rewriting it. It changes the same fictional sample's body and reader-facing descriptions to a technical-decision example and a three-item note. All15 prior fields must match; its inverse in `content-revisions/rollback/0003_learning_notes_decisions.sql` compares all15 revised fields before restoring the prior text. Local setup and the Worker fixture apply0003 after0002. Its generated-data reference experiment is separate from student experience, and installing its Python dependency is not part of the app build/deployment. Remote application is still an independently verified, one-row editorial operation after reviewed green main, with no schema/auth/Worker configuration or deployment change. Verify the new source-reference link exists on main before publishing the text, and preserve other samples/profiles and release settings.

Keep a live reader-observation baseline unchanged until that observation has finished. A later remote application requires reviewed source and green CI, the already authorized exact target, a current public-value comparison, exactly one affected row and unchanged other samples. Matching the revised row means no replay; any other row means stop and reconcile. Worker rollback does not restore the text. `content-revisions/rollback/0002_learning_notes.sql` is an explicit inverse operation, guarded by every revised field; it preserves later edits and is never run by setup or deployment. Record real application/rollback evidence separately from local tests.

## Unconnected session schema and provider exchange

Migration `0004_private_sessions.sql` is prepared and exercised against local development and isolated test D1 only. It has not been applied remotely; do not infer its application from a successful Worker build, dry-run or CI migration test. The public Worker keeps the OAuth HTTP source release gate false; later local adapter integration does not enable session or broker routes. Their private JSON fixtures must never be routed or deployed.

Before enabling real OAuth, select the dedicated Google project/client and exact callback configuration without exposing secrets, complete the actual logging gate, validate the browser/session/controller lifecycle, and establish admission/operation policy. Any remote schema action must be reviewed for its specific target and authorization and verified separately from deployment. Real posting additionally needs the existing privacy/ownership/moderation gates. Current module tests do not remove these requirements.

## Local private draft schema

`0005_private_article_drafts.sql` is source preparation for private article persistence. Like session migration0004, it is not applied remotely by this cycle or by Worker deployment. Local development/test migration runs may apply it only to local D1. The production Worker still refuses draft routes and exposes the same four fictional sample entries. There is no real draft editor, autosave, publication or moderation endpoint.

## Unconnected draft HTTP handler

The private draft HTTP handler is a factory exercised only by local test fixtures. Production worker/index.ts does not import or mount it, and neither sample route behavior nor deployed assets are changed. Do not expose the fixture's identity/clock/race controls. Local tests of no-store/private headers are not an audit of deployed cache rules, browser lifecycle or platform logs; complete the existing activation gates before mounting real private endpoints.

## Local-only editor browser fixture

`editor:build` produces ignored `.editor-preview`, separately from production `dist`. `editor:preview` seeds only the dedicated fictional local D1 under `.wrangler/editor-state` and starts a loopback HTTPS Worker on127.0.0.1:8788. The fixture's session injection is not real Google verification. Its config has a placeholder database ID, local-origin checks, and no Workers.dev URL; it is never a deployment target. Do not modify production preparation to accept its name/config or publish its entry/assets.

`test:editor` uses the dedicated Playwright config with self-signed-certificate tolerance scoped to this local fixture. It does not install OS trust or disable TLS globally. Default public-preview E2E excludes editor specs; CI runs both suites separately. Existing public-preview artifacts retain their14day policy; automatic editor screenshot/trace upload is withheld pending publication approval, and only specifically reviewed repository screenshots are included. Fictional fixture traces are not evidence of real-user privacy. No remote0004/0005 or new credentials/grants/contracts are part of this editor cycle.

## Local article reporting preparation

Migration0006 prepares private report/outbox tables and same-statement notification/hiding triggers. It is exercised only in isolated tests and local development D1. It has not been applied remotely, and Worker deployment still never executes remote SQL. Production does not import the module or mount a report/operator endpoint. Outbox rows remain pending; there is no real mail sender, configured operator, restore/delete action or public report UI. Remote0004/0005/0006 and all real publishing/privacy/operations gates must be separately addressed before enabling UGC.

## Local first-publication snapshot preparation

Migration0007 prepares private account→public-profile links and publication provenance/snapshot triggers. It is local/test-only in this cycle; remote0004/0005/0006/0007 are not applied. The production Worker/catalog remains sample-only, and the new record-backed non-sample public read function is not mounted on any real endpoint. An active local account plus a fixture profile mapping is not an enrollment/consent/release decision.

Do not wire publication into draft autosave or treat a replay as an update/restore action. New real authoring/publication needs the existing Google/browser/logout/profile/enrollment/operations/log/mail/moderation/appeal/media gates. Publication source-link deletion behavior is a technical local model; real retention/account deletion policy remains undecided. No new config/credential/operator grant/contract/deployment or screenshot publication occurs here.

## Local article-like preparation

Migration0008 and the article-like handlers are local/test-only. Production worker/index.ts does not import or mount them, and Worker deployment must not apply this migration implicitly. Existing anonymous sample reading does not create a session or like. The lab uses an explicit public association, owner withdrawal and a bounded anonymous public list; see ARTICLE-LIKES.md. Real Google/admission, graduation/activity visibility, operating/privacy and actual logging requirements remain unresolved gates. No remote migration, credential/grant or contract belongs to this local unit.

## Local standalone project preparation

Migration0009 prepares separate private project drafts and immutable project snapshots for the local/test fixture only. Production worker/index.ts does not mount these routes and deployment never applies their schema implicitly. The project-only author journey does not require an article, but it does not resolve project reporting, media, public editing, actual authentication/eligibility or operating/privacy requirements. See STANDALONE-PROJECTS.md. No remote migration or new credential/grant/contract is included.

## Local project report preparation

Migration0010 adds report intake to the isolated local/test fixture. It does not change project visibility or introduce notification, operator judgment, restore/delete or article thresholds. Production worker/index.ts does not mount these handlers. Local fictional operator access does not provision a real role. No remote schema, credential/grant, contract, mail or deployment belongs to this unit. See PROJECT-REPORT-REVIEW.md for the unresolved work-policy and actual-activation boundaries.

## Local own-publication record read

The owner-only combined record endpoint is mounted only in the isolated local/test fixture, using existing tables. It adds no migration or visibility/report/notification action and does not broaden existing publication receipts. Production worker/index.ts and sample assets remain separate. No remote operation, credential/grant, contract or deployment belongs to this read-only unit. See OWN-PUBLICATION-RECORDS.md.

## Local author publication-stop preparation

Local/test0011 adds two unique owner-stop marker tables and atomic hidden/status-republish guards. The isolated editor applies the entire idempotent file on startup; a first table alone is not evidence all guards exist. Production worker/index.ts does not mount this action and deployment does not apply its schema. No remote change, new credential/grant, contract, mail or deployment belongs to this unit. PUBLICATION-STOPS.md separates the experiment from real withdrawal/retention and operating policy.


Cycle36's recent-project feed is confined to the fictional local editor build and fixture. It adds no schema or production route, and does not apply pending remote migrations. Public sample asset bytes must remain identical; local discovery/stop checks do not establish actual CDN/cache/log protection or real publication availability. See PROJECT-DISCOVERY.md and its independent QA record.


Cycle39 pending-registration work reuses the existing private account schema only in local tests. It adds no production route, secret/key configuration, actual account, role, migration or deployment. Dedicated Google project/client creation and real callback protection remain separate confirmed-operation gates. Never deploy the private test harness or serialize its identity/session JSON through a public endpoint.

Cycle40 prepares the [OAuth HTTP adapter and optional binding contract](OAUTH-HTTP.md). The production entry's source release gate remains false; even complete runtime inputs cannot activate it. No actual origin/client/secret/key, new Worker/database, binding installation or deployment is included. Optional input types do not create secret storage. Existing preview configuration and generated Env remain unchanged. Real callback publication still requires actual log/transport, origin, eligibility and operating checks; do not flip the source gate or add deployment settings as a shortcut.


## Closed dedicated production preparation

The [production preparation boundary](PRODUCTION-CONFIG.md) is separate from the existing preview settings. Cycle41 introduced a closed entry; Cycle42 adds the fixed private selection loader and sample-only preparation. There is still no automatic production deploy command. Tests use fictional targets; any real selection/configuration remains ignored and private. No actual origin, resource identifier, secret binding installation, resource creation, remote SQL or deployment is included. Matching local account/resource inputs is not remote ownership or authorization evidence.


## Privately selected sample-only production target

`production:prepare` reads only the owned mode0600 `.wrangler/production-target.private.json`, validates the exact selected/expected target and closed OAuth source, and writes `.wrangler/production.prepare.json` privately. It invokes no deployment, network, SQL or credential flow. Dedicated public sample hosting is enabled in that generated config; authentication remains source-disabled. See [PRODUCTION-CONFIG.md](PRODUCTION-CONFIG.md) and [local independent QA](QA-PRIVATE-PRODUCTION-TARGET.md). Runtime IDs/origin and operational deployment evidence must not be published here.

A deployment must use the reviewed main archive/build, matching manifest/config fingerprints, verified dedicated resources and successful main CI. New empty-database bootstrap is a separate explicitly verified operation: only public sample schema/data and their migration records, not later auth/private schemas. Verify actual live health/catalog/denials and unchanged preview separately after deployment. Configuration preparation and successful tests do not prove a live release.


## Retired draft-trial paths

The dedicated one-person draft trial is retired. Do not build or upload its former assets, and do not restore its runtime binding. Its UI, build command and product adapter have been removed. Keep `/api/*`, `/trial-assets`, and `/trial-assets/*` in the Worker-first assets rules: the Worker returns404/no-store for the old entry and asset paths even when stale files or SPA fallback exist. This routing is a denial rule, not a trial activation path.

Remote withdrawal is separate from Worker deployment: verify the exact existing target and trusted trial selection privately, revoke only its matching grant and sessions, remove only the dedicated runtime binding while preserving other bindings/secrets and settings, then deploy the reviewed green main without old assets. Reconcile each result; never drop common schemas/accounts or erase unrelated data. Current operation evidence is recorded in the release PR; local tests do not prove remote withdrawal. See [retirement scope](RETIRED-DRAFT-TRIAL.md).
