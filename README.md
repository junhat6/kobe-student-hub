# Kobe Student Hub

神戸電子の学生が、記事・作品から知識・経験・活動に出会うWebアプリです。学校公式サービスではありません。

[本番](https://hub.junhat6.com/) · [別プレビュー](https://kobe-student-hub-preview.ideaboost-whiteboard.workers.dev/)

本番の公開範囲はサンプル閲覧と、学校Googleによる登録・年度管理の導線です。投稿利用は運営設定後に有効化します。実際のGoogle往復の確認状況とリリース結果は[現在の作業](docs/WORK.md)と各PRに記録します。

## 開発

Node.js 26、npm、Gitを使用します。

```bash
npm ci
npm run types
npm run build
npm run db:local
npm run preview
```

`http://127.0.0.1:8787` を開きます。D1はローカルに作成され、クラウド認証は不要です。フロントの開発中は別端末で `npm run dev` を実行できます。

## 整形

`npm ci`でcommit hookを設定します。`npm run format`で整形し、`npm run format:check`で確認します。commit時はstagedのソースだけを整形し、部分stageの未stage変更を保持します。CIでも整形を確認します。文書・SQL・生成binding・lockfile・秘密や検証資料は対象外です。

## 検証

```bash
npm run build
npm test
npm run test:e2e
npm run test:auth-browser
npm run editor:build
npm run test:editor
npm run deploy:check
```

初回は `npx playwright install chromium` が必要です。Worker/D1とブラウザーの境界を検証します。PC・モバイルviewportでの確認は実機確認とは区別します。`test:pending-pilot` と `test:retired-trial` で旧導線の境界も確認します。

編集用の架空データ環境は `npm run editor:preview` で起動します（HTTPS、127.0.0.1:8788）。実在の個人情報を入れず、fixtureをデプロイしないでください。詳細は[ローカル編集環境](docs/EDITOR-LAB.md)を参照してください。

## 構成と作業ルール

React・TypeScript・Vite・Tailwind CSS・Base UI、Hono・Cloudflare Workers Static Assets・D1を使用します。Markdownのraw HTMLは無効です。

短いブランチとPRを使い、CIと別contextのQA後にmainへ反映します。PRD原文は変更せず、秘密・個人情報を公開リポジトリへ載せません。記録は短い進捗とPRに集約します。

[作業ルール](AGENTS.md) · [現在の作業](docs/WORK.md) · [デプロイ](docs/DEPLOYMENT.md) · [設計判断](docs/DECISIONS.md) · [デザイン](DESIGN.md)
