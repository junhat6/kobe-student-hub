# Limited login interruption recovery

> **撤去済み機能の履歴:** 本人限定の試用機能は撤去します。この文書の試用専用URL・コマンド・接続手順は現行の利用案内ではありません。[撤去範囲と検証](RETIRED-DRAFT-TRIAL.md)を参照してください。

## Scope

This is a local frontend reliability change for the existing limited draft trial. It does not grant access, change eligibility/session rules, enable general login or publishing, alter a database, or deploy anything. The existing unpublished production-routing work remains a separate prerequisite and is preserved unchanged.

## Behavior

- One explicit login operation has one 10-second deadline across bootstrap, command, start and both JSON bodies. A response header does not reset or clear the deadline.
- Bootstrap 409 remains valid existing-context recovery. Its unused body is cancelled without waiting for EOF or cancellation acknowledgement.
- Every request uses the same AbortSignal. Timeout and explicit cancellation reject promptly even if a fetch/stream adapter ignores abort. Each later asynchronous continuation checks whether the operation is still valid.
- JSON is limited to 16 KiB with a JSON content-type requirement and bounded chunk count. The command proof format and Google authorization origin/path remain validated. Credentials in a target URL are rejected.
- While starting, the login button is disabled and an explicit cancel button is available. The synchronous operation reference also rejects repeated clicks.
- Cancellation, pagehide, Back/Forward, hash navigation, hidden visibility and unmount invalidate the old operation. Old completions cannot issue a later step, redirect, overwrite the new operation's message or unlock a newer operation.
- Failures and timeouts unlock the button. Retrying is an explicit new click; authentication commands are never automatically retried.

A browser abort does not undo a server-side change already performed or retract a received Set-Cookie. Cancellation stops this page from consuming or navigating on the old result. This is not a server cancellation/revocation API.

## Developer verification

Run each build-dependent suite serially. `npm run build` clears dist, including locally packaged trial assets, so it must not run during the limited browser suite. The standard limited suite itself builds both the public and trial assets before starting its local server.

Commands (from the checkout):

```sh
npm run typecheck
npm run build
WRANGLER_NO_SKILLS_UPDATE_PROMPTS=true WRANGLER_SEND_METRICS=false npm test
npm run db:local
npm run test:e2e
WRANGLER_NO_SKILLS_UPDATE_PROMPTS=true WRANGLER_SEND_METRICS=false npm run deploy:check
WRANGLER_NO_SKILLS_UPDATE_PROMPTS=true WRANGLER_SEND_METRICS=false npm run test:limited
```

The per-process Wrangler environment options omit unrelated skill-update prompts and optional telemetry; no persistent configuration is changed. deploy:check is a dry-run with the existing placeholder local config, not a deployment.

Developer results: typecheck, public build and deployment dry-run passed; 70 unit/Worker files / 599 tests passed; public PC/mobile browser regression 60 passed; limited PC/mobile regression 30 passed. The new client contributes 15 unit tests and the new interruption coverage contributes 22 browser cases to the existing eight.

The interruption matrix covers all three response-header stalls, both JSON-body stalls, ignored abort/cancel with delayed release, newer explicit retry, the cumulative deadline, unused stalled bootstrap body, 409 recovery, malformed/oversized JSON, request/proof boundaries, repeated clicks, explicit cancel, pagehide/pageshow, Back/Forward and hidden visibility. Existing limited browser coverage still checks synthetic signed Google login, private save/reload/resume/logout, uncertain session recovery, session changes, expiry and revocation.

One initial browser launch was blocked by the macOS process sandbox before test bodies ran; rerunning via the approved local process execution path passed. A later screenshot run overlapped a public rebuild, which removed trial assets and yielded Not found; it was stopped and rerun serially. Neither failure was concealed or addressed by loosening assertions.

These are fictional local data and Chromium desktop/iPhone-sized viewport tests, not physical iPhone/Safari testing, a live Google login or production verification. Independent QA is a separate required step. No commit, push, PR, merge or production operation is part of this change.
