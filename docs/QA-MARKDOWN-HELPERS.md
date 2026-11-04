# Independent QA — Markdown helper corrections (Cycle24 / #49)

## Baseline reproduction before implementation

On frozen main cc5177, independently rebuilt the unchanged editor and opened a fresh desktop Chromium context against fictional local HTTPS8788. No implementation file was changed. Selected offsets5..10 in `前の文章 選択する語 後の文章`, then clicked 見出し. Actual textarea became `前の文章 ## 選択する語 後の文章`; preview had zero h2 elements and showed literal inline##. Selected all of `alpha\n```\nbeta`, then clicked コード. Actual wrapper used fixed triple backticks; rendered code blocks contained `alpha\n` and empty text, with beta outside as a paragraph. Both screenshots were actually opened and visually inspected independently; parent separately opened both. This establishes the two existing bugs rather than inferring them from source.

Baseline browser script used synthetic text, local fixture bootstrap and no Clipboard API action. The temporary local server was deliberately stopped with Ctrl-C (exit130) after evidence collection, and scripts/8788 released. No real identity, remote mutation or screenshot publication occurred.

| Local baseline file | SHA256 |
| --- | --- |
| `/tmp/kobe-markdown-helper-baseline/01-heading-inline.png` | `39597d53ea6b0c7e9cd209ae26463000215c1cb1bd725cbca396dc29369984e6` |
| `/tmp/kobe-markdown-helper-baseline/02-code-fence-break.png` | `8f3f637d77444d45847079887e92d3130d507da1a0e391e762df753ab25298a2` |
| `/tmp/kobe-markdown-helper-baseline/result.json` | `a555a8c5a6ce61d81dcff5f9816fcf7ef849eac48791a364eb6e24ef3dbe766e` |

## Earlier verification plan (historical)

Implementation is in progress. Planned independent review covers whole logical-line transforms, end-at-next-line exclusion, original selection mapping, CRLF/DOM normalization, fence length versus selected backticks, composition/stale-selection guards and preservation of pending-save editing. Final test scope will avoid duplicating developer cases. Baseline screenshots are not evidence of corrected behavior. Local operation tests are not physical IME, real Google activation or student usefulness validation. All screenshots remain local-only and previously held images are not retried.

## Final independent result

No outstanding blocker in the selected correction. Executed final `npx vitest run tests/markdown-format.test.ts`: **10 passed,115ms**. Then explicitly `npm run editor:build` and `npx playwright test --config playwright.editor.config.ts --workers=1 --output=/tmp/kobe-markdown-helpers-independent-final --reporter=list`: **72 passed (Playwright reports1.0m)**, prior editor62 +developer format8 +independent2. Final lab assets `index-CKTO9NOm.js`, `index-CMlR_DXF.css`. This final run includes the empty-ATX marker regex correction made after developer's earlier8-browser checkpoint. No duplicate full unit/public browser run was performed by independent QA. Scripts/8788 released afterward.

### Verified behavior

1. Final source review and actual Markdown renderer unit assertions establish whole touched logical-line heading/code behavior, next-line-start exclusion, blank/idempotent ATX handling including marker-at-EOL, CRLF/CR index mapping, variable fence length, unchanged inline bold, surrogate-boundary rejection and no silent byte-limit clipping. This is a line-oriented aid, not a general enclosing-Markdown parser.
2. Final PC/mobile browser suite checks keyboard heading/fence preview, save/reopen, pending-save edits, synthetic composition disable/synchronous guard, edit/preview composition lock and existing UTF8 byte gate. Delayed old-save acknowledgment does not overwrite later helper changes; no automatic saving is claimed.
3. Independent case creates a real local D1 draft via private HTTP with raw CRLF source, opens normalized textarea, selects the middle logical line ending at next-line start and activates heading with keyboard Enter. Original selected text stays selected; outside lines are not transformed. Explicit save/readback proves exact raw CRLF is preserved. Actual preview contains the expected h2 and plain outside lines.
4. Same baseline alpha/triple-backtick/beta payload now renders inside one code block, including the literal triple backticks and beta. Final six screenshots establish corrected heading selection/preview and safe code payload in desktop/mobile. No clipboard read/write/copy action was performed.

Composition tests dispatch synthetic events; they do not validate physical Japanese IME. Source layout-effect guards verify current body/DOM and drop stale pending selection on input/navigation/preview/composition transitions. Native undo/caret behavior across every browser is not proven.

## Final visual evidence — local only

All six final screenshots were actually opened and visually inspected independently. Parent separately viewed desktop01/03 and mobile02/03. Selection remains visible in the current textarea, heading preview separates outside lines, and one code block retains the full fence-containing payload. Mobile wraps within the inspected region with no visible overlap. Captures are state/region crops; code preview03 omits the title above and is not a whole-page layout assertion. Baseline images remain historical failure evidence, not corrected screenshots.

Chromium desktop/iPhone13 emulation is distinct from physical Safari/device/assistive technology testing. Self-signed localhost HTTPS was ignored only in browser context configuration; CertificateUnknown diagnostics occurred while tests passed. No OS trust setting changed. Temporary local paths may expire; no image was uploaded/published/copied to repository evidence and no held image was retried.

Base `/tmp/kobe-markdown-helpers-independent-final/`

| Relative final local PNG | SHA256 |
| --- | --- |
| `editor-markdown-independen-8fc0e-gs-through-heading-and-save-editor-desktop/01-crlf-heading-selection.png` | `4701260de56231372a06d00ad1498d46270eabe5e0c51d255974afa1632d5fa4` |
| `editor-markdown-independen-8fc0e-gs-through-heading-and-save-editor-desktop/02-crlf-heading-preview.png` | `0e39d8bc3fec34e6ce02edb79de11c460a25b7dd2cf7b14daef700b5d90963b9` |
| `editor-markdown-independen-8fc0e-gs-through-heading-and-save-editor-desktop/03-backtick-code-preview.png` | `d943961265d7470c87cd17f4ae1e4cc10da1696d484baeffed7a198344dd9027` |
| `editor-markdown-independen-8fc0e-gs-through-heading-and-save-editor-mobile/01-crlf-heading-selection.png` | `f7f885aa5044d4e4485416957c04adc6dba5c0ea11f210b963d4f26b2f6de84c` |
| `editor-markdown-independen-8fc0e-gs-through-heading-and-save-editor-mobile/02-crlf-heading-preview.png` | `34de706ad16871215ca789e028829d4546ad3c587e1edc29dd6735a7dde14141` |
| `editor-markdown-independen-8fc0e-gs-through-heading-and-save-editor-mobile/03-backtick-code-preview.png` | `f6fa2e9b93e885380de3683019be598542ed2630ef8a04e44e75354951fa8fc7` |

## Final five source fingerprints

Working-tree content hashes, without assuming a future commit SHA.

| File | SHA256 |
| --- | --- |
| `src/editor/markdown-format.ts` | `f974445cca1882ef717908b89c0fc82b5ed5a54c02db0755505fcc32e78eaf93` |
| `src/editor/DraftEditor.tsx` | `5f69fa9a2b36454586018bc6ce1346100ee9183ff841feb0e0c56415e8f31c83` |
| `tests/markdown-format.test.ts` | `6f090b409e8efdb312e4b227737b9130c76cb3fc7712fc749be3c12b1aabe8c1` |
| `tests/editor-format.spec.ts` | `3be6e82ad3ca4169103c28d14bf841d52f41f67db433d4a045f6c4e7878e7014` |
| `tests/editor-markdown-independent.spec.ts` | `8703c6dd0427883deede490aba5d5eecab4ede9aebd1c534e86894e650e2c0bd` |

## Limits

No production route/assets/config, remote schema/data, real Google/admission/session settings, new credentials/grants, contracts/R2/mail or deployment was changed by QA. Markdown renderer and new feature scope were not expanded. Actual school onboarding/privacy/cache/log/operational contacts and student usefulness remain separate gates. Browser automation proves the exercised local operations, not student value or physical device/IME usability. QA changed only its authorized independent spec and report; implementation corrections belong to the developer.
