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

## First public-profile preparation

Issue #41 adds a separate collapsed preparation panel in this local lab: empty author-entered public fields, reader preview and explicit first-create confirmation. It does not import Google name/photo/email or change the draft editor's private buffers. The existing session bootstrap remains fictional and must never be deployed. [PUBLIC-PROFILE.md](PUBLIC-PROFILE.md) defines the private endpoint, atomic mapping, retry and unprovided update/delete/eligibility boundaries. Local schema initialization now also uses0001 and0007 from the repository in the isolated editor database; no remote or production database is touched. New profile screenshots remain local and outside CI uploads.

## First-publication confirmation lab

Issue #43 connects saved drafts and explicit profiles to an isolated first-publication confirmation and a fictional anonymous reader. See [PUBLICATION-JOURNEY.md](PUBLICATION-JOURNEY.md) for saved-version/dirty-buffer/unknown-outcome boundaries and unavailable real-service conditions. The `/lab/articles/:id` entry does not bootstrap a fictional login; it reads only record-backed published snapshots through a local fixture endpoint. No new schema or production deployment is included. All new screenshots remain local.

## Report and operator review lab

Issue #45 adds explicit reader reporting and a read-only `/lab/moderation` page. Existing0006 is initialized in the isolated editor DB. An explicit tests-only `/__fixture/operator-session` helper uses a seeded fictional operator and trusted localhost fixture allowlist; opening the operator page never auto-creates that identity. This is not a real permission grant or an actual moderation/contact service. The operating decisions and unprovided restore/appeal/notification/contact gates are in [MODERATION-JOURNEY.md](MODERATION-JOURNEY.md). No new migration or remote change is included; images remain local.

## Existing-session author lab

`/lab/account` checks an existing cookie only, offers current-token logout and coordinates a session-bound author editor/profile subtree. It does not call fixture login on initial load, logout or reload; test setup must explicitly obtain a fictional session first. This differs from the older `/` convenience fixture. [SESSION-LIFECYCLE.md](SESSION-LIFECYCLE.md) defines proof timing, hidden-memory recovery and discarded-session limits; real Google and report/operator route integration remain unprovided. No remote/schema or actual identity grant is added.

## 既存Markdown補助の範囲

見出し・コードは選択が触れる行を対象にし、太字は選択した文字を囲みます。見出しはレベル2、コードは本文内のバッククォートより長い囲みを使います。操作後も明示保存が必要です。日本語入力中は補助操作を待ち、入力の確定後に使います。囲み・リスト等のMarkdown構造を解析するリッチテキストエディターではありません。[仕様・制約](MARKDOWN-HELPERS.md)。実IMEや学生の使いやすさは未検証です。

## 公開記事から投稿者へ

ローカルの公開記事から投稿者の公開プロフィール・他の公開記事へ進めます。本人確認や下書き取得をせず、公開中の記事を公開時刻の新しい順で20件まで表示します。非公開・削除記事は新規取得から除外し、記事本文や認証情報を一覧へ付けません。一般公開sampleとは別の架空データの検証です。[範囲・限界](AUTHOR-DISCOVERY.md)。

## 新しく公開された記事を探す

/lab/discover では、架空のローカル投稿を新しい順に20件まで見つけて、記事・投稿者へ進めます。公開確認後の一覧リンクは別タブで開きます。記事がない状態と取得失敗を分け、本文や認証情報はカードへ載せません。全件検索・推薦・一般公開サービスではありません。[範囲・限界](RECENT-FEED.md)。

## Local project report intake and review

A published fictional `/lab/projects/:id` shows an initially collapsed report preparation action. It checks only an existing session after explicit preparation; accepted private reason/detail are not put into public project/author DTOs. `/lab/project-moderation` uses the existing explicit fixture operator helper and trusted localhost allowlist for read-only queue/case review; visiting the page never provisions that role. Local0010 is initialized in the isolated editor DB. Intake does not automatically hide works, notify anyone or mark a case handled. At most20 targets and20 newest reports per case are bounded views, with an explicit partial-case notice when more exist. [PROJECT-REPORT-REVIEW.md](PROJECT-REPORT-REVIEW.md) separates this technical experiment from unresolved work reporting policy and actual service. No real identity, role grant, remote migration, email or screenshot publication is involved.

## Own article/project publication records

The existing `/lab/account` author subtree shows a private combined publication record list through its stable session consumption guard. It loads at most20 records plus an explicit indication when more exist; it neither changes visibility nor infers a report cause, notice, judgment or full history. Published records can open the existing reader in a new tab without replacing editor input. Hidden/deleted records get no reader link or mutation action. [OWN-PUBLICATION-RECORDS.md](OWN-PUBLICATION-RECORDS.md) distinguishes recorded state/source version/initial publication time from current private drafts or guaranteed public delivery. Existing schema only; no production connection or actual permission is added.

## Explicit owner stop of a published snapshot

Within the existing guarded author record list, a published row can be selected for a separate explicit local stop confirmation. The selected target/source version stays separate from private saved/unsaved input. The acknowledgment/manual receipt distinguishes an own stop from a generic already-hidden state. Acknowledged stops refresh the list; unknown outcomes are not auto-retried or lost when the list changes. Local0011 is fully applied on each isolated startup; no real service/schema is changed. [PUBLICATION-STOPS.md](PUBLICATION-STOPS.md) explains the one-way prototype, unchanged report evidence and unavailable restore/delete/republication/actual delivery guarantees.


記事の読み取り専用運営画面は、フォーカス・画面切替・セッション変更・確認不能時に以前の一覧と通報詳細を閉じます。再開には明示的な既存セッション確認と新しいサーバー権限確認が必要です。実運営・実認証の有効化ではありません。境界と制約は[MODERATION-SESSION.md](MODERATION-SESSION.md)を参照してください。


既知の作品URLや投稿者がなくても、ローカルの新着作品一覧 `/lab/works` から作品・投稿者へ進めます。公開保存版を最大20件表示する試作で、実公開・全件検索・人気順ではありません。[作品探索の範囲](PROJECT-DISCOVERY.md)と検証記録を参照してください。
