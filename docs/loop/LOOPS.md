# ループの仕様

[README](README.md) の思想を、実際に回す7つのループと内側の backpressure ループに落としたものです。
起動の仕組み（Orca automation・hook・スクリプト）は loop-infra セッションが実装します。ここでは「何を・いつ・どこまで」を定めます。

## 共通の約束

### 待ち行列は GitHub Issues

| ラベル | 意味 |
| --- | --- |
| `loop:finish` | 完成台帳の未達項目を埋める仕事（再計画ループが作る） |
| `loop:ux` | UX巡回の所見（巡回ループが作る） |
| `loop:garden` | 文書・依存・死にコードの整理（庭仕事ループが作る、または自分で直す） |
| `P0` `P1` `P2` | 優先度。P0＝本番で利用者が詰まる／境界の破れ |
| `R2` | 境界に触る（[リスク段階](README.md#リスク段階検証の重さ)）。独立検証が要る |
| `claimed` | 誰かが着手中。着手コメントに session名・worktree・開始時刻を書く |
| `blocked` | 3周失敗、または前提待ち。理由をコメントに1〜3行 |
| `needs-human` | R3（人の判断）。[人の待ち行列](#人の待ち行列) |

**なぜ Issues か**：Ralph ループの元祖は1枚の `IMPLEMENTATION_PLAN.md` を共有の待ち行列にしますが、このプロジェクトは複数セッションが同時に動くため、1ファイルは衝突の源になります。Issues なら着手（claim）・コメント・クローズがファイル衝突なしで行えます。
**注意**：このリポジトリは公開です。Issue に個人情報・秘密・非公開の利用者フィードバックを書かない。AIの巡回所見と公開画面のスクリーンショットは可。

### 周回の型（全ループ共通）

1. **向きを確かめる**：`git fetch && git rebase origin/main`、[completion.json](completion.json)・対象Issue・`git log --oneline -20` を読む。
2. **1つだけ選ぶ**：自分のループの待ち行列から、優先度順に未claimの1件。選んだら即 `claimed`。
3. **やる**：段階に応じた backpressure を回す（下記）。
4. **閉じる**：main へ commit/push、Issue を閉じる（commit本文に `Closes #N`）、台帳の該当項目を更新。
5. **学びを残す**：同じ失敗を防ぐ1行があれば AGENTS.md か該当 prompt に足す。なければ何もしない。
6. **終わる**：context を捨てて次の周回へ。会話を引き延ばして2件目を始めない。

### commit の書き方（ループの計測に使う）

```text
fix(ux): 検索0件のときに次の行動を示す

<何を変え、なぜか。2〜5行>

Loop: finish            # finish / patrol / garden / replan / release / human
Risk: R0                # R0〜R2
Closes #142
```

`Loop:` と `Risk:` の trailer を `git log` で集計すれば、ループごとの処理量・リスク配分・本番への到達時間が追えます。別の記録ファイルは作りません（全員が追記する1ファイルは rebase 衝突の源になるため）。

### backpressure（内側の速いループ）

編集のたびに、最短で落ちる検査から回します。Huntley の言う「車輪を速く回す」：遅い検査ほど試行回数が減り、ループが賢くならない。

| 段階 | main へ push する前に自分で回すもの |
| --- | --- |
| R0 | `npm run format:check`（staged hookが整形）、`npm run build`、変更箇所に近い `vitest`/`playwright` の該当spec |
| R1 | 上記＋`npm test`＋`npm run test:e2e`＋ブラウザで PC(1280) とモバイル(390) を自分で操作（撮って見る手順は [LOOK.md](LOOK.md)） |
| R2 | 上記＋`npm run test:auth-browser`／`test:editor` の該当系統＋**別contextの独立検証**（[SESSIONS.md](SESSIONS.md#独立検証の頼み方)） |

full CI は `npm run release` の昇格時に必ず回ります。push 前に全系統を回さなくてよい代わりに、**main を壊したら最優先で直す**（壊した人が直す。15分で直せなければ revert）。壊したことは main への push ごとに走る軽い CI `main-health` が数分で知らせ、本人が直さなければ [mend ループ](#0-修理ループ-mendアンドン) が直します。

### 止まり方

- 同じ Issue で3周失敗 → `blocked` を付けて理由を書き、次の Issue へ。毎回違う理由で落ちるなら2回で止め、実装でなく条件・設計の見直しを提案する（[DESIGN-PRINCIPLES.md](DESIGN-PRINCIPLES.md) の原則3）。
- 待ち行列が空 → 再計画ループを1回起動して終わる。
- 人の判断が要る → `needs-human` を付けて次へ。待たない。
- 1回の automation 起動で扱うのは1件（finish）／所見10件まで（patrol）。暴走とコストの上限を兼ねる。

---

## 0. 修理ループ (mend，アンドン)

トヨタ生産方式の「アンドン」：ラインの異常は、見つけた人が止めて直すまで先へ進まない。main が壊れたまま上に積むと、全セッションの backpressure が嘘をつき始めるため、他のどの仕事よりも先に直します。

| 項目 | 内容 |
| --- | --- |
| 担当 | 壊した本人。直さないまま離れたら Orca automation `ksh mend` |
| 起動 | **毎時**（precheck つき） |
| precheck | `node scripts/loop/precheck.mjs mend`：main の最新 `main-health` が失敗 |
| やること | 失敗した検査を再現 → 原因の commit を特定 → 15分で直せれば直す、無理なら原因 commit を `git revert` して push（`Loop: mend`） |
| 出力 | main-health が green に戻ること。revert した場合は元の Issue を開き直して理由をコメント |

## 1. 完成ループ (finish)

完成台帳と現実の差分を、1周1 Issue で埋めていく主力ループ。Ralph ループの building モード、Anthropic の coding agent に相当。

| 項目 | 内容 |
| --- | --- |
| 担当 | builder レーン（1〜3並行。[SESSIONS.md](SESSIONS.md)） |
| 起動 | 常駐セッションは周回を連続で回す。Orca automation では **30分ごと** |
| precheck | 未claimの `loop:finish` / `loop:ux`（P0/P1）が1件以上ある。かつ自分のworktreeが clean。なければ何もせず終了 |
| 入力 | Issue 1件、completion.json、ux-rubric.md（UX Issueの場合） |
| 出力 | main への commit、Issue のクローズ、completion.json の `status`/`evidence` 更新 |
| 指示書 | [prompts/finish.md](prompts/finish.md) |

選び方の優先順：P0（種別問わず）→ `loop:ux` P1 → `loop:finish` P1 → その他。UXの重大所見を機能追加より先に直すのは、作りかけの機能を増やすより使える導線を守るほうが完成に近いからです。

禁止：仮実装（押しても何も起きないボタン、TODOの空関数）で台帳を `pass` にすること。Huntley が指摘した「エージェントは最小・仮の実装に寄る」偏りへの対策です。未完成なら画面から出さない（DESIGN.md の「未実装機能を動くように見せない」）。

## 2. UX巡回ループ (patrol)

作った人とは別の context が、利用者の旅を実際にブラウザで歩き、採点し、所見を Issue にする。Anthropic の planner/generator/evaluator 構成の evaluator に相当します。

| 項目 | 内容 |
| --- | --- |
| 担当 | 毎回まっさらな patrol セッション（builder と兼ねない） |
| 起動 | Orca automation `patrol`：**3時間ごと**、および release 直後に本番に対して1回 |
| precheck | 前回巡回したSHA以降に `src/` `worker/` `public/` の変更がある（`git log <前回SHA>..origin/main -- src worker public` が空でない）。release直後の本番巡回は常に実行 |
| 前回SHAの置き場 | ラベル `patrol-log` の固定 Issue「loop: patrol log」へのコメント（先頭行に `sha: <40桁>`、日時・合否・所見数）。ファイルにしない |
| 環境 | 投稿系の旅：ローカル `npm run editor:preview`（架空データ・架空アカウント）。閲覧系の旅：ローカル preview と本番（匿名）。ログイン後の旅：本番でオーナーのアカウント（ログイン代行の範囲、オーナーの Chrome） |
| 入力 | [ux-rubric.md](ux-rubric.md) の旅と採点基準 |
| 出力 | 所見ごとの `loop:ux` Issue（重複は既存Issueへコメント）、patrol log へのコメント |
| 指示書 | [prompts/patrol.md](prompts/patrol.md) |

上限：1回の巡回で新規 Issue は10件まで、S3（好み）は3件まで。所見の洪水で builder の待ち行列が埋まるのを防ぎます。

本番でしてよいこと（2026-11-23 オーナー決定、[DECISIONS](../DECISIONS.md) 2026-11-23「本番の巡回でログインしてよい」）：匿名の閲覧と、オーナーのアカウントでログインしての閲覧。オーナー本人にしか見えず戻せる操作（オーナーの下書きの作成・編集・削除・取り込み、閲覧履歴の削除）。

本番での禁止：他の利用者に見える・届く操作（公開・いいね・通報・運営の判断・公開プロフィールの変更）、オーナー以外のアカウントでのログイン。AI エージェント接続の許可（MCP のトークン発行）は[資格情報の発行](#資格情報の発行)の決まりで行い、確かめ終えたら取り消す。資格情報をファイル・コマンド・出力に置かない。ログイン後の画面のスクリーンショットは手元で見るだけにし、公開 Issue・CI artifact・`look:review`（外部）に渡さない。実利用者の非公開データ（運営画面の通報など）は確かめる必要があるときだけ開き、所見にはメール・ID・他人の名前・下書きの中身を書かない。

採点が甘くなる問題への対策：
- 合否は「旅が最後まで行けたか」と「S1/S2があるか」の閾値で決め、総合点で丸めない（Anthropic は基準ごとの閾値で1つでも落ちたら不合格にしています）。
- 所見にはスクリーンショットと再現手順を必須にする。「なんとなく良くない」は所見にしない。
- 人が定期的に採点を較正する（[価値検証ループ](#6-価値検証ループ-value人が主役)の「較正」）。

## 2b. UI/UX 改善係 (polish)

2026-11-22 オーナーの依頼で追加。「指摘待ちではなく、自律的に判断してどんどん良くしていく」ための係です。
patrol は旅が最後まで行けるかを採点して Issue にするだけで、P2 の見た目・文言の所見は builder の precheck（P0/P1 のみ）に拾われず溜まっていました（2026-11-22 時点で `loop:ux` P2 が8件）。polish は **見る人と直す人を1周の中で兼ね**、R0/R1 に限って自分で直して main に出します。

| 項目 | 内容 |
| --- | --- |
| 担当 | 毎回まっさらな polish セッション（builder と別 worktree） |
| 起動 | Orca automation `ksh polish`：**10〜22時に3時間ごと**（`30 10-22/3 * * *`、1日5回） |
| precheck | `node scripts/loop/precheck.mjs polish`：main-health が赤でない、open な P0 が無い、前回の polish log から 2 時間以上たっている |
| 入力 | [ux-rubric.md の「情報設計の原則」](ux-rubric.md#情報設計の原則オーナー方針-2026-11-22)、画面の巡回順（指示書）、polish log Issue |
| 出力 | 1周で 1〜3 件の R0/R1 の改善 commit（`Loop: polish`）、R2 の所見は `loop:ux` Issue、polish log Issue へのコメント（before/after） |
| 指示書 | [prompts/polish.md](prompts/polish.md) |

**自分の採点が甘くなる問題への対策**：polish は自分で直すので、評価の独立は patrol に残します。polish が出した変更は次の patrol が別 context で旅として歩き、悪くしていれば `loop:ux` に積みます。加えて polish log の before/after を人が見て、原則とずれていれば ux-rubric.md の「較正の記録」を直します（[価値検証ループ](#6-価値検証ループ-value人が主役)の較正）。

**採らなかった案**：(a) patrol に直す権限を足す — 採点者が自分の直した所を採点することになり、独立した評価がなくなる。(b) P2 の `loop:ux` も finish が拾う — 機能の完成と見た目の磨き込みが同じ待ち行列で競い、どちらも遅れる。(c) オーナーの指摘を待つ — 依頼の趣旨（指摘待ちにしない）に反する。

## 3. 庭仕事ループ (garden)

コードと文書の陳腐化を定期的に掃除する。OpenAI の harness engineering で、週の2割を「AIが残した散らかり」の掃除に費やしていた状態を、定期的な doc-gardening エージェントに置き換えた事例に倣います。

| 項目 | 内容 |
| --- | --- |
| 担当 | まっさらな garden セッション |
| 起動 | Orca automation `garden`：**毎日 05:00 JST** |
| precheck | 前回の garden 以降に main へ commit がある |
| 対象 | 実装と食い違う文書、使われていないexport・ファイル、旧試用の残骸、依存更新PR（Dependabot）の取り込み判断、`docs/` の整理 |
| 出力 | 自分で直せるR0は直接 main へ（`Loop: garden`）。R1以上は `loop:garden` Issue にする |
| 指示書 | [prompts/garden.md](prompts/garden.md) |

最初の大仕事：`docs/` の約120ファイル（主に機能ごとの設計メモと QA-*.md）を `docs/archive/` へ移し、残すのは README・AGENTS・DESIGN・DECISIONS・DEPLOYMENT・RELEASE・WORK・loop/ とする。履歴は git に残るので失われません。

## 4. 再計画ループ (replan)

待ち行列を作り直す。Ralph の planning モードに相当し、「計画は使い捨て。迷ったら作り直す」を仕組みにします。

| 項目 | 内容 |
| --- | --- |
| 担当 | conductor セッション（常駐）または Orca automation `replan` |
| 起動 | **4時間ごと**。加えて finish の待ち行列が空になったとき、`blocked` が3件以上溜まったとき |
| precheck | 前回の replan 以降に、Issue のクローズ／新規、または completion.json の変更がある |
| 入力 | completion.json、open Issues、直近の patrol 結果、`git log`、人の待ち行列への回答 |
| 出力 | `loop:finish` Issue の新規作成・優先度の付け直し・統合・クローズ。古いclaim（3時間以上進捗なし）の解除。docs/WORK.md の現在地（5行以内）の更新 |
| 指示書 | [prompts/replan.md](prompts/replan.md) |

再計画だけが completion.json の項目を追加・分割し、acceptance を書き直せます。弱める・消すことも replan が判断します（2026-11-23 オーナー決定。builder は acceptance を変えない）。そのときは DECISIONS に変更前後の文・理由・確かめなくなることを1項書き、恒久条件を写した条件は恒久条件の手前までしか下げません（[DECISIONS](../DECISIONS.md) 2026-11-23「受け入れ条件の弱体化・削除を agent（replan）が判断する」）。`blocked` は原因を読み、(a) 小さく分け直す、(b) 前提の Issue を先に立てる、(c) R3 なら `needs-human` に回す、(d) 毎回違う理由で fail しているなら条件・設計を見直す、のどれかにします。

## 5. リリース列車 (release)

| 項目 | 内容 |
| --- | --- |
| 担当 | release レーン（loop-infra が実装・運用） |
| 起動 | Orca automation `ksh release`：**毎日 08:00 と 20:00（JST）の定時便**（`0 8,20 * * *`、窓は発車から2時間）。窓の外は緊急の修正などの臨時便だけ（`npm run release -- --deploy --hotfix "<理由>"`）。手順と判断は release skill（`.claude/skills/release/SKILL.md`） |
| precheck | `node scripts/loop/precheck.mjs release` は常に通す（定時便は必ず起こし、見送りも記録する）。止める条件は `npm run release` が判定する：未リリースの commit が無い、main-health が赤、リリースCIが実行中、open な `P0` Issue がある（UX巡回の S1 で列車を止める。臨時便は除く）。R2 commit の独立検証が Issue 上で済んでいないなどの判断は agent が見て `--skip "<理由>"` で残す |
| 手順 | `npm run release -- --deploy`：選んだSHA → `rc/<sha7>` → CI verify green → release へ fast-forward → tag → GitHub Release → D1 migration（ブックマーク記録後）→ 本番 deploy → smoke → 失敗なら直前の版へ戻す。CI 用 token があれば deploy は GitHub Actions が行い、release スクリプトがそれを見届ける（詳細は [RELEASE.md](../RELEASE.md)） |
| 出力 | tag、GitHub Release（commit trailer から自動生成した変更点）、**Issue `release-log` への便ごとの記録**（いつ・版・含む commit と migration・CI・deploy・smoke・失敗の理由。集計は `npm run release:report`）、本番に対する patrol 1回の起動 |

**D1 migration の扱い**：コードを戻してもDBは戻らないため、migration は「追加してから使う（expand → contract）」で書き、1つ前のコードでも動く形にする。本番への適用は release の deploy に含め、agent が判断して行う（2026-11-21 オーナー決定。以前は人の承認を得た別操作だった）。deploy は適用前に D1 Time Travel のブックマークを記録し、migration → Worker 切り替え → smoke の順に進む。失敗時は Worker だけ戻し、D1 を戻すかは agent が判断する（[RELEASE.md](../RELEASE.md)、release skill）。builder は migration に削除・改名・既存データの書き換えを混ぜず、必要なら contract を別の Issue に分ける。

定時列車にした理由：毎commit出荷だと本番の smoke と巡回が追いつかず、逆に不定期だと「いつ出るか」を誰も約束できない。1日2便（朝8時・夜20時、2026-11-22 オーナー決定。[DECISIONS.md](../DECISIONS.md)）なら、学生が使い始める前の朝と、その日の成果がまとまった夜に出て、便ごとの記録を後から集計できる。

## 6. 価値検証ループ (value，人が主役)

AIには学生の価値を検証できません。このループは人が回し、AIは準備と集計を担います。

- **UX採点の較正**（週1回程度）：patrol の採点のうち数件を、人がブラインドで採点し直してずれを測る（`rlquiz` skill）。ずれた観点は ux-rubric.md を直す。
- **学生による検証**（完成後）：実際の学生に旅を1つ頼み、「読んだ経験が次の行動につながったか」を聞く（DECISIONS.md の H01 の問い）。結果は非公開で扱い、公開Issueに書かない。仮説の更新は DECISIONS.md へ。
- **レビュー**（例：2026-11-21 21:00）：conductor が HTML 1枚で報告（何が出たか・台帳の進捗・人の判断待ち）。人は判断と台帳の修正だけを返す。

## 人の待ち行列

`needs-human` ラベルの Issue。現時点で分かっているもの：

- 課金・契約の変更（R2 画像ストレージの有効化など）。Workers Paid は 2026-11-21 に加入済み。
- 実在の学生への告知・募集・試用。
本番 D1 の migration・deploy・rollback と PRD 方針の判断は 2026-11-21 から、資格情報の発行は 2026-11-23 から人の待ち行列に積まない（agent が判断して進め、理由を残す）。

### 資格情報の発行

2026-11-23 オーナー決定（[DECISIONS](../DECISIONS.md) 2026-11-23「資格情報の発行を条件つきで agent に任せる」）。API token・OAuth client・MCP の接続許可・deploy 用の鍵などを agent が発行してよい。条件：

1. **最小スコープ。** 対象リソース（account・zone・repo・environment）と権限を用途に要るものだけに絞る。期限を付けられるものは付ける（既定は 90 日。CI の常用でも 1 年以内）。確かめるためだけの token は使い終えたら取り消す。
2. **記録。** 発行・入れ替え・取り消しのたびに DECISIONS の[発行記録](../DECISIONS.md#資格情報の発行記録)に1行足す（日付・種類と名前・目的・スコープ・期限・置き場所の名前・取り消し方）。account ID・宛先・値は書かない（公開リポジトリ）。
3. **値を出さない。** 発行の応答は画面・ログ・ファイル・コマンド引数に出さず、パイプで置き場所（GitHub の environment secret、`wrangler secret`、`~/.config/kobe-student-hub/`）へ直接流す。値が出力に出る手段しかない場合（画面に1回だけ表示する管理画面など）は発行せず、止まった場所を `needs-human` に書く。
4. **置き場所は使う範囲に合わせる。** 本番用は environment `production`（release ブランチ限定）に置き、repo 全体の secret にしない。
5. 実利用者の資格情報を作らない・代わりに発行しない。課金・契約を伴う発行（有料プランの API キーなど）は R3 のまま。

ループはこれらを待たずに進めます。開放できないものは「本番では閉じたまま、mainでは完成」の状態で台帳に記録します（completion.json の `production` 欄）。

## Orca automation への登録まとめ（loop-infra 向け）

| 名前 | cron (JST) | precheck の要点 | 指示書 |
| --- | --- | --- | --- |
| `ksh mend` | 毎時 | main の最新 main-health が失敗 | （RELEASE.md） |
| `ksh finish` | `*/30 * * * *` | 未claimの `P0`/`P1` の `loop:finish`/`loop:ux` があり、worktree が clean | prompts/finish.md |
| `ksh patrol` | `0 */3 * * *`＋release後に本番1回 | `patrol-log` Issue 最新コメントの sha から origin/main までに src/worker/public の変更 | prompts/patrol.md |
| `ksh polish` | `30 10-22/3 * * *` | main-health 非赤・open P0 なし・`polish-log` の最新コメントから2時間以上 | prompts/polish.md |
| `ksh garden` | `0 5 * * *` | `garden-log` Issue 最新コメントの sha 以降に main への commit | prompts/garden.md |
| `ksh replan` | `0 */4 * * *`＋finish 待ち行列が空＋blocked≥3 | 前回 replan（`Loop: replan` の commit）以降に Issue か completion.json の変化 | prompts/replan.md |
| `ksh release` | `0 8,20 * * *`（missed-run grace 100分） | 常に通す（止める条件は `npm run release` が判定して記録） | `.claude/skills/release/SKILL.md` |
| `ksh editor` | `15 9,21 * * *` | 材料の inbox に未処理がある、または `editor-log` の最新から20時間以上 | prompts/editor.md（オーナーのレビュー → 好みの台帳 → 次の執筆。材料 → 下書き） |
| `ksh tidy` | `45 * * * *` | precheck 自体が仕事：終わった run と 6 時間止まった run の worktree を安全確認つきで消し、必ず exit 1（agent は起こさない）。点検は garden | [ORCA.md](ORCA.md#3-後片付けksh-tidy-と-prune-worktreesmjs) |

同時に走る builder（finish）は最大3。patrol と garden は builder と別 worktree で動かす。

どの automation も run ごとに新しい worktree を作る（`new_per_run`）。Orca は run が終わっても消さないので、`ksh tidy` が片付ける。bots を使わない理由も含めて [ORCA.md](ORCA.md)。
