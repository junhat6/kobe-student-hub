# Draft session visibility recovery

A delayed same-session inspection could previously reveal the private editor after its tab had become hidden. The shared `AccountSessionLab` now requires a visible, active page before starting or consuming an inspection and before revealing the panel. Hidden visibility and pagehide conceal synchronously and invalidate/abort the inspection generation without deleting the editor's unsaved buffer. Returning starts a fresh proof, including an interrupted initial inspection or explicit continuation. Stale success, failure and finally handlers cannot unlock a newer proof. Pagehide remains a separate boundary even if visibility has not changed yet.

Confirmed invalid or changed sessions and logout still discard the previous editor. An unknown network result keeps it concealed until a valid same-session check. Lifecycle changes during logout do not cancel its acknowledgement or start another inspection; logout uncertainty still requires manual recovery. Abort is a UI cancellation, not rollback of a request already committed on the server.

## Verification approach

`tests/editor-session-lifecycle.spec.ts` adds delayed success/401/503 delivery, rapid hide/return before response completion, repeated pagehide/pageshow, initial inspection before a token exists, interrupted explicit continuation, and logout success/uncertainty across leaving/return. It asserts panel hidden/inert, unsaved value and instance retention, fresh-proof waiting, and destruction on logout. Existing session and limited-trial tests cover unknown network, changed/invalid sessions, save/reload/resume, expiry and revocation.

Synthetic lifecycle cases explicitly override document visibility or dispatch PageTransitionEvent. A separate actual-tab regression launches a temporary isolated Chromium and connects with `noDefaults:true`, avoiding the normal Playwright focus override that otherwise makes background pages report visible. It performs real tab activation without overriding document visibility, asserts the actual background state, releases the old response, then requires a fresh foreground proof. It runs once per suite, rather than duplicating an identical desktop browser in the mobile project. `PRIVACY_HEADED=1` selects a headed local run; CI uses isolated headless Chromium. Neither is physical-device testing.

All fixture identities, drafts and provider responses are fictional and local. No live account, Google login, production database read/write, permission/expiry/configuration change or public-posting probe belongs to these tests. Browser images and private runtime settings are not part of this document or the PR. OS thumbnails/compositor memory erasure, real Safari/iPhone and actual persisted BFCache restoration are not guaranteed by these checks.

## Results

Separate-context independent QA passed 11 browser cases: five additional lifecycle/session scenarios on desktop/mobile viewports and one actual-tab headless regression. The duplicate actual-tab mobile entry is intentionally skipped. The reviewed component SHA256 was `e0604a239cea7acd8c97d662acbe989b368c7797476b56fc64fb0a6c351e0964`. Final aggregate checks and release status are recorded with the reviewed PR. The existing general-authentication and publication gates, server ownership checks, trial grant, expiry and session duration are unchanged by this frontend correction.
