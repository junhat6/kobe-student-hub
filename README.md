# Kobe Student Hub

神戸電子の学生が、記事・作品を入口に知識・経験・活動を共有するWebアプリ。学校公式サービスではありません。名称は仮称です。

[公開プレビュー](https://kobe-student-hub-preview.ideaboost-whiteboard.workers.dev/)

**現在は架空サンプルの閲覧用の開発プレビューです。実サービスの公開・学生の募集は未実施。** 一覧、検索・タグ、記事と作品の詳細、想定読者・前提知識、投稿者プロフィール、関連記事を実装しました。ログイン・投稿・下書き・いいね・履歴・メディア・通報は未提供です。

## 開発

Node.js 26、npm、Gitを使用します。

```bash
npm ci
npm run types
npm run build
npm run db:local
npm run preview
```

`http://127.0.0.1:8787` を開きます。D1はローカルに作成され、クラウド認証は不要です。フロントの開発中は別端末で `npm run dev` を実行できます（APIは8787へ転送）。

```bash
npm test
npm run test:e2e
npm run deploy:check
```

初回E2Eには `npx playwright install chromium` が必要です。`npm test` は先に `npm run build` を実行してください。Worker実行・D1境界テストを含みます。E2EはChromiumのPCとiPhone相当画面で実行し、実iPhone/Safariの確認とは区別します。

## 構成

React + TypeScript + Vite、Tailwind CSS v4、Base UI、Hono、Cloudflare Workers Static Assets + D1。Markdownはreact-markdownでHTMLを無効化し、コード強調を行います。初期段階では画像・埋め込みを受け付けません。

[初回公開の残条件](docs/FIRST-RELEASE.md) · [現在の作業と再計画](docs/WORK.md) · [検証記録](docs/EVIDENCE.md) · [独立QA](docs/QA-INDEPENDENT.md) · [デプロイ](docs/DEPLOYMENT.md) · [設計判断](docs/DECISIONS.md) · [デザイン](DESIGN.md)

## 自律開発

Planner → Developer → Independent QA → Evidence → Replanningを一巡ごとに残します。基本はmainで管理し、変更を短い作業ブランチ/PRにまとめ、CIと独立QA後にmainへ反映します。最新のユーザー指示でmainへのマージ・本番デプロイの都度承認は不要です。ただし永続権限や認証情報、有料契約など適用される確認は別です。詳細は [AGENTS.md](AGENTS.md)。

PRDの原文は変更せず、現在の仮説や判断はリポジトリ内に別記録します。公開リポジトリに学生のデータ、認証情報、問い合わせ内容を載せないでください。

## ローカル専用の編集検証

公開プレビューには編集機能を接続していません。架空アカウントで下書きの編集・プレビュー・明示保存・競合復帰と、本人入力による公開プロフィールの初回確認を試す専用環境です。プロフィールを作るだけでは記事は公開されません。保存版を確認して初回投稿し、架空記事の読者表示を開くローカル導線も検証できます。通報受付・3人での一時非公開・架空運営者による内容確認もローカルで検証できます。既存の架空セッションだけを使う `/lab/account` では、著者画面のログアウト・切り替え・遅い応答の分離も検証できます。既存の見出し・太字・コード補助も、選択箇所からプレビュー・保存までローカルで確認できます。公開記事から投稿者とその人の他の公開記事へ進む導線も、ローカル内で検証できます。`/lab/discover` では新しく公開された架空記事を見つけ、記事・投稿者へ進めます。記事なしの作品登録も、作品名・文章の説明・任意のGitHub／デモURLの私的保存から、保存版の明示公開・匿名作品表示・投稿者の作品一覧までローカルで検証できます。作品の通報受付・本人の受付確認と、限定した架空運営者の読取専用確認もローカル試作です。作品は受付のみで、自動非公開・通知・運営判断は行いません。自分の記事・作品の公開記録と保存上の公開状態も、本人だけがローカルで確認できます。公開時の保存版を示し、非公開理由や運営判断は推測しません。選択した公開保存版を本人が公開停止するローカル試作もあり、本文・下書き消去や再公開の機能ではありません。画像・関連記事連携・公開後編集は未接続です。記事への公開いいね・取り消しと、匿名の公開いいね一覧もローカルで検証できます。公開される操作だと明示し、既存の架空セッションと本人が作成した公開プロフィールだけを使います。実際の学校ログインやインターネットへの投稿・いいね、運営通知・問い合わせ送信は有効化していません。

```bash
npm run editor:build
npm run editor:preview
# 別ターミナルで
npm run test:editor
```

URLは `https://127.0.0.1:8788`。自己署名証明書を使い、ブラウザ自動テストだけがこのローカル環境のHTTPSエラーを無視します。OSの証明書信頼設定は変更しません。専用DBは `.wrangler/editor-state` のローカルデータだけで、既存プレビューDBとは別です。実在の個人情報や学校アカウントを入れず、fixtureをデプロイしないでください。[範囲・未提供事項](docs/EDITOR-LAB.md)。

ローカルいいねの範囲・未決条件は [ARTICLE-LIKES.md](docs/ARTICLE-LIKES.md) を参照してください。

独立作品の範囲・未決条件は [STANDALONE-PROJECTS.md](docs/STANDALONE-PROJECTS.md) を参照してください。

作品のローカル通報受付と未決条件は [PROJECT-REPORT-REVIEW.md](docs/PROJECT-REPORT-REVIEW.md) を参照してください。

本人の公開記録の範囲は [OWN-PUBLICATION-RECORDS.md](docs/OWN-PUBLICATION-RECORDS.md) を参照してください。

本人のローカル公開停止と制約は [PUBLICATION-STOPS.md](docs/PUBLICATION-STOPS.md) を参照してください。


記事の読み取り専用運営画面は、フォーカス・画面切替・セッション変更・確認不能時に以前の一覧と通報詳細を閉じます。再開には明示的な既存セッション確認と新しいサーバー権限確認が必要です。実運営・実認証の有効化ではありません。境界と制約は[MODERATION-SESSION.md](docs/MODERATION-SESSION.md)を参照してください。


既知の作品URLや投稿者がなくても、ローカルの新着作品一覧 `/lab/works` から作品・投稿者へ進めます。公開保存版を最大20件表示する試作で、実公開・全件検索・人気順ではありません。[作品探索の範囲](docs/PROJECT-DISCOVERY.md)と検証記録を参照してください。


作品の保存一覧は、一覧取得時の記録に、その後確定した保存・読取の版情報を反映します。未保存の入力や公開保存版は別に保持し、保存結果不明を成功扱いにしません。[保存一覧の範囲](docs/PROJECT-LIST.md)を参照してください。


初回の資格確認待ち登録は、署名検証からpending受付までのローカルserver-only試験です。通常のactiveアカウント向けログインと分離し、実際の登録・認証は有効にしません。[初回申請の境界](docs/PENDING-REGISTRATION.md)を参照してください。

認証HTTPの接続準備は、production entryの無効ゲートを維持したローカル試験です。設定値の投入だけではログインを開放せず、公開サンプルと書込み停止を維持します。[HTTPとsecret bindingの設計](docs/OAUTH-HTTP.md)を参照してください。
