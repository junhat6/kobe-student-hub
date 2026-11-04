# Local draft editor journey

Issue #32 selects a visible authoring journey after the private store and HTTP foundation: create an empty private draft, write Markdown, preview safely, save explicitly and resume. Reading already has a working sample preview and an unrun student trial; another prototype there would duplicate #5. Image publishing depends on media/operational conditions. This cycle makes the requested editing experience reviewable while keeping real login and publication closed.

## Local-only environment

The editor component is not imported by production main.tsx. A separate Vite build and localhost HTTPS Worker fixture use a distinct local database with fictional admitted accounts. The fixture injects a local test session rather than verifying a real Google account. It must never be deployed or reused for real users. Production assets, sample routes and remote database/settings are unchanged.

The local browser uses the actual private HTTP handler, SessionStore and D1 draft store. This is more than a mocked save indicator, but it is not Google integration, current-student admission, public availability, physical-device validation or student-value evidence. The UI visibly identifies itself as a local verification environment and says publication is unavailable.

## Intended writing contract

Create an empty server draft before enabling editing. Edit title and Markdown, use small formatting helpers and switch to the existing safe Markdown preview. Save is explicit; autosave is not offered. Private text is kept in component memory, not localStorage/sessionStorage or URLs.

A save captures the submitted text. Typing while it is pending must remain in the editor; a successful response marks only the captured snapshot saved. Newer typing remains dirty. A failed or uncertain save keeps the current buffer and offers a read-only view of the saved version. Only an explicit choice updates the version baseline while retaining local text; another server change still fails the next compare-and-swap. No silent merge, automatic overwrite or automatic save retry.

Switching drafts with unsaved changes requires an explicit discard decision. beforeunload is best effort, especially on mobile; this is not crash/restart recovery. An unconfirmed blank-draft creation may require checking the list; it cannot discard text because editing starts only after a known ID. The current list is20 items without pagination.

## Publication boundary and next decisions

The interface does not call a publish API or show a fake publication success. The local journey stops at private draft saving. Real authoring requires dedicated OAuth configuration, browser/session/CSRF bootstrap, actual log/cache protection, admission/graduation rules and quotas. Real publication additionally needs metadata/profile handling, private media, moderation with distinct reporters/notifications/operator decisions/appeal, and user rules. Autosave, pagination, deletion UI, image uploads and Mermaid are not silently adopted by this cycle.

Independent QA must run desktop/mobile browser cases and visually inspect app-only screenshots. Record exact source and test scope, save failures/concurrency/late responses, keyboard/overflow and safe Markdown. Emulated mobile is not a physical phone, two browser contexts are not two physical devices, and AI operation checks do not establish student demand.

## Running and evidence handling

Build with `npm run editor:build`, then `npm run editor:preview`; the dedicated local URL is `https://127.0.0.1:8788`. `npm run test:editor` launches its own isolated server and runs desktop/mobile cases. The local self-signed certificate is tolerated only in this test config; no OS trust or global TLS setting is changed. Setup applies only session/draft schemas to the separate local fixture database and seeds fictional accounts idempotently. Nothing is deployed or migrated remotely.

Real identity changes/logout must remount and clear private editor state under an explicit browser lifecycle. Retaining a buffer on a save failure in this fixed-account local test is not a completed shared-device/logout privacy design. A successful local Secure/HttpOnly cookie test does not establish Google redirect correctness, physical iPhone behavior or actual platform log secrecy.
