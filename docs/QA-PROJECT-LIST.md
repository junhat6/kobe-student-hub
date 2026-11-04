# Independent QA: confirmed project draft-list metadata (Cycle37 / #73)

The independently reproduced stale-title/version display is fixed within the fictional local scope. No blocking finding remains. This changes confirmed private metadata only; it does not edit public snapshots, autosave input or establish student value.

## Independent baseline

On the frozen pre-fix source, explicitly rebuilt the editor (`index-B3RHtRyH.js`, `index-BTAIEj4w.css`) and executed an ignored local Playwright utility in desktop and mobile emulation. Both defect-reproduction cases passed in13.6 seconds: create a real local private draft version1, load/open it, change title and description through the UI, acknowledge version2, then type unsaved version3. The list still showed the old title/version1 while the current saved area showed the new title/version2 and the textarea retained unsaved version3.

Independent QA and the parent both opened the two baseline images. Baseline utility/evidence remain ignored or temporary, not publicly uploaded.

| Baseline file | SHA-256 |
| --- | --- |
| `src/editor/ProjectRegistration.tsx` | `b3c7cfe7794e18156fb70db888bddfb36e19359725aed1fbdd8197ae88ae9cbf` |
| `src/editor/project-client.ts` | `c344586e6ab942beb1571e747f689ad522ee54eb039d06678f84734fbfa3f87f` |
| `.wrangler/private-baseline/project-list-baseline.spec.ts` | `e832f0298b7056de6e9817764974345ea4bb49b9ba94343da19f10fde5405367` |
| `/tmp/kobe-project-list-baseline/desktop.png` | `871c76d2aa12b00cdf9077a17b65a85083f08398f9f06e840bc266bf9c9ae17b` |
| `/tmp/kobe-project-list-baseline/mobile.png` | `065e8bc3b8432a61619d20f2e1e5d38da5e66d9c850b7f77edff5695bfe761f8` |

## Final independent execution

After source freeze and the parent's complete checks, independently ran the focused unit tests, explicitly rebuilt the editor and ran the two final browser files:

```sh
npx vitest run tests/project-list.test.ts tests/project-client.test.ts
npm run editor:build
KOBE_LOCAL_EVIDENCE_DIR=/tmp/kobe-project-list-final-images npx playwright test --config playwright.editor.config.ts tests/editor-project-list.spec.ts tests/editor-project-list-independent.spec.ts --workers=1 --output=/tmp/kobe-project-list-final-output --reporter=list
```

- 10 unit tests passed in83 milliseconds: merge helper3 and unchanged project client7.
- Final editor assets: `index-DBeOr-vz.js` and `index-BTAIEj4w.css`.
- 10 browser cases passed in29.9 seconds: developer scenarios6 plus independent scenarios4, across desktop and mobile emulation. No physical device was used.
- The parent's separate350 tests/public48/editor164/build/dry-run pass and developer12 browser cases are separate evidence, not additional independent runs. Unchanged backend/authentication suites were not repeated.
- Local self-signed HTTPS produced handshake diagnostics while browser contexts deliberately ignored that local certificate. Cases completed successfully without OS trust changes.

## Source and contract review

mergeConfirmedProject updates a matching row only with a strictly higher confirmed version; equal or older metadata retains the known row. It projects exactly ID/title/version/updatedAt, avoiding private body/URL fields, sorts by server updated time descending with deterministic ASCII ID ties, caps at20 and does not mutate the original list.

ProjectRegistration invokes this merge only after successful, validated create/update acknowledgments or owned single-draft GETs in the current request/session generation. It does not merge submitted-but-unconfirmed input. A failed or uncertain write has no optimistic metadata update. Confirming one saved result does not clear the full-list failure warning. Explicit successful list refresh remains an independent replacement of the fetched page.

The screen calls this a set of records confirmed here, explaining that fetched records plus subsequent confirmed saves are shown in update-time order up to20 and that other-screen changes require an explicit refresh. It does not claim a complete live list. Input, comparison candidate, uncertainty state and historical public publication acknowledgment keep their own contracts; metadata merging alone does not replace the editing buffer or republish anything.

Actual backend timestamps/versioned acknowledgments are used. Unit cases verify summary-only projection, immutable input, strictly newer/equal/older version behavior, timestamp order, ASCII ties and20 limit. The unchanged client tests remain successful. No backend/schema/session proof changes belong to this fix.

## Browser evidence

The independently rerun developer scenarios cover create and update acknowledgments while newer typing continues, an actual committed update with an injected lost503 acknowledgment, and a synthetic older owned GET. Unknown writes leave the old list until explicit owned GET confirmation. That GET updates metadata/comparison without silently clearing write uncertainty or replacing input. An older synthetic response cannot downgrade known version2. The synthetic stale response is a client regression fixture, not evidence that the actual server returns older data.

The first independent scenario updates a real local draft to version2, then starts an owned GET whose body EOF is delayed by the existing five-second local hook. After response headers and a subsequent valid A proof, the actual browser cookie is changed to B within four seconds without dispatching focus. Before a late metadata merge can occur, the parent guard discards the old author subtree. Explicit B verification/continuation yields an empty B draft list and no A title/version2. Delay is synthetic; stored draft update, cookie change and authorization are actual fictional fixture/store operations.

The second independent scenario starts with an actual immutable public version1, edits the private title/description and confirms version2 through UI, then types unsaved version3. The private list immediately shows the renamed title/version2. The textarea still contains unsaved version3. A fresh anonymous context retrieves the original title/description through both the project reader and new works feed; its rendered reader uses the matching mobile/desktop viewport, and its cookie jar stays empty. No private version is silently published.

No implementation or test changes were made during this final independent run. PROJECT-LIST.md and the screen distinguish known confirmations from complete current server state. A manual refresh can observe a different point in time; this unit does not add synchronization or draft history.

## Local visual evidence

Independent QA opened all eight final images. The parent separately opened exactly five: desktop03 and mobile01/02/03/04; both baseline images were also opened separately. The updated title/version2 row, current saved2 and unsaved3 are simultaneously readable. Closed-A and new-B-empty states contain no old row. The anonymous reader retains public version1. Long mobile text wraps without observed overlap. These selected regions are not whole-page accessibility or physical-device evidence.

Images remain only under `/tmp/kobe-project-list-final-images`. Tests require explicit KOBE_LOCAL_EVIDENCE_DIR under `/tmp`; default CI writes no new screenshots. No image publication/upload was attempted.

| Local image path | SHA-256 |
| --- | --- |
| `editor-desktop/01-old-draft-metadata-scope-discarded.png` | `54ea82b4dc70375c539a74385aff6eaf853044aaf8b2c3f3abd344951d0cf657` |
| `editor-desktop/02-new-account-no-old-row-merge.png` | `298a1f8b6e04de83bd858814caa3fe1f6f103746875cc763493d5b9196c20d6d` |
| `editor-desktop/03-confirmed-list-two-unsaved-three.png` | `c7a716b3dc88c61a3322590745450c78ca8d1f5f5667f22905bf5d6ff31a98fc` |
| `editor-desktop/04-anonymous-original-public-one.png` | `8495b25dd104ebcbf83ee32f0b18e60c19cfbbd0b70800b30e5ef1639748fe88` |
| `editor-mobile/01-old-draft-metadata-scope-discarded.png` | `bf76466c1ae4f7272de651ccfc5479783a8ec10e602a85fb0f1a7544507834df` |
| `editor-mobile/02-new-account-no-old-row-merge.png` | `9357789548c87ad0920cd2ceae846e8d30d73417c0e98544b87bef0dc4e1ac79` |
| `editor-mobile/03-confirmed-list-two-unsaved-three.png` | `e3efc82c22bed88b13f4581fce77443796f77b68f831d9d4e08e6878136fdfd2` |
| `editor-mobile/04-anonymous-original-public-one.png` | `5b2b068436ed37c6a9ca8c988369821fd4e5af8d5aa60d7733c9ac32b339b312` |

## Final source fingerprints

Unchanged client and local fixture hashes identify the boundaries reused by the regression scenarios.

| File | SHA-256 |
| --- | --- |
| `src/editor/ProjectRegistration.tsx` | `6bc1fe59ee23ea1a9df01e24d0bc4f0df685e57cb96d73384704ae44ab9fc077` |
| `src/editor/project-list.ts` | `b04612a61dcc4da90ffd22a36fd87e672df396375ddc63cf182ccee5e67a24d6` |
| `src/editor/project-client.ts` | `c344586e6ab942beb1571e747f689ad522ee54eb039d06678f84734fbfa3f87f` |
| `tests/project-list.test.ts` | `d1c6407ca219f995521b13522f236d1f9932dfcc1a68fc0d3a47093c668b80e2` |
| `tests/project-client.test.ts` | `38b263135eb50e6135e9dd1e416e10c5314919d7146968b7bd1d9af573157fbe` |
| `tests/editor-project-list.spec.ts` | `fd77853b25dbcab7274a83f9dbdef71c7b4dfb4ae8648b85b1cb7b34f35e3747` |
| `tests/editor-project-list-independent.spec.ts` | `80a84bc103de1da86d5db01a6cc3e53fa373fb8498d81887fd8e71537713cc45` |
| `tests/fixtures/editor-worker.ts` | `787f0628aaeed400ac2fca160431bface9bfbc5dd25577fe16d0deb8b516b47d` |

## Limits

This uses fictional local accounts, localhost HTTPS and local D1. No remote schema/configuration/data, credentials, permissions, deployment or real Google/admission/operator action was performed. The guard does not guarantee immediate detection without a lifecycle/request event, every concurrent cookie race or memory erasure. Public editing, real service activation, logging/cache/privacy operations, physical-device/Safari/screen-reader behavior and actual student usefulness remain separate unverified work. Metadata confirmation is not automatic saving or complete cross-device synchronization.
