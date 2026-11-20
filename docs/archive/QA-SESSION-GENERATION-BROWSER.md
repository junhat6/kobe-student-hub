# Local Chromium session generation QA

Run: `npx playwright test --config playwright.generation.config.ts`

Observed 2026-11-05: **5 passed (2.6s)** with real Chromium and HTTPS at `https://127.0.0.1:8790`.

## Boundary under test

`tests/fixtures/session-browser-worker.ts` mounts the current production `createOAuthHttpHandler` factory with its test-only enabled option and the real `SessionStore`. The production source gate remains `OAUTH_HTTP_RELEASE_ENABLED=false`; a test checks that literal source gate. No real configuration, Google account, operational secret, production database, remote migration, or deployment is used.

`scripts/session-browser-preview.mjs` bundles that fixture, starts ephemeral Miniflare/D1, applies local migrations 0001 and 0003 through 0012, and inserts two fictional active accounts. Every outbound request is intercepted in Node: Google token/JWKS responses are synthetic, fixture controls are local, and any other target throws. The test signing key is ephemeral memory only. Cookie encryption uses the published fixed 32-byte dummy key. Miniflare supplies a local development TLS certificate; Chromium ignores its trust error only in this local fixture.

The callback delay is server-side: the wrapper first awaits the real auth handler result. Only after the handler has completed session insertion and produced a Set-Cookie response does it await a Node control promise, before returning the response to the browser. Browser routing, route.fetch, synthetic cookie jars, and manual Set-Cookie application are not used. Separate pages share the same real browser context/cookie jar.

## Observed checks

- A callback completes server work and its response headers are held. B starts a newer generation and logs in from another tab. B private access succeeds. Releasing A changes Chromium's stored session cookie, proving the late header was actually accepted. Current-session and private-marker reads then return 401 and reveal no private marker. Explicit B login restores B access.
- A callback held after insertion is released after command-authorized logout. It cannot restore authenticated access. A fresh B login succeeds, and current-session CSRF logout succeeds.
- Logout in one browser context does not terminate a second independently authenticated context. Expiring retained browser contexts in local D1 makes private access return 401 and new command acquisition return 409.
- Session and browser-context cookies have HttpOnly, Secure, SameSite=Lax, host-prefix names and `/` path. `document.cookie` cannot expose them.
- Production OAuth source release gate remains closed.

## Existing account UI integration

The preview builds `tests/generation-editor/entry.tsx`, a loopback-only entry importing the unchanged real `src/editor/AccountSessionLab.tsx` and its normal clients/components. Its output is isolated in `.generation-preview`. The existing editor entry is restricted to port 8788, so this separate test entry supplies port 8790 without modifying it or application source. The fixture mounts the actual draft, profile, project, and own-publication HTTP controllers and their local schemas.

The fifth test opens B's real account UI and creates an unsaved private title. Releasing A's already-inserted session response replaces Chromium's session cookie. A manual UI session check receives 401, conceals the private panel, and removes the title input. Explicit B login is then performed in another tab through the actual auth HTTP flow. Manual rechecking exposes only the continuation button; private editing remains hidden until that button is clicked. The old unsaved input does not return, and local/session storage remain empty.

## Scope limits

The landing page and `/fixture/private` authenticated marker are test-only. The account page is the actual existing AccountSessionLab, not a replacement UI. The fixture does not activate the production release gate, change application source, or exercise every private repository final SQL guard; separate repository coverage remains necessary. Login is explicitly driven by browser QA through the real auth endpoints because the account lab deliberately contains no login UI.

The sandbox initially denied loopback binding (`listen EPERM 127.0.0.1`); an approved escalated local test run completed successfully. Miniflare logged local `CertificateUnknown` handshake probes while the configured ignoreHTTPSErrors Chromium checks passed.

## Final frozen-source verdict

Final rerun after the parent source freeze: **5/5 Chromium checks passed**, `npx tsc --noEmit` passed. Suitable for gated-main integration from this browser QA boundary; this is **not authentication release approval**. Production authentication remains source-disabled. No real Google integration, production secrets, production D1, remote migration, or deployment was exercised.

The final run initially exposed a fixture startup race: the landing page was reachable before local migrations finished. The fixture now exposes `/__control/health`, returning 503 until schemas and fictional accounts are ready, and Playwright waits there. The final successful run required no test retries and no application changes.

`QA-SESSION-GENERATION-BROWSER.sha256` records SHA-256 fingerprints of the frozen worker source, editor UI source/styles, local migrations, browser fixture/config/spec/entry, synthetic Google helper, and dependency manifests. These fingerprint the execution input, not a claim of line-by-line review of every listed file. This browser check complements the parent’s independent repository, migration, full-unit, public/editor, and dry-run checks.

Final schema follow-up: reran all five Chromium checks after migration 0012 changed the session attempt foreign key to `ON DELETE SET NULL`; **5 passed (2.6s)**. Refreshed the full fingerprint manifest. Attempt-cleanup SQL regression coverage belongs to the separate migration QA.

Final runtime follow-up: reran the five Chromium checks after `OAuthAttemptStore.cleanupExpired` switched to `DELETE RETURNING` row counting; **5 passed (2.6s)**. Refreshed all manifest entries to the final runtime source. Cleanup count regressions remain covered by the independent migration/unit suites.
