# Independent QA — private draft deletion

2026-11-08. Separate context from the implementer, reviewing the uncommitted change based on main `6bcfe8f24980561a4055760c986d475595bca79e`. Sources were copied into an isolated temporary directory without runtime configuration, credentials, `.wrangler`, or Git metadata. Dependencies were shared; builds, ephemeral D1, browser processes and output were isolated. No production, Google account, grant, schema, deployment, or GitHub mutation was performed.

## Result

No blocking finding in the bounded `privateOnly` deletion flow. This verifies fictional local behavior, not student usefulness, physical-device behavior, hosted privacy/logging, actual eligibility, or post-expiry erasure.

Static review confirmed:

- The deletion UI is restricted to `privateOnly`. The shared local publishing editor does not offer it; deleting a private draft is not presented as deleting a publication.
- Confirmation names the saved title and version, warns about unsaved changes, offers cancellation first, and stays inside the existing private DOM boundary rather than a portal.
- The client sends one same-origin, no-store, redirect-refusing DELETE with purpose-bound CSRF and `expectedVersion`. Only exact JSON `{deleted:true}` at the expected success status acknowledges deletion.
- Acknowledged deletion clears the selected draft, input, preview/comparison and corresponding list row. Error/unknown results retain the buffer, disable save/delete, and require explicit read/rebase/reconfirmation. Neither a generic 404 nor absence from the bounded list proves deletion.
- Existing server ownership/session/grant/final-SQL checks are unchanged. The visible expiry notice accurately states that self-service becomes unavailable after the trial and there is no expiry-triggered automatic deletion.

## Executed checks

`npm run build` passed, including TypeScript checking. `node scripts/build-test-fixtures.mjs` completed. Independently ran:

```sh
npx vitest run tests/draft-client.test.ts tests/limited-draft.test.ts tests/session-client.test.ts tests/drafts.test.ts
```

All **4 files / 46 tests passed**, 1.98s. This includes exact acknowledgements, invalid versions, a stalled DELETE response EOF without retry, owner boundaries and existing restricted-session behavior.

An isolated Playwright config selected the five new developer deletion cases and three additional QA cases for both Desktop Chrome and iPhone 13 viewport emulation, using Chromium, the real production entry/assets, local HTTPS, synthetic signed provider replies and ephemeral D1. **16 browser cases passed**, 15.9s:

- **10 developer cases re-executed:** saved-version confirmation, keyboard entry/focus and cancellation; acknowledged deletion and preservation of another draft; concurrent saved-version update and explicit reconfirmation; committed deletion with a false acknowledgement and list absence; grant expiry/revocation during confirmation.
- **6 independent cases:** DELETE 503 preserves the unsaved buffer and requires read/rebase/new confirmation; delayed committed DELETE remains single-flight and a changed session discards the old editor without accepting its late success; 200-character saved titles wrap within the viewport and confirmation remains inside the hidden/inert private ancestor during a synthetic session-check failure, then resumes only after explicit same-session verification.

The first QA-only config selected no tests because its regexp assumed a relative test path. Correcting that selection regexp allowed the above execution; no application code or assertion was changed. Synthetic lifecycle events/session responses in the added cases are not an actual hidden-tab or real account-switch guarantee.

Six full-page local screenshots were individually inspected: confirmation, unknown result, and long-title confirmation, each on desktop/mobile viewports. Labels and target versions remain legible, actions wrap, the long target title is available in confirmation, and recovery retains the input. No clipping/overflow or inaccessible new control was found within these captures and keyboard assertions. The existing surrounding editor/session styling was preserved. Screenshots and synthetic browser traces remain local and are not added to the public repository.

Playwright's owned temporary server and child Worker completed cleanup. The fixture process was absent and no listener remained on port 8792 after execution. No unrelated server was stopped.

## Source fingerprints

SHA-256 values were matched against the shared final implementation after execution:

| File | SHA-256 |
| --- | --- |
| `src/editor/DraftEditor.tsx` | `35bd1bf35fb379be5686d2a8a7b7564c39eb8f39f66220f8b43ae73b10a53df2` |
| `src/editor/draft-client.ts` | `4332ec90c243705ee5e4fc50269c0c8b400658dbaf9a8fac4fa40ddd1ff5dbf7` |
| `src/editor/editor.css` | `f77be5c7ed8a9436b3c4f6f54e749f900ebea682c5726ee1f41714f3d386ff01` |
| `tests/draft-client.test.ts` | `956c7c7b00040ecde6f60653134c4f9bd2ffb34e124f110e7efd69d35cff9204` |
| `tests/limited-draft-browser.spec.ts` | `512e6a7290abef9b97eb1ff4093393d58381d7d68c697b9826744642e104741e` |

Additional QA-only spec fingerprint: `9bf87bd3502cf77755d4caf5280b6cc575ed7f1948658d4c667fa38e27d759cb`. It remains in the isolated local copy and is not an application dependency.

The implementation does not solve post-expiry deletion/retention, backups or logs. Those require a separate operating policy and verifiable deletion process, without extending the editor grant or weakening its checks. Merge requires the ordinary reviewed PR and green CI; this QA does not authorize a runtime policy change.
