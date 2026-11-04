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

After independent QA and successful CI, an authorized deployment actor can run `npm run deploy:production`. That command prepares settings, builds, then deploys the Worker with the same generated config. It deliberately does not execute remote SQL or apply migrations automatically. Schema changes are a separate reviewed and authorized operation, not a hidden deployment side effect. It requires the appropriate Workers deployment access. In CI it refuses a missing credential rather than initiating an interactive login/grant.

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

## Unconnected session schema and provider exchange

Migration `0004_private_sessions.sql` is prepared and exercised against local development and isolated test D1 only. It has not been applied remotely; do not infer its application from a successful Worker build, dry-run or CI migration test. The public Worker still does not import the session store or Google login broker. Their private JSON fixtures must never be routed or deployed.

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
