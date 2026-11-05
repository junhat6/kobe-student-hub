# Independent QA: private dedicated sample-target preparation (Cycle42)

No blocking finding remains in the tested local preparation scope. The new source stage permits preparing a dedicated sample-only configuration from a fixed private selection. It does not enable OAuth, perform deployment, create resources, apply SQL or install credentials. Actual resource/operational work is outside this public QA record.

## Independent execution

After the developer freeze, updated the prior independent fixture assumptions for the explicitly approved new stage, added three loader-specific cases, type-checked and ran:

```sh
npx tsc --noEmit
npx vitest run tests/production-target.test.ts tests/production-target-independent.test.ts tests/production-config.test.ts tests/production-config-independent.test.ts tests/deploy-config.test.ts
```

35 tests passed in989 milliseconds across5 files: loader7, independent loader3, production configuration10, prior independent configuration3 and existing preview12. Every private target used in these tests was fictional and located under a disposable temporary workspace. Independent QA did not open or create the actual workspace's private selection. No old broad runtime/public/editor or browser suite was repeated and no screenshot was produced.

The prior independent fixture now uses the pinned public Worker/database name with a fictional account label. Its always-disabled command tripwire is intentionally narrowed to the still-disabled legacy deployment name. The preparation CLI's old always-closed expectation is superseded by this explicitly authorized sample-preparation stage; it is not a weakened OAuth release test. Developer29-case evidence is separate from this35-case independent execution.

## Source review and execution evidence

The CLI accepts no arguments and reads only the fixed ignored `.wrangler/production-target.private.json`; ambient environment cannot choose another path or target. The manifest envelope is exactly version1 plus target/preview, and deeper target/template checks remain in the strict validator. It pins the dedicated Worker/database name, requires same-account consistency with the expected preview and distinct Worker/database resources, and constructs only supported fields. Identifier format/agreement remains a consistency check, not remote ownership/existence/authorization or content verification.

The loader requires a current-user-owned regular single-link file, mode0600 and an owned non-group/world-writable nonsymlink directory. It bounds actual bytes to8KiB, opens no-follow, checks file identity/size against its opened descriptor and checks metadata after the read. UTF8 decoding is fatal, not replacement decoding. The raw-byte manifest hash is returned in process only; CLI output contains neither hash nor private selected values. Unix ownership/mode checks are not proof against every ACL or hostile concurrent filesystem actor.

The independent byte-boundary case accepts valid JSON padded to exactly8192 bytes and verifies its exact raw-byte hash. The same valid JSON with one extra whitespace byte is refused, independently of JSON syntax. Invalid UTF8 and an empty file are also refused.

A separate actual Node subprocess instruments the manifest read and appends a byte to the real fictional file immediately after the bounded read. The stable-descriptor check rejects this changed file, the CLI returns the fixed generic error and its stale regular output is gone. This is a deterministic local mutation test, not a claim to defeat every filesystem race.

The missing-fixed-file case supplies a valid alternative private file by environment and by argv. Neither can replace the fixed path. Each attempt fails with no artifact, leaves the alternative file unchanged and does not print its path or selected values.

Developer cases independently rerun here additionally check current-user/private permissions, hardlink/symlink/parent refusal, resource/name/account mixups, malformed/extra-field manifests, stale cleanup, source OAuth-gate refusal and actual CLI child/network tripwires. Existing independent cases retain legacy refusal, root-alias canonicalization, source-parent symlink failure and nested/origin rejection.

## Generated configuration and remaining boundaries

Successful preparation writes only ignored mode0600 `.wrangler/production.prepare.json`, via exclusive no-follow temporary file and rename. It enables the dedicated sample host's workers.dev endpoint while keeping preview URLs false. It forwards no arbitrary vars, routes, secrets, build commands, extra resources or OAuth configuration. The origin is validated but not copied into the generated runtime settings. Ordinary stale regular output is removed on failure; unsafe symlink targets are neither followed nor deleted. The CLI/helper never invokes Wrangler, child processes, network, SQL, resource creation or login/grants.

The application's independent OAuth source gate stays false. Legacy deploy:production still refuses; the canonical preview operation and workflow remain the existing ones. Preparing a file is not deployment authorization, not source/asset integrity proof and not evidence that its remote account/resources have been inspected. Code-marker/path checks have the limited contract already documented in Cycle41.

## Preview/application and asset identity

Byte-compared the unchanged preview generator, disabled legacy deployment command, package/workflow, existing preview tests, production Worker entry, application entry, source config, generated Env and lock with baseline HEAD `b888a9ff703b25a89e2f84e18e2992ee0a47c1e9`; all match. In particular, no auth, UI, schema, dependency or preview-target change was introduced by this local loader stage.

Independently compared all three currently built frontend asset names/bytes with the existing sample515 archive; they match. This is a read-only local comparison, not a fresh build or live endpoint/deployment check. Required final builds/operational checks remain separate parent evidence.

| Canonical local frontend asset | SHA-256 |
| --- | --- |
| `MarkdownRenderer-DKi9-iI6.js` | `2a728fd3efc9582ed35259fa257da40ab18e775fac427c4005d4e640384119d5` |
| `index-BDO7j6qF.js` | `82cd7568d3a316425d58f8ebb2c91ec8c1fbbf0b865ab000bcc0caa0a41b4512` |
| `index-TfhgnYfT.css` | `693f21fae8bde088ee95499e2fb2ee5dd9a1aa6891d734e40c171555b5d5ce2d` |

## Privacy and real-operation limits

This public report contains source contracts and fictional local evidence only. It does not include an actual private account/database identifier, selected account label/origin, manifest content/hash, billing information, runtime version or private configuration. Actual target selection, empty-database checks, initialization, deployment and later read-only HTTP observations belong to separately authorized private operational evidence.

Independent QA performed no Cloudflare/provider settings access, resource creation, remote SQL, deployment, credential/grant/key operation, Issue4/38 edit or GitHub approval. Actual browser Cookie behavior, Google configuration, callback log/transport protection, enrollment/admission, operating/notification/retention/contact/appeal and student/physical-device gates remain unverified. A reachable sample host does not open those gates.

## Final source fingerprints

Hashes include changed loader/preparation/tests and unchanged preview/application/configuration boundaries.

| File | SHA-256 |
| --- | --- |
| `scripts/production-target.mjs` | `2c45589a04d0495d91ab4e18416199c38662513d2beed09cf8f34165b78a4214` |
| `scripts/production-policy.mjs` | `c1799de6f7650eae5cf3aa0630fbca150de3f153871c91151543836453b12d66` |
| `scripts/prepare-production.mjs` | `26409674028adf2e407dc5ae0d62f9509c8fad6052e22bcbc4032684fda5d884` |
| `scripts/production-config.mjs` | `815cc27c770a4354df7a6edcab49eef481f255d0998110e0d804ab1ee0ff0ebb` |
| `tests/production-target.test.ts` | `f2f25fffa6ff4d96c37993154daf243bafb63804357e2a2cc453c644f1987bef` |
| `tests/production-target-independent.test.ts` | `025cb60f4e5e6332eeb8cf073f61e265d331e247e447dee18a9a453cb59af955` |
| `tests/production-config.test.ts` | `ffb81a5a48c1831932289df0fb6195868d6ebffeb2828bd9da343f467977300a` |
| `tests/production-config-independent.test.ts` | `0370b1369146781c1842a091f4070e9ef0a78b7098a20be7bf1c9c6ee84695dd` |
| `scripts/prepare-deploy.mjs` | `ff3bd4a2a447799f869514b0d0b9e1d40aced14aee43c08d90dade61394ec98d` |
| `scripts/deploy-production-disabled.mjs` | `05ad7bece6fdf12d08af367e9a1f95cb236fe96700e238ef33ad9048574754ed` |
| `package.json` | `9cc7b3247159234339308817d730f00ccf58c42ab164052a344d329b322a2355` |
| `.github/workflows/deploy.yml` | `e3071356fee2690b4ce21e2bf505007cd0498cab5dd2c9b5f3a29d2bf5744bc4` |
| `tests/deploy-config.test.ts` | `0ae578fab6b447add2778ad4bb4aa6b16797844870440a6fb4246e03692fd218` |
| `worker/index.ts` | `03841336c978198149e144619fbae35c6a0d0f97c13ef5ac105f620c00531f89` |
| `src/main.tsx` | `ce4c8523c65ecf3352f2705e3181fe1dbad737d4504fe16fe59ebdf1a7b5ec26` |
| `wrangler.jsonc` | `f003f0183150fd04ff5d7f53c324d2fcd9d42d5dc7821af840525d5e27147445` |
| `worker-configuration.d.ts` | `08b59a4d724472420029ca94ae266c406cfe65d12f40308befd43b630a197764` |
| `package-lock.json` | `0caef4fda2b1f624564e6bb62f006f83bb56937ea61c3c31748ea37a62148dd8` |
