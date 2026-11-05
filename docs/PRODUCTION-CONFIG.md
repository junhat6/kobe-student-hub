# Private sample-only production preparation

The existing deployed sample is a dedicated preview. Its preparation script fixes the preview Worker/database names and paths; it is not a dedicated production configuration. A command formerly named `deploy:production` also targeted that preview. This change makes `deploy:preview` the explicit command for the same existing procedure and makes the misleading old command refuse execution with a fixed migration notice. This is an intentional command compatibility change, not a target change. The opt-in preview workflow uses the explicit preview command; it remains opt-in.

## Current preparation contract (Cycle42)

Local preparation now requires a privately verified dedicated sample target. The only selection source is the ignored `.wrangler/production-target.private.json`, not environment values, CLI flags or an alternate filename. Its exact outer fields are `version:1`, `target` and `preview`; the target contains Worker name, account/database identifiers, database name and origin, while expected preview metadata contains its Worker/account/database identifiers and database name. No credentials, variables or resource operations belong in this file. Real values stay outside public source, issues, command arguments and normal output.

The selected dedicated Worker/database names are pinned in code; actual account/database identifiers and origin are private inputs. The loader requires an owned regular single-link mode0600 file of at most8192 bytes, a safe owned parent, no symlinks, valid UTF-8/JSON/schema and stable descriptor metadata before/after its bounded read. It returns a manifest fingerprint in-process for private provenance, never stdout. Those checks are local consistency/privacy checks, not remote ownership or authorization evidence.

| Entry | Current behavior |
| --- | --- |
| `npm run deploy:preview` | Existing actual preview procedure, same target and command body |
| `npm run deploy:production` | Refuses with a fixed notice; invokes no other command |
| `npm run production:prepare` | Reads the fixed private selection, validates local source and writes an ignored mode0600 configuration; rejects arguments and ignores environment target overrides |

The local preparation command invokes no Wrangler, subprocess, network, SQL, login, resource creation or deployment. Missing/invalid selection and source validation failures clear only a safe owned regular stale production artifact; unsafe paths are refused without following or deleting symlink targets. A failed command is never a prepared release. There is no automatic production deployment chain.

The generated `.wrangler/production.prepare.json` enables the dedicated sample Worker host with `workers_dev:true`, keeps preview URLs disabled and never adds OAuth variables, secrets, routes or unrelated bindings. Public sample hosting is separate from authentication: the application source gate must remain false. A real deployment actor must independently verify target ownership/existence, dedicated DB contents, the exact reviewed source/tree, main CI, artifact/manifest fingerprints and built asset bytes before an explicit deployment operation.

## Validation boundary

Production and preview may share the intentionally selected account. The locally selected account must agree with the expected preview account, while Worker name, database name and database identifier must differ from preview. Format checks and agreement between inputs detect mistakes; they do not establish remote existence, ownership, authorization, resource contents or environmental separation. These require an authorized independent read against the exact future targets.

Only explicitly supported fields may enter the configuration. The validator checks the fixed preview template, existing application entry, production frontend asset path/binding and migration directory; it rejects fixture paths, alternate entry/build/assets/migrations, unknown fields, routes, public variables, secret inputs and extra resources. A selected target origin must match its Worker label and one account label under workers.dev; it is validated but never copied into runtime configuration or registered anywhere. The result is constructed from validated fields rather than copying arbitrary configuration. Only its dedicated sample host is enabled; preview URLs remain disabled. No input may supply actual OAuth configuration through this path. The source-gate text check and path checks do not establish application-code or asset-content integrity; final source review and byte comparison are separate evidence.

Private generated files are local artifacts, not evidence of remote release. Filesystem checks must refuse symlinks and unsafe output parents; refused validation must not leave a previous regular artifact usable as a new successful result. Such checks do not defend against a hostile process racing filesystem changes or a developer deliberately executing unrelated deployment commands. Existing preview preparation is not expanded into a general deployment framework by this unit.

Cloudflare can [automatically provision resources when deployment bindings omit their identifiers](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning). Therefore a placeholder, missing identifier or successful dry-run must never authorize remote deployment or resource creation. No remote migrations are hidden in a deployment command.

## Before enabling real authentication

Choose the exact intended Worker/origin and dedicated database; verify their account, names, identifiers and contents privately. Confirm public application information, policy URLs and credential custody, then separately handle required resource creation, remote schema changes and narrowly scoped credentials under their applicable authorization. Only after actual callback logging/transport, eligibility and operating gates are met may the OAuth source gate be reviewed. A dedicated provider project or local validation alone does not satisfy them.

The future Web OAuth client requires the exact chosen origin and its `/api/auth/callback`, with the existing minimal `openid email` request. Neither a preview nor an uncreated candidate URL is registered here. The client secret and cookie encryption key need a specified server-only custody/insertion destination; no value, grant, secret binding installation, DNS, billing, provider configuration, actual account or deployment is created by this preparation.

Verify credential intake before creating a client: Google documents that the [client secret is shown only immediately after creation](https://support.google.com/cloud/answer/15549257?hl=en). It must not pass through ordinary chat, public source, command arguments or captured logs. An ignored target manifest is not a secret manager and rejects credential fields. Future Worker secret bindings are `GOOGLE_CLIENT_SECRET` and `OAUTH_COOKIE_KEY`; no values are generated or installed by this loader.

Secret insertion has deployment effects separate from custody. Cloudflare documents that [`wrangler secret put` creates a version and deploys immediately, while `wrangler versions secret put` creates a version without deploying](https://developers.cloudflare.com/workers/configuration/secrets/). A dashboard secret change also uses a Deploy action. Future operation confirmation must identify the exact Worker/bindings, safe value intake, custody and version/deployment effect. This preparation executes neither command.
