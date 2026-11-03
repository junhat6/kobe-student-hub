# Cloudflare deployment

## Current status

Local Workers + D1 are verified. No remote resources have been created for this project. `wrangler.jsonc` has an explicit placeholder database ID and `workers_dev:false`; it cannot be mistaken for an already configured deployment. No payment, plan upgrade, R2 activation, new token or GitHub integration has been performed.

Automatic review rejected creation of D1 `kobe-student-hub-preview` under account `29a0469ba7d11f29ac94e3ed41f388a8`, citing persistent external resource and potential billing commitment without specific permission for that resource/cost. Do not retry by another route. Billing Read is unavailable. The main merge/deploy autonomy instruction does not eliminate runtime approval rules.

## Once resource authorization and access are resolved

1. Confirm the selected account and the exact resource name; list existing resources before creating to avoid duplicates.
2. Create only the new `kobe-student-hub-preview` D1 database. Use the returned ID in `wrangler.jsonc`. No changes to ideaboost-whiteboard. Prefer no plan upgrade; stop if a paid commitment or unexpected charge is required.
3. Keep this sample preview clearly labeled and noindexed. Set `workers_dev:true` only for the intended new preview Worker; keep `preview_urls:false` unless explicitly needed.
4. Run `npm ci`, `npm run types`, `npm run build`, `npm test`, `npm run db:local`, `npm run test:e2e`, `npm run deploy:check`. Independent QA must review user-facing changes.
5. Apply migrations on the new remote DB using `wrangler d1 migrations apply kobe-student-hub-preview --remote`. Do not execute unrelated SQL, wipe data, or replay migrations blindly.
6. Deploy with `wrangler deploy`. Record the returned literal URL and version; verify `/api/health`, `/api/catalog`, a deep link and security headers. No guessed URL counts as verification.
7. Record evidence and remaining limits. This preview deployment does not authorize opening real student posting.

CLI auth is presently workers_scripts-only. Use an already authorized connector for supported operations or request the minimum missing D1 write access. Do not run the default broad `wrangler login` grant without checking scopes and applicable approval.

## GitHub pipeline

`ci.yml` runs on PRs and main pushes: lockfile install, type generation, build, Worker/D1 tests, migrations, Chromium desktop/mobile E2E and dry-run. Failures retain reports/screenshots/traces. No production credentials are needed.

`deploy.yml` is opt-in. It runs only when repository variable `CLOUDFLARE_DEPLOY_ENABLED` is `true`, on main push or manual dispatch, and has its own validation before deployment. Until infrastructure is real and a narrow Actions secret is authorized, leave this unset. Current remote-resource guard fails if the D1 ID is placeholder or workers_dev is false. Set Actions secret `CLOUDFLARE_API_TOKEN` and variable `CLOUDFLARE_ACCOUNT_ID` only through secure settings; never paste the token in an issue/chat/code. Required permissions: Workers Scripts edit and D1 edit on this account; prefer narrower resource restrictions where supported. Do not grant account-wide administrative access.

No persistent token or integration was created. Automatic deployment is configured in source, **not yet activated**. Initial deployment can use an authorized connector without adding GitHub credentials, but that does not make future CI deployment active.

## Costs and recovery

Official pricing checked 2026-11-03: [Workers](https://developers.cloudflare.com/workers/platform/pricing/) has a free plan, paid minimum $5/month/account; [D1](https://developers.cloudflare.com/d1/platform/pricing/) free tier includes 5M rows read/day, 100K written/day and 5GB total storage. Static asset requests are free. The existing account subscription cannot be read, so do not promise zero incremental cost. Free-plan limits are shared with other account projects. No new billing contract has been accepted. No AI/R2/paid email service is used.

For a bad Worker release use `wrangler rollback` to a verified previous version, after confirming target. Database migrations are independent; rollbacks do not undo schema/data changes. Before real users, design backups/retention and backwards-compatible migrations. Do not delete remote data as a rollback shortcut.
