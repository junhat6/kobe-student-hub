# Independent QA: article operator read-session boundary (Cycle35 / #69)

The independently reproduced stale-private-display defect is fixed within the tested fictional local scope. No blocking finding remains. This review does not establish real school authentication, operator provisioning, a production privacy guarantee or student value.

## Independent baseline

Before implementation, explicitly built the existing editor (`index-y8sTJgJ7.js`, `index-2wJmG2_n.css`) and ran an ignored local Playwright utility against desktop and mobile emulation. Both baseline cases passed their defect-reproduction assertions in13.2 seconds: publish a fictional article, submit one actual local report, explicitly establish the fixture operator A, open the private case, replace the cookie with an ordinary fixture B session and dispatch focus. A new raw case GET returned404, yet A's private reason/detail stayed visible. This was a browser rendering/lifecycle defect; the server denied B rather than leaking a new case response.

The baseline utility and evidence stay in ignored/local locations (`.wrangler/private-baseline` and `/tmp/kobe-moderation-session-baseline`). Independent QA opened both baseline images; the parent also opened both. Baseline fingerprints:

| Baseline file | SHA-256 |
| --- | --- |
| `src/editor/ModerationLab.tsx` | `63972b64272cf52da397a47a9f3d4704bb8ab43ee0aaaf1f50558435a1c9a16a` |
| `src/editor/moderation-client.ts` | `60a271460b72b062bb2896fb659bbf219cb754c36d5b8dbf82923548fcb9f020` |
| `.wrangler/private-baseline/moderation-baseline.spec.ts` | `7ed6a57eb75a368a4500e4dc526250888d39ea1076f00a859bb793ddefc23a92` |
| `/tmp/kobe-moderation-session-baseline/desktop.png` | `edcdadf3f2e37424d297aa1b5304b7fae579dd3c6eda56fa0267f6cc59ae9dcb` |
| `/tmp/kobe-moderation-session-baseline/mobile.png` | `63ce5fbbeff53d4bce25dd2ba3395d9fbe1845fa81f0aad8ab19c1008799e154` |

## Final independent execution

After the developer source freeze and parent complete checks, independently performed one explicit rebuild and the focused12-case run:

```sh
npm run editor:build
KOBE_LOCAL_EVIDENCE_DIR=/tmp/kobe-operator-session-final-images npx playwright test --config playwright.editor.config.ts tests/editor-operator-session.spec.ts tests/editor-operator-session-independent.spec.ts --workers=1 --output=/tmp/kobe-operator-session-final-output --reporter=list
```

- Final editor assets: `index-BHmDJRlo.js` and `index-d9_J69x4.css`.
- 12 cases passed in41.7 seconds: developer scenarios8 plus independent scenarios4, across desktop and mobile browser emulation. No physical device was used.
- Unchanged backend/SDK suites were not repeated. The parent's separate342 tests/public48/editor144/build/dry-run pass and developer18-case pass are separate evidence, not additional independent runs.
- Local self-signed HTTPS generated handshake diagnostics while browser contexts deliberately ignored that local certificate; tests completed successfully and no OS trust setting was changed.

## Source review and behavior

OperatorReadBoundary checks the existing session without creating an identity or granting a role. Its stable per-scope guarded fetcher uses the existing pre-request, post-header and body-EOF proof checks. Focus, pageshow and visibility events immediately hide/inert the private region, invalidate/abort its generation and unmount the read-only queue/case. No editable report input buffer is involved. A manual existing-session check mounts a fresh reader; each actual queue/case read still requires server operator authorization. A valid session token alone is not operator authority.

ModerationCases receives the guarded fetcher. Queue refresh clears prior selection/detail. Selecting a case fetches a fresh queue and case together, displaying neither stale branch if the read fails. Failures are unavailable states, not an empty successful result. Lifecycle invalidation prevents old asynchronous results from being accepted. The fixture delay hook is limited to the isolated local-origin/flag branch and an exact successful case GET; no production handler accepts the hook.

The focused developer scenarios independently rerun here demonstrate:

- Actual A-to-ordinary-B cookie change plus focus removes the old private subtree immediately, triggers no automatic queue read, and requires explicit checking; B's server case read is denied404.
- Synthetic session503 discards the private case rather than retaining or redisplaying it. Explicit recovery obtains a new queue without selecting the old case. Actual current-token logout yields known-invalid401 and fresh fictional operator recovery requires new reads. Repeated checks reconcile visible/non-inert state.
- A real case response is delayed five seconds at EOF. After headers and a subsequent valid A proof, the cookie changes to B before four seconds without a focus event. EOF proof rejects the old case; queue titles and private reason/detail disappear. Delay is synthetic; identities, cookies and server authorization are actual fictional fixture/store operations.
- An injected case503 clears prior queue/detail, does not claim an empty result and never reflects the supplied private error string.

Independent added cases cover separate event/request boundaries:

- Actual logout revokes the current operator token while a case is displayed. Without dispatching focus, clicking queue refresh makes the next guarded request reject401 and removes the whole private subtree; raw case GET also returns401.
- Under the same still-valid operator, a delayed case reaches headers and post-header proof, then pageshow discards/aborts it. Manual proof obtains a fresh queue. After the old response's five-second interval has elapsed, its private case has not reappeared. Only a subsequent explicit case selection displays that reason again.

No implementation changes were introduced during independent execution. The old anonymous moderation test now expects signed-out boundary text and absence of private DOM; it does not weaken the ordinary-session server denial. Existing project report/input/session contracts were not broadened.

## Local visual evidence

Independent QA opened all eight final images. The parent separately opened five: desktop01 and mobile01/02/03/04. Authorized detail is readable; invalidated states contain no old private reason/detail, and fresh recovery shows a queue with an unselected case. Mobile text wraps without observed overlap. The queue has bounded internal scrolling; these captures do not claim a complete history or that every queue row is visible simultaneously.

Images remain under `/tmp/kobe-operator-session-final-images`. The independent tests write them only with an explicit evidence directory under `/tmp`; default CI produces no new screenshots. No image publication/upload was attempted.

| Local image path | SHA-256 |
| --- | --- |
| `editor-desktop/01-authorized-private-case-before-revocation.png` | `42da0e760bd64b55bc9721de4e7a062bbf58610452ae6ffaba7abb31e0452690` |
| `editor-desktop/02-real-revocation-no-focus-clears-private-view.png` | `1f1f84087d22e131f58e7913a80383cd638fcdfb3d2f27ea6a66db2b919f3927` |
| `editor-desktop/03-pageshow-discards-delayed-private-read.png` | `f3c4257d76c0fd1dd68bbe85d6c63f439d6e083fdd88421159990297994214ae` |
| `editor-desktop/04-fresh-queue-no-late-private-case.png` | `c6e8318cbe33d63ce0e0b9d08e4fe6e5ad3852c674741855d1cd54acf54b1091` |
| `editor-mobile/01-authorized-private-case-before-revocation.png` | `d483adde2e338efa4a7aa228c9ff95563f11d8f0e66537404490700bc9f82fdf` |
| `editor-mobile/02-real-revocation-no-focus-clears-private-view.png` | `f3847b71778752ce78242f02a2f287ff8b9e3ad540a896719c7c887d90ff03da` |
| `editor-mobile/03-pageshow-discards-delayed-private-read.png` | `8ff6cff7f4b6505d99181a5c5065681814f5cbdea6d822fe50c74ad4f46547fa` |
| `editor-mobile/04-fresh-queue-no-late-private-case.png` | `9d5be45f409b48efdefd82f775c38e543e69339f17668306821f8bec3c2ea458` |

## Final source fingerprints

These identify the reviewed source, unchanged shared proof/transport, final tests and local-only fixture integration.

| File | SHA-256 |
| --- | --- |
| `src/editor/OperatorReadBoundary.tsx` | `0fffa55c4ca07b657463bf22608000f98e3009b301d4b0e13ef62ce6b4d3eba9` |
| `src/editor/operator-read.css` | `e04059d036f7da96eb487ecf3868573c3d2bfab73a216df20bfc946e3e5f668b` |
| `src/editor/ModerationLab.tsx` | `1de1978968092f3065ab62fb61f3294370488e206bc26ba56b982cba0a31e10f` |
| `src/editor/session-client.ts` | `1913862d97f3cf76381a1a777a104058a3fd1e190de5f472babb754b7cc75ffb` |
| `src/editor/moderation-client.ts` | `60a271460b72b062bb2896fb659bbf219cb754c36d5b8dbf82923548fcb9f020` |
| `tests/editor-operator-session.spec.ts` | `b882a10cee99497c1567644daf8e47c4d4371d2512a8ed74aac6dc290a7435d9` |
| `tests/editor-operator-session-independent.spec.ts` | `1dd3626ecefcebc0574cc5e847b173c4ee4e221a0b60241e041b8b5986c2516d` |
| `tests/editor-moderation.spec.ts` | `3cfb45b7e7c3af71c785ee87b108b6600665df8c551f9570ac6ca21163c197f8` |
| `tests/fixtures/editor-worker.ts` | `b6c1901b3929a4a53e55f32f0fc68afa516d93b6cedd95d34d567de476bd8672` |

## Limits

The two delayed-read scenarios use synthetic local five-second latency; session503/case503 are injected failures, not actual service outages. Fixture operator/account sessions are not real Google login, admission or real role provisioning. There were no remote operations, credentials, new permissions, migrations or production activation. This does not guarantee immediate cookie-change detection without a lifecycle/request event, protection against every concurrent race, secure memory/received-byte erasure, compromised-browser resistance, actual cache/log handling, physical-device/Safari/screen-reader behavior or student value. Restoration, deletion, operating decisions, notifications, author explanation/contact/appeal and retention remain unfinished.
