# Independent QA: closed dedicated-production preparation (Cycle41)

No blocking finding remains within this source/configuration scope. The production preparation CLI and the misleading legacy deployment name refuse execution. No real target, production configuration loader or production deploy path was added. The existing preview operation has an explicit name and retains its original command body.

## Independent execution

After the developer freeze, added three focused independent cases, type-checked and ran:

```sh
npx tsc --noEmit
npx vitest run tests/production-config.test.ts tests/production-config-independent.test.ts tests/deploy-config.test.ts
```

25 tests passed in390 milliseconds: new production checks10, independent3 and existing preview checks12. These are local pure-validator, temporary-filesystem and actual Node subprocess tests. No Wrangler/deployment/database/network command was executed by the new production entries. No old runtime378/public48/editor164 suites or browser sessions were unnecessarily repeated for this configuration-only unit. No screenshots were produced.

## Independent adversarial cases

1. Both closed entry scripts run as actual Node subprocesses with enable-like arguments, malformed workspace config, fictional target environment values and a preexisting private artifact. An independent preload traps reads of targeted environment keys and workspace configuration/output paths, child processes and HTTP/fetch. PATH contains tripwire executables for npm/npx/Wrangler/curl/sqlite. Both scripts exit1 with fixed notices, do not trigger the traps, emit no private values and leave the existing artifact unchanged. This verifies their refusal before target/config/output inspection, not merely that a malformed file happened to fail parsing.
2. A workspace root alias is normalized with realpath, producing canonical in-workspace artifact paths and mode0600. After a valid artifact, the controlled worker parent is replaced with a symlink to an outside fictional file. Re-preparation fails generically, removes only the stale regular artifact and leaves the outside sentinel unchanged. This composes root normalization, controlled-path refusal and stale-result cleanup.
3. Deceptive origins (userinfo, canonical-port spelling, extra account labels, wrong Worker label, query/fragment/trailing path) and nested secret keys in configuration/expected-preview metadata are refused. No injected field enters an artifact.

Developer cases independently rerun here additionally verify exact preview pins, same-account/distinct Worker and database checks, recursive unknown-key rejection, alternate source/assets/migration/fixture paths, regular stale output removal, output file/directory and controlled input symlinks, closed CLI child/network tripwires and package/workflow naming.

## Source review and bounded claims

productionPolicy is frozen configured:false/releaseEnabled:false. prepare-production imports only that policy and refuses without calling the fixture writer or inspecting target environment/configuration/output. The legacy deploy:production script also refuses without spawning anything and directs a deliberately intended preview operation to deploy:preview. This intentional compatibility break prevents the old name silently pretending to be a dedicated production deployment.

The pure validator checks exact supported own keys and pins the existing preview template/name/bindings. It requires a same-account fixture target with distinct Worker/database name and ID, canonical bounded identifiers, a closed source-gate marker and a Worker-label-matching single-account-label workers.dev origin. The origin is not copied into runtime settings. The artifact is constructed from reviewed fields, never by forwarding arbitrary routes, vars, secrets, build commands, bindings or resources. Selected/expected agreement is a consistency check only; it does not prove remote existence, ownership, permissions, resource contents or real environmental separation.

The fixture writer resolves the root, rejects symlinks along controlled paths, removes a previous regular artifact before failed validation and writes through an exclusive no-follow mode0600 temporary file followed by rename. The disabled CLI deliberately does not clean existing files because it never enters that helper. The source text marker is not proof of arbitrary application-code integrity, and directory/path validation is not asset/migration content validation. These checks do not defeat a hostile process racing filesystem changes, schema/command manipulation by an administrator or deliberately executing unrelated deployment commands.

Importing the helper is not release authorization. There is no selected actual target loader, target/environment enable mechanism or production deploy command. No preview generator generalization, automatic provisioning, SQL application, login/grant, permanent credential or remote operation belongs to this change.

## Existing preview and application separation

Compared the canonical preview command with the old deploy:production body from baseline HEAD `4a019800c7220fd1bf7e08d10248275c015339fc`; they are identical. The workflow differs only by the canonical command name. Existing prepare-deploy, its12 tests, production Worker entry, source application entry, Wrangler configuration, generated Env and dependency lock all match that baseline byte-for-byte. The unchanged preview generator retains its existing contract; the new strict production helper is not a retrospective audit or hardening of every existing preview behavior.

Independently compared all three currently built frontend asset names/bytes with the existing sample515 archive; they match. This read-only comparison is not a fresh application build, live deployment or remote configuration check. The parent performs required final build/dry-run checks separately, including documentation-induced build output changes.

| Canonical local frontend asset | SHA-256 |
| --- | --- |
| `MarkdownRenderer-DKi9-iI6.js` | `2a728fd3efc9582ed35259fa257da40ab18e775fac427c4005d4e640384119d5` |
| `index-BDO7j6qF.js` | `82cd7568d3a316425d58f8ebb2c91ec8c1fbbf0b865ab000bcc0caa0a41b4512` |
| `index-TfhgnYfT.css` | `693f21fae8bde088ee95499e2fb2ee5dd9a1aa6891d734e40c171555b5d5ce2d` |

## Documentation review and remaining gates

PRODUCTION-CONFIG.md correctly states the intentional command rename/break, always-closed preparation, same-account versus distinct-resource consistency policy, no actual target selection, no ownership proof, no arbitrary-code integrity claim and no new deployment path. It distinguishes fixed source policy from actual private target/credential custody and requires a later concrete reviewed operation before any real release.

No actual target or Cloudflare/provider settings were inspected or published. No private values, remote SQL, resources, permissions, billing, live Google configuration, Issue4/38 change, GitHub approval or deployment was performed by independent QA. Actual identity/admission, callback logging/transport, operating/retention/notification/appeal/contact and student/physical-device gates remain open. Source-controlled refusal and synthetic fixture success do not satisfy those gates.

## Final source fingerprints

Hashes cover the new scripts, command/workflow contract, final tests and unchanged preview/application/configuration boundaries.

| File | SHA-256 |
| --- | --- |
| `scripts/production-policy.mjs` | `e35f2ac82738076a03a81e0e636e060889678c1e4e1cd63eaf8bb394ddf4b360` |
| `scripts/prepare-production.mjs` | `718d75952b7e6ceae226204738a2136e2c08c68747643d047dbfb8d62fb4ca79` |
| `scripts/deploy-production-disabled.mjs` | `05ad7bece6fdf12d08af367e9a1f95cb236fe96700e238ef33ad9048574754ed` |
| `scripts/production-config.mjs` | `92d6be2b0adea96bdda505bf53af0ac9d9147df988eb607e588183bf42aa3966` |
| `package.json` | `9cc7b3247159234339308817d730f00ccf58c42ab164052a344d329b322a2355` |
| `.github/workflows/deploy.yml` | `e3071356fee2690b4ce21e2bf505007cd0498cab5dd2c9b5f3a29d2bf5744bc4` |
| `tests/production-config.test.ts` | `101330d5b59e09a1edf4fe7eafbc849ce151455317dbcca69d47e7996d6f5512` |
| `tests/production-config-independent.test.ts` | `59652ed5ae4096b5af41364da223ca30405ff612c006cfaf84ba3283285a56b7` |
| `scripts/prepare-deploy.mjs` | `ff3bd4a2a447799f869514b0d0b9e1d40aced14aee43c08d90dade61394ec98d` |
| `tests/deploy-config.test.ts` | `0ae578fab6b447add2778ad4bb4aa6b16797844870440a6fb4246e03692fd218` |
| `worker/index.ts` | `03841336c978198149e144619fbae35c6a0d0f97c13ef5ac105f620c00531f89` |
| `src/main.tsx` | `ce4c8523c65ecf3352f2705e3181fe1dbad737d4504fe16fe59ebdf1a7b5ec26` |
| `wrangler.jsonc` | `f003f0183150fd04ff5d7f53c324d2fcd9d42d5dc7821af840525d5e27147445` |
| `worker-configuration.d.ts` | `08b59a4d724472420029ca94ae266c406cfe65d12f40308befd43b630a197764` |
| `package-lock.json` | `0caef4fda2b1f624564e6bb62f006f83bb56937ea61c3c31748ea37a62148dd8` |
