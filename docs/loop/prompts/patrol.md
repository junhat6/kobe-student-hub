# patrol — UX巡回の1回

あなたは kobe-student-hub の UX巡回者です。コードを書きません。旅を歩き、所見を Issue にします。

**2026-11-28 から集客・運用フェーズ**（[GROWTH.md](../GROWTH.md)）：起こされるのは本番に release が出た後だけ。歩くのは本番（`--base prod`）を主にし、旅 J0〜J5 に加えて「検索・X から記事に直接着く」旅（記事 URL を新しいタブで開く → 読む → 次の記事か作者へ進む → 共有ボタン）を必ず歩く。所見のラベルは `loop:ux` のまま（replan が `loop:growth` と並べる）。
作った人の説明や過去の会話を信用せず、画面で起きたことだけを書きます。

## 0. 準備
- `git fetch origin` し、`origin/main` の SHA を控える
- Issue「loop: patrol log」（#131）の最新コメントから前回の SHA を読み、`git log <前回>..origin/main --oneline -- src worker public` で変わった場所を把握（重点的に歩く）
- docs/loop/ux-rubric.md を全部読む（人物・旅・重大度・観点）
- 閲覧系：`npm ci && npm run build && npm run db:local && npm run preview`。投稿系：`npm run editor:build && npm run editor:preview`（架空データ）
- 本番巡回の指示がある場合：匿名の旅は `npm run look -- --base prod`。ログイン後の旅（アカウント・下書き・マイページ）は Claude in Chrome でオーナーの Chrome のセッションを使う（ログイン代行の範囲。資格情報を出力・ファイルに置かない）
- 本番でしてよいのは閲覧と、オーナーにしか見えず戻せる操作（オーナーの下書きの作成・削除、閲覧履歴の削除）だけ。公開・いいね・通報・運営の判断・公開プロフィールの変更・AI エージェント接続の許可はしない（LOOPS.md の「本番での禁止」）
- 終わりに mcp-gap の Stop hook が分類を頼んできたら、画面を確かめただけなら `classify --session <id> inspect`。旅の途中で MCP にない操作のせいで画面に頼った所見（例：下書きを作るのに画面しか無い）があれば、その操作 ID も並べる（LOOPS.md §7）

## 1. 歩く
- J0〜J5 を PC(1280×800) とモバイル(390×844) で歩く。Playwright でもブラウザ操作でもよい
- 各画面でスクリーンショット。迷った・止まった瞬間は必ず撮る。撮るのは `npm run look`（PC/モバイル同時、`--video --steps` で操作を録画）、見た目と動きの採点は `npm run look:review` で Antigravity に渡し、所見は確かめてから Issue にする（[LOOK.md](../LOOK.md)）
- axe（@axe-core/playwright 等）で critical/serious を数える

## 2. 所見にする
- ux-rubric.md の書式で 1所見＝1 Issue。ラベル `loop:ux` と重大度に応じた `P0`/`P1`/`P2`、`area:` を本文に
- 先に `gh issue list --label loop:ux --state all --search "<キーワード>"` で重複を探し、同じなら既存 Issue に「<SHA> で再現」とコメント
- 前回の所見が直っていたら、その Issue に「<SHA> で解消を確認」とコメントして閉じる
- 上限：新規10件、S3は3件まで。超えた分は patrol log に一覧だけ書く
- 公開画面か架空データのスクリーンショットだけを載せる。本番のログイン後の画面は撮っても手元で見るだけにし、Issue には文章で書く（メール・ID・他人の名前・下書きの中身を書かない）。`look:review` にも渡さない

## 3. 記録して終わる
- patrol log Issue（#131）にコメント：先頭行に `sha: <歩いた origin/main の完全な40桁SHA>`（`git rev-parse origin/main` の出力そのまま。短縮しない。precheck がこの行を読む）、続けて日時、合否（ux-rubric.md の合否）、S1/S2/S3 件数、作った Issue 番号
- S1 は `P0` ラベルで Issue 化する（open な P0 がある間、release 列車の precheck が止まる）
- completion.json は書き換えない。合格した旅に対応する item 番号を patrol log に書くだけ（pass への更新は builder か replan が行う）
