# Kobe Student Hub

神戸電子の学生が、記事・作品を入口に知識・経験・活動を共有するWebアプリ。学校公式サービスではありません。名称は仮称です。

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

[現在の作業と再計画](docs/WORK.md) · [検証記録](docs/EVIDENCE.md) · [独立QA](docs/QA-INDEPENDENT.md) · [デプロイ](docs/DEPLOYMENT.md) · [設計判断](docs/DECISIONS.md) · [デザイン](DESIGN.md)

## 自律開発

Planner → Developer → Independent QA → Evidence → Replanningを一巡ごとに残します。基本はmainで管理し、変更を短い作業ブランチ/PRにまとめ、CIと独立QA後にmainへ反映します。最新のユーザー指示でmainへのマージ・本番デプロイの都度承認は不要です。ただし永続権限や認証情報、有料契約など適用される確認は別です。詳細は [AGENTS.md](AGENTS.md)。

PRDの原文は変更せず、現在の仮説や判断はリポジトリ内に別記録します。公開リポジトリに学生のデータ、認証情報、問い合わせ内容を載せないでください。
