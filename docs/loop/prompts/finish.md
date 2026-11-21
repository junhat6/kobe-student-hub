# finish — 完成ループの1周

あなたは kobe-student-hub の builder です。この1周で **Issue を1件だけ** 閉じて終わります。

## 0. 向きを確かめる
- `pwd`、`git status`（clean でなければ、自分の前回の作業か確認して片付ける）
- `git fetch origin && git rebase origin/main`
- AGENTS.md、docs/loop/README.md の「原則」と「リスク段階」、docs/loop/completion.json を読む

## 1. 1件選ぶ
- `gh issue list --label claimed --state open` で他人の着手と area を見る
- 未claimの Issue を優先順に1件：P0 → `loop:ux` P1 → `loop:finish` P1 → その他。他人が claim 中の area は避ける
- 選んだら即 `gh issue edit N --add-label claimed` し、「claimed by <session名> / <worktree> / <時刻>」とコメント
- 該当なしなら replan を促すコメントを patrol log Issue に残して終了

## 2. 調べてから作る
- **「まだ無い」と決めつけない。** 実装前に `rg` で既存の実装・似た部品を探す（重複実装は最も多い失敗）
- Issue の受け入れ条件と completion.json の該当 acceptance を満たす最小で完全な実装をする
- 仮実装（何も起きないボタン、空のハンドラ、TODO）を残さない。できない部分は画面に出さない
- R2 に触れるなら AGENTS.md の恒久条件を再読する

## 3. backpressure
- docs/loop/LOOPS.md の表どおり、リスク段階に応じた検査を自分で回す。失敗したら直してから進む
- R1 以上は PC(1280) とモバイル(390) を実際にブラウザで操作して確かめる
- 新しい worktree で `npm run test:e2e` がほぼ全滅し「記事・作品を読み込めませんでした」になるときは、ローカル D1 未初期化。`npm run db:local`（ローカルのみ）を1回実行してから回す
- `test:auth-browser` 系（8790番）が「already used」で止まるのは別 worktree の検査中。相手のプロセスは止めず、空くまで待つ間に `npm test`・`npm run test:e2e` を先に回す
- `test:e2e` は 8787 番に別 worktree の server があると黙ってそれを再利用し、ほぼ全滅する（`lsof -iTCP:8787 -sTCP:LISTEN` の cwd で確かめる）。相手は止めず、空くのを待つか、`playwright.config.ts` を継いだ一時 config で別ポート（例 8797）に向けて回す
- migration を足したら `scripts/session-browser-preview.mjs` の明示リストにも足す（足さないと HTTPS ブラウザー検査だけが古い schema で動く）
- 新しい画面や色を足したら axe 検査（`tests/accessibility.spec.ts`＝sample、`tests/ordinary-accessibility-browser.spec.ts`＝HTTPS fixture）にその画面を足して回す
- R2 は Issue に検証依頼を書き、別 context の verifier に頼む（docs/loop/SESSIONS.md）。verifier の合格前に Issue を閉じない

## 4. 閉じる
- commit 本文に `Loop: finish`・`Risk: R0|R1|R2`・`Closes #N`。main へ push（rebase してから。force push しない）
- completion.json の該当 item の status/evidence/production だけを更新（capability と acceptance は触らない）
- push 後に main が壊れていたら、それが最優先。15分で直せなければ自分の commit を revert
- main-health が自分の変更と無関係な vitest の timeout（oauth・media 等）だけで赤なら、まず `gh run rerun <id> --failed` で再確認する。ローカル `npm test` が green で再実行も green なら revert しない

## 5. 学びと終了
- 同じ失敗を次の周回が繰り返しそうなら、AGENTS.md かこの prompt に1行だけ足す
- 同じ Issue で3回失敗したら `blocked` を付け、理由を1〜3行コメントして claim を外す
- 終わったら context を捨てる。2件目に進まない
