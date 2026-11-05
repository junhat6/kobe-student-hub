# Closed production preparation

The existing deployed sample is a dedicated preview. Its preparation script fixes the preview Worker/database names and paths; it is not a dedicated production configuration. A command formerly named `deploy:production` also targeted that preview. This change makes `deploy:preview` the explicit command for the same existing procedure and makes the misleading old command refuse execution with a fixed migration notice. This is an intentional command compatibility change, not a target change. The opt-in preview workflow uses the explicit preview command; it remains opt-in.

## Current limit

The production preparation CLI is source-disabled and unconfigured. Environment values and command-line arguments cannot select a real target or open it. It creates no actual configuration artifact in this state, invokes no Wrangler, subprocess, network request or SQL, and has no production deployment command. The pure validator/writer is exercised only with fictional local inputs in temporary directories. Importing that helper is not authority to create or deploy resources.

| Entry | Current behavior |
| --- | --- |
| `npm run deploy:preview` | Existing actual preview deployment procedure; never run it to create dedicated production |
| `npm run deploy:production` | Refuses with a fixed notice; invokes no other command |
| `npm run production:prepare` | Refuses before environment/configuration/output access; existing files stay untouched |
| `prepareProductionArtifact` module export | Fixture-only local validator/writer; no CLI calls it and no command deploys its output |

The fixture writer's ignored `.wrangler/production.prepare.json` is mode0600. Validation refusal removes a prior regular fixture artifact; symlinks are refused without following or deleting their targets. The disabled CLI deliberately does not perform this cleanup because it never enters the fixture writer. The new command does not auto-provision resources or start a login.

No real Worker name, origin, account/database identifiers or provider project/contact is chosen here. Future private target selection/loading and any release gate change require a concrete reviewed change. Actual identifiers must remain outside the public source; a source-controlled configuration policy must never become a place to paste them. The existing OAuth release gate stays false independently.

## Validation boundary

Production and preview may share the intentionally selected account. The locally selected account must agree with the expected preview account, while Worker name, database name and database identifier must differ from preview. Format checks and agreement between inputs detect mistakes; they do not establish remote existence, ownership, authorization, resource contents or environmental separation. These require an authorized independent read against the exact future targets.

Only explicitly supported fields may enter the configuration. The validator checks the fixed preview template, existing application entry, production frontend asset path/binding and migration directory; it rejects fixture paths, alternate entry/build/assets/migrations, unknown fields, routes, public variables, secret inputs and extra resources. A fictional target origin must match its Worker label and one account label under workers.dev; it is validated but never copied into runtime configuration or registered anywhere. The result is constructed from validated fields rather than copying arbitrary configuration. Its public hosts and preview URLs remain disabled. No input may supply actual OAuth configuration through this path. The source-gate text check and path checks do not establish application-code or asset-content integrity; final source review and byte comparison are separate evidence.

Private generated files are local artifacts, not evidence of remote release. Filesystem checks must refuse symlinks and unsafe output parents; refused validation must not leave a previous regular artifact usable as a new successful result. Such checks do not defend against a hostile process racing filesystem changes or a developer deliberately executing unrelated deployment commands. Existing preview preparation is not expanded into a general deployment framework by this unit.

Cloudflare can [automatically provision resources when deployment bindings omit their identifiers](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning). Therefore a placeholder, missing identifier or successful dry-run must never authorize remote deployment or resource creation. No remote migrations are hidden in a deployment command.

## Before a real production release

Choose the exact intended Worker/origin and dedicated database; verify their account, names, identifiers and contents privately. Confirm public application information, policy URLs and credential custody, then separately handle required resource creation, remote schema changes and narrowly scoped credentials under their applicable authorization. Only after actual callback logging/transport, eligibility and operating gates are met may the OAuth source gate be reviewed. A dedicated provider project or local validation alone does not satisfy them.

The future Web OAuth client requires the exact chosen origin and its `/api/auth/callback`, with the existing minimal `openid email` request. Neither a preview nor an uncreated candidate URL is registered here. The client secret and cookie encryption key need a specified server-only custody/insertion destination; no value, grant, secret binding installation, DNS, billing, provider configuration, actual account or deployment is created by this preparation.
