# Independent QA: own publication records (Cycle33 / #65)

No blocking finding remains within this local fictional-data scope. This review covers a private owner-only list, not public editing, restoration, notification delivery, an explanation of moderation decisions, or actual account activation.

## Independent execution

After the implementation freeze and the parent's required checks, independently rebuilt the Worker test fixtures and ran:

```sh
npx vitest run tests/own-publications.test.ts tests/own-publications-client.test.ts tests/publication.test.ts tests/projects.test.ts tests/sessions.test.ts
npm run editor:build
KOBE_LOCAL_EVIDENCE_DIR=/tmp/kobe-own-publication-independent-images npx playwright test --config playwright.editor.config.ts tests/editor-own-publications.spec.ts tests/editor-own-publications-independent.spec.ts --workers=1 --output=/tmp/kobe-own-publication-independent-test-output --reporter=list
```

- 43 tests passed in 6.64 seconds: own records 6, client 4, article publication 11, projects 10, sessions 12.
- The explicit editor rebuild produced `index-DbVHDxJY.js` and `index-B3XYYxhy.css`.
- 8 browser cases passed in 27.9 seconds: developer scenarios 4 and independent scenarios 4, across desktop and mobile browser emulation. No physical device was used.
- Local self-signed HTTPS produced server handshake diagnostics while browser contexts intentionally ignored that local certificate; all cases completed successfully. No OS trust installation was performed.

The parent's separate complete checks (332 tests, public 48 and editor 122, build and deployment dry run) are parent evidence, not additional independent runs. No implementation changes or additional broad reruns were made during this review.

## Source and behavior review

The single final SQL snapshot checks the current session/account/epoch/time, selects at most 21 records from each kind, combines at most 42 candidates, validates all 21 combined candidates and returns 20 with `moreExists`. A malformed extra candidate fails closed rather than implying a complete valid list. Owner linkage comes from stored publication records; profile changes and private draft removal do not silently remove these records. Article linkage is checked without filtering invalid owned records into false absence.

The DTO exposes only kind, public ID, title, stored status, initial publication time and source version. The exact route accepts GET only, bounds JSON to 64 KiB, uses private/no-store headers and distinguishes known invalid sessions from unavailable storage. No account/provider/draft identifiers, bodies, report text, reporter counts or notification data are projected.

Actual local D1 tests cover mixed ordering, cross-kind ties, corrupt twenty-first records, storage faults, final authorization races and private draft deletion. Three actual article reports produce the existing article hidden state; multiple project reports leave project status published. The latter is not a newly agreed reporting policy. A fixture SQL update tests a stored deleted status; the UI provides no deletion operation.

The independent browser scenarios created 21 actual alternating article/project publications and verified the partial notice, 20 visible rows, exact six-field raw HTTP DTO and private response headers without Set-Cookie. A separate real-cookie scope change occurred after delayed response headers and a subsequent valid A proof, before the five-second body EOF. The old list and editing subtree were discarded; explicit verification and continuation under B yielded B's genuinely empty list with no A titles. Delay is a synthetic local transport hook; session creation and session-cookie change use the fictional local fixture and actual stores.

Developer browser cases independently rerun here cover actual article hiding with the reader link removed, published project reader links opening separately while private text remains, repeated same-session proof preserving the same editor DOM without an extra list fetch, and an injected 503 refresh clearing old rows without claiming an empty list. Manual retry recovers. The Account session reconciliation generation was part of the frozen source, not a fix introduced by QA.

The labels explicitly say recorded status and initial publication time. They do not establish why a record is hidden/deleted, whether mail was delivered, current anonymous reader eligibility, a complete history, secure erasure, or a moderation decision. Published links are offered only for recorded published states; hidden/deleted rows have no reader link.

## Local visual evidence

All eight PNGs were opened and inspected by independent QA. Desktop and narrow mobile layouts are readable, with no observed overlap; the 20-item list explicitly indicates more records, record fields wrap on mobile, and the closed-A/new-B-empty states are distinguishable. These are selected panel/row captures, not whole-page accessibility proof. The parent separately viewed five: desktop02 and mobile01/02/03/04.

Images remain only under `/tmp/kobe-own-publication-independent-images`. The independent test requires an explicit local evidence directory under `/tmp`; default CI execution writes no new screenshots. No image publication or upload was attempted.

| Local image path | SHA-256 |
| --- | --- |
| `editor-desktop/01-mixed-twenty-records-partial.png` | `fc2dce491c38a16afc878247d61695a369a4c99b8b7c1c8611a284b057276971` |
| `editor-desktop/02-stored-state-source-version-and-time.png` | `6f97dc7357dfed3d80da6b9900aa3f21e05aacc08426fdb109109877a0351c78` |
| `editor-desktop/03-delayed-old-record-scope-closed.png` | `54ea82b4dc70375c539a74385aff6eaf853044aaf8b2c3f3abd344951d0cf657` |
| `editor-desktop/04-new-author-empty-own-records.png` | `f0413193db5759f01654783b170e9d665093fe25af7dfef2b583746a256466f8` |
| `editor-mobile/01-mixed-twenty-records-partial.png` | `53194e9a9b9ab659d9b10015b0d94e53f681c5d834abe1df8789d2c6abc3523c` |
| `editor-mobile/02-stored-state-source-version-and-time.png` | `e87650908686aa2e99661c31d1f6d94b084fb61186240f9f5c07c26015438b90` |
| `editor-mobile/03-delayed-old-record-scope-closed.png` | `bf76466c1ae4f7272de651ccfc5479783a8ec10e602a85fb0f1a7544507834df` |
| `editor-mobile/04-new-author-empty-own-records.png` | `9bcb5db603158ccad5624a4f795924bfb3adf294187069e4b7fca3b9847863b9` |

## Final source fingerprints

These hashes identify the reviewed and executed source, test, fixture and build integration files.

| File | SHA-256 |
| --- | --- |
| `worker/own-publications.ts` | `480bceb782d60195c40c259eb85a294799ade08874a6602f43624639dd93c3e9` |
| `worker/own-publications-http.ts` | `5bb8fa766b56324c659f5ce598be2dc26a51dd1d66c305d268a8787b1b81bb7a` |
| `src/own-publication-types.ts` | `33e2a0dfb4624a2298093486153968d4d096e798bb5bbbb750835087b41a1b7a` |
| `src/editor/OwnPublications.tsx` | `5453411fef7705ce546dcb1b1cdab59fbfd0d600d01db160dca41c7db212c725` |
| `src/editor/own-publications-client.ts` | `cbe7beca72e05090fbb6fcb8ada516f00cc5bd1edbc11e32586202327cbb31ec` |
| `src/editor/own-publications.css` | `f06a9ca130d7cf141077527014f29f0c4908fa2b9ea9aad17a214e1ea89605d4` |
| `src/editor/AccountSessionLab.tsx` | `c2b6d993bd6f3b2772b36300ff583c5236245549d5101c6602de387b6b948213` |
| `tests/own-publications.test.ts` | `bd126c156dc0e0cb7c6333e5313aa0050870daa3fd241df7d228df55b17f559d` |
| `tests/own-publications-client.test.ts` | `7fec9d833dc0ef889acca5cf9b876f071aa420508643df87ae5435e593a66876` |
| `tests/editor-own-publications.spec.ts` | `49f1c3698c0e117205025f1bd659cfc4a4c479f4e91cb01c7527bf8c625fc478` |
| `tests/editor-own-publications-independent.spec.ts` | `5241d63cff0412d11afd1bf620ef5ff73ceba06668dcf6c5a635acaaa82a483b` |
| `tests/fixtures/own-publications-worker.ts` | `d7188ad1fe8db3957c99b0c83c8518e1a98d26449ce22b61df2a23cd0f960d03` |
| `tests/fixtures/editor-worker.ts` | `ea8e2467f62a85b00bbe5f181bb79f586fa2809e41be41e1421fad7e2f6e0555` |
| `scripts/build-test-fixtures.mjs` | `1dabcfa3e6b008bad2ff53897eb2a47822f6c60a29a798d997ff645ca6da9404` |

## Limits

This is an isolated HTTPS lab with fictional account/session fixtures and local D1. No real Google authentication, enrollment decision, production private route, remote schema operation, new permission, mail delivery or policy action was exercised. No claims are made about instant cross-tab detection, atomic protection against every concurrent cookie change, heap erasure, abort undoing an already committed operation, physical-device behavior, screen-reader usability or actual student value. Stored statuses do not authorize editing, republication, restoration, appeal or deletion. Production activation gates remain separate.
