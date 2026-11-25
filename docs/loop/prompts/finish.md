# finish — 完成ループの1周

あなたは kobe-student-hub の builder です。この1周で **Issue を1件だけ** 閉じて終わります。

## 0. 向きを確かめる
- `pwd`、`git status`（clean でなければ、自分の前回の作業か確認して片付ける）
- `git fetch origin && git rebase origin/main`
- AGENTS.md、docs/loop/README.md の「原則」と「リスク段階」、docs/loop/completion.json を読む

## 1. 1件選ぶ
- `gh issue list --label claimed --state open` で他人の着手と area を見る
- 未claimの Issue を優先順に1件：P0 → `loop:ux` P1 → `loop:finish` P1 → その他。他人が claim 中の area は避ける
- 本番のオーナーログイン代行が要る Issue（#247 など）は、claim の前に Claude in Chrome の `list_connected_browsers` で接続を確かめる。0件なら OAuth の許可画面を通せないので選ばない
- claim から数時間コメントも commit も無く、その worktree に動いているプロセス（`lsof -d cwd`）も Orca の端末も無ければ、止まった claim として引き継いでよい。引き継ぐと Issue にコメントし、相手の未 commit の差分（`git diff`）を土台にする（run-229 が run-225 の #286 を引き継いだ）
- 選んだら即 `gh issue edit N --add-label claimed` し、「claimed by <session名> / <worktree> / <時刻>」とコメント
- 該当なしなら replan を促すコメントを patrol log Issue に残して終了

## 2. 調べてから作る
- **「まだ無い」と決めつけない。** 実装前に `rg` で既存の実装・似た部品を探す（重複実装は最も多い失敗）
- Issue の受け入れ条件と completion.json の該当 acceptance を満たす最小で完全な実装をする
- 仮実装（何も起きないボタン、空のハンドラ、TODO）を残さない。できない部分は画面に出さない
- R2 に触れるなら AGENTS.md の恒久条件を再読する
- `mcp-gap` の Issue（公式 MCP 以外の経路で行われた操作を MCP に足す）は、worker/agent/http.ts に C21 と同じ型でツールを足す（本人の接続・在籍・所有者を最後の SQL で確かめる、公開 DTO だけ返す、入力は決めた型と上限だけ、初めての公開・削除の手段は置かない）。終わったら docs/loop/mcp-coverage.json のその操作を `class: "mcp"`・`tool` にして `tests/mcp-coverage.test.ts` を通し、C21 acceptance 4 への追記を Issue のコメントで replan に頼む

## 3. backpressure
- docs/loop/LOOPS.md の表どおり、リスク段階に応じた検査を自分で回す。失敗したら直してから進む
- R1 以上は PC(1280) とモバイル(390) を実際にブラウザで操作して確かめる
- 新しい worktree で `npm run test:e2e` がほぼ全滅し「記事・作品を読み込めませんでした」になるときは、ローカル D1 未初期化。`npm run db:local`（ローカルのみ）を1回実行してから回す
- `test:auth-browser` 系（8790番）が「already used」で止まるのは別 worktree の検査中。相手のプロセスは止めず、空くまで待つ間に `npm test`・`npm run test:e2e` を先に回す
- `test:auth-browser` が百件以上まとめて 100ms 未満で落ちたら、途中で別 worktree に 8790 を取られた可能性が高い（run-211 は 127 件）。実装の失敗と数えず、空いてから `--last-failed` か全件で回し直す
- 8790 の空き待ちを sandbox の中の `lsof`・`kill -0`・`pgrep` で回すと、別 worktree のプロセスが見えずに「空いた」と誤って即終わる。ポートやプロセスの確認は sandbox の外で行うか、`playwright` を回して「already used」が出なくなるまで再試行する
- `test:e2e` は 8787 番に別 worktree の server があると黙ってそれを再利用し、ほぼ全滅する（`lsof -iTCP:8787 -sTCP:LISTEN` の cwd で確かめる）。相手は止めず、空くのを待つか、`playwright.config.ts` を継いだ一時 config で別ポート（例 8797）に向けて回す
- その一時 config の webServer は `npm run preview -- --port 8797` にしない（preview が `--port 8787` を持つので「--port expects a single value」で起動しない）。`npx wrangler dev --ip 127.0.0.1 --port 8797 --assets .wrangler/sample-browser-assets` を直接書く
- `test:auth-browser` を 8790 以外のポートへ置き換えて回すと、project 通報しきい値1件は変更前の版でも落ちる（ポート固有）。比べるときは変更前の版も同じポートで回す（publication の通報3件はポートではなく、記事ページの `/api/private/` 読み取りが spec の許可リストから漏れていたため。#237）
- 画面に `/api/private/` の読み取りを足したら `tests/ordinary-publication-browser.spec.ts` の `openReport` の許可リストも見直す（足さないと通報3件が release CI で落ちる）
- migration を足したら `scripts/session-browser-preview.mjs` の明示リストにも足す（足さないと HTTPS ブラウザー検査だけが古い schema で動く）
- migration の番号は並行セッションと重なることがある（#275 と #277 が同時に 0042）。push 前の rebase で `migrations/` と両 preview スクリプトの明示リストを見て、重なったら自分の方を繰り下げ、コメント・テストの番号も合わせる
- 新しい表を読む SQL は `scripts/editor-preview.mjs` の明示リストにもその migration が要る（無いと editor 系 spec だけ 404 で落ちる。0026 は表だけ作り自動非公開 trigger を外している）
- vitest を1ファイルだけ回すときは、先に `npm run build`（dist）と `npx wrangler deploy --dry-run --outdir .worker && node scripts/build-test-fixtures.mjs` が要る（無いと全件 skipped で「.worker/…-test.js が無い」。worker を変えたら毎回やり直す）
- `npm run test:editor` は先に `npm run editor:build` が要る（無いと「assets.directory … .editor-preview does not exist」で起動しない）
- 認証つきの新しい Store を足したら `tests/auth-guard-inventory.test.ts` の inventory と件数を更新する。SQL はクラスのメソッド内に置く（クラス外の関数は「outside method」で落ちる）
- 新しい画面や色を足したら axe 検査（`tests/accessibility.spec.ts`＝sample、`tests/ordinary-accessibility-browser.spec.ts`＝HTTPS fixture）にその画面を足して回す
- Base UI の Popover・Menu を開いた状態で axe を当てるときは、popup の `opacity` が 1 になるのを待ち（フェードイン前に色を拾い color-contrast が時々落ちる）、`[data-base-ui-focus-guard]` だけ除外する（#232）
- テストから Python を importlib で読み込むときは `exec_module` の前に `sys.modules[...]` へ登録する（CI の Python では `@dataclass` が AttributeError で落ち、手元の新しい Python では通ってしまう）
- 「形を足すほど verifier が新しい形を見つける」仕事（毎回違う理由で不合格）は、2回不合格の時点で実装を足すのをやめ、条件・設計の見直しを Issue に提案して `blocked` にする（#214 は秘密の形の後追いで3回不合格。考え方は docs/loop/DESIGN-PRINCIPLES.md の原則3）
- auth-browser が CI だけで赤く手元で再現しないときは、`gh workflow run ci.yml --ref main` で回し、artifact browser-evidence の `test-results-generation/` の trace（error-context.md と .network）を見る（#208 は通信の中断が原因で、順序依存ではなかった）
- セッション期限切れの spec は、画面の初回読み込み（一覧の GET など）の応答を待ってから `/__control/expire` を呼ぶ（欄が編集できても読み込みは途中で、遅い CI では先に期限切れを見つけて空のフォームを閉じる。#192）
- 数千行の fixture を D1 に直接入れるテストは、後始末で R2 を1行ずつ消さない（object の無い行まで消しに行き、CI だけ 30 秒を超えて後始末が切れ、次の R2 テストまで連鎖で落ちる。#195）
- `/api/private/` の1つの読み取りだけを失敗させる spec は `route.abort()` でなく HTTP 503 を返す（abort は画面全体のセッション確認の失敗に倒れ、画面の「もう一度」まで届かない。#229）
- blur で確定して見た目が増える入力（チップ等）は、下の要素を押し下げない並びにする（押し下げると、blur を起こしたクリックの的がずれて click が消え、別の欄の spec がまとめてタイムアウトする。#231）
- D1 は `recursive_triggers=0` で、`INSERT OR REPLACE` の暗黙削除には DELETE trigger が効かない（行を守るなら同じ key の INSERT も trigger で拒む）。Markdown に値を文字どおり出すならエスケープでなく code span にする（GFM の自動リンクは text node 上で探すので `\:`・`&#58;` でもリンクになる。#177）
- Base UI の Menu の項目から Dialog を開く spec は、`.report-menu-popup` 等の popup が DOM から消えるのを待ってから axe を当てる（modal が外を aria-hidden にするので `getByRole('menu')` は即0件になるが、フェードアウト中の項目を axe が拾い color-contrast で落ちる。#228）
- 作品の公開行（project_publications）を fixture で直接書き換えるテストは `tests/helpers/project-snapshot.ts` の `withProjectSnapshotUnlocked` で包む（0038 が status 以外の列の UPDATE を ABORT にする。#257）
- 公開パネルの `<summary>` の中に要素（span 等）を足さない（#190 の見出し1行判定が flex の子の箱で2行と数えて通報系 spec がまとめて落ちる。補足は summary の外に出す。#201）
- 大きな BLOB を持つ表（media_assets 等）に ALTER で足した列は BLOB の後ろに置かれ、表から読むと overflow page を辿る。全行を SUM/scan する quota 等は covering index から読む（c749c93 は CI だけ fetch failed で落ちた。#260）
- 未 commit の変更があるファイルに mutation を当てた後、`git checkout <file>` で戻さない（自分の変更ごと消える）。mutation の前に一時 commit するか、変えた1行だけ sed で戻す
- mutation の退避先に `/tmp/<固定名>` を使わない（sandbox で cp が失敗し、別セッションが残した同名ファイルで自分のソースが上書きされた。run-200）。一時 commit して `git checkout -- <file>` で戻す
- セッションの `created_at_ms`・`last_seen_ms` は `SESSION_CLOCK_SKEW_MS`（5秒）まで時計の遅れを許す（同時リクエストの isolate 間の時計差で別パネルが落ちた。#268）。巻き戻しを試すテストは `NOW - SESSION_CLOCK_SKEW_MS - 1` 以下を使い、期限（idle・absolute・context）は許容なしのまま保つ
- SPA の画面遷移の後に `page.goBack()` を検査するときは、遷移先の描画（前の画面の要素が0件）を待ってから戻る（待たないと前の画面が unmount 前に残り、状態が保たれたように見えて CI だけ落ちる。#266）
- 時計差の許容を足すときは、行の比較だけでなく封をした cookie の iat も見る（login は form_post なので attempt の cookie と return cookie の2枚。jose の clockTolerance は exp・maxTokenAge も緩めるので、期限は明示の判定で厳格に保つ。#282）
- playwright が途中から「browserType.launch: Executable doesn't exist …chromium_headless_shell-NNNN」で全滅したら、別 worktree が古い版の install で共有 cache を消したもの。`npx playwright install chromium chromium-headless-shell` で戻し `--last-failed` で回し直す（実装の失敗と数えない）
- 表を作り直す migration（CHECK の変更など）は、他の表の trigger が本文でその表を読んでいると D1 が RENAME を止める（「error in trigger … no such table」）。その trigger を同じ batch で DROP し同じ文で作り直す。`auth_sessions` を変えたら、0004＋0012 を手で並べる fixture（`tests/helpers/order-schema.ts`・`coordinated-fixture.ts` と各 test の一覧）にも当てる（#269）
- 他の表から外部キーで参照される表（media_assets 等）を作り直すときは、DROP＋RENAME にしない（`defer_foreign_keys` でも commit で FK 違反になる）。退避表へ写す→DROP→同じ名前で作り直す→写し戻す、の順にし、テストは `db.batch` で1 transaction として当てる（0045、#12）
- 自分の push だけで main-health が赤く手元で再現しないときは、`gh workflow run ci.yml --ref tmp/<名前>` で一時ブランチの版を並べて切り分ける（main-health は concurrency が全体で1つなので、一時ブランチで回すと main の検査を取り消す）。#277 は無関係に見える profile-reports が、テストが増えた負荷で崩れていた
- サーバーが確かめてから状態が変わるチェックボックスは、spec で `check()` を使わず `click()` の後に `toBeChecked()` を待つ（`check()` は即時に変わらないと「did not change its state」で落ちる。#273）
- 上限（bytes・Content-Length・宣言長）のテストは、有効な DTO の本文で境界ちょうどが通り±1で落ちる形にする（不正な DTO で当てると別の理由で落ち、上限を緩める mutation が生き残る。#189 12段目）
- mutation・前後比較をシェルの loop で回すときは `bash -c` の中で回す（zsh は `$F` のファイル一覧を分割せず、vitest が0件で黙って終わり「落ちない＝通った」と誤読しかけた。run-228）。既存テストの末尾に足す経路テストは、前のケースが session を失効させるので新しいアカウントとセッションを作る
- vitest が `TypeError: Body is unusable: Body has already been read`（undici、テスト側の `res.arrayBuffer()`／`text()`）で1件だけ落ちるのは負荷による揺れ（run-232 で media・project-moderation に1回ずつ、どちらも再実行で green）。実装の失敗と数えず、`--failed` で回し直す
- R2 は Issue に検証依頼を書き、別 context の verifier に頼む（docs/loop/SESSIONS.md）。verifier の合格前に Issue を閉じない
- 検証依頼を書いたら、同じ周回で Agent tool の別 context verifier を起動して結果まで見届ける（書くだけで終えると誰も検証せず Issue が止まる。#269）。指摘を直したら毎回新しい verifier で再確認する

## 4. 閉じる
- commit 本文に `Loop: finish`・`Risk: R0|R1|R2`・`Closes #N`（R2 の実装 commit は `Refs #N` にして push し、verifier 合格後の commit か手で閉じる。`Closes` だと push と同時に閉じる）。main へ push（rebase してから。force push しない）
- completion.json の該当 item の status/evidence/production だけを更新（capability と acceptance は触らない）
- push 後に main が壊れていたら、それが最優先。15分で直せなければ自分の commit を revert
- main-health が自分の変更と無関係な vitest の timeout（oauth・media 等）だけで赤なら、まず `gh run rerun <id> --failed` で再確認する。ローカル `npm test` が green で再実行も green なら revert しない

## 5. 学びと終了
- 同じ失敗を次の周回が繰り返しそうなら、AGENTS.md かこの prompt に1行だけ足す
- 同じ Issue で3回失敗したら `blocked` を付け、理由を1〜3行コメントして claim を外す
- 終わったら context を捨てる。2件目に進まない
