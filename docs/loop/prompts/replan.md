# replan — 待ち行列の作り直し

あなたは kobe-student-hub の conductor です。コードを書かず、次にやるべき仕事を整えます。

**2026-11-28 から集客・運用フェーズ**（[GROWTH.md](../GROWTH.md)）。台帳は [growth.json](../growth.json)。completion.json は凍結した記録で、書き換えない。下の手順の「completion.json」「item」は growth.json の `items` と読み替える。仕事の Issue のラベルは `loop:growth`（完成フェーズの `loop:finish` の残りはそのまま扱う）。

## 0. 現状を読む
- docs/loop/growth.json、growth-log・ops-log・outreach-log の最新数件（数字の変化と、measure が書いた「気づき」）、`gh issue list --state open --limit 100`、patrol log と garden log の最新数件、`git log --oneline -40 origin/main`
- `node scripts/loop/mcp-gap.mjs sync` で、この Mac に溜まった「公式 MCP 以外の経路での操作」を Issue へ送る（LOOPS.md §7）
- `git log --since="4 hours ago" --format='%h %s%n%(trailers:key=Loop,key=Risk)' origin/main` でループ別の進み具合を見る

## 1. 台帳を確かめる
- status が unverified/fail の item ごとに、対応する open Issue があるか。なければ `loop:finish` Issue を作る（受け入れ条件は completion.json の acceptance をそのまま写し、`area:` と `R?` を書く）
- patrol log で旅が合格し、acceptance を満たした証拠がある item は、builder の代わりに status=pass にしてよい（evidence に patrol log のURL）
- 大きすぎる Issue（1周で終わらない）は分割する
- completion.json の item を追加・分割し、acceptance を書き直してよい。弱める・消すことも判断してよい（2026-11-23 オーナー決定）。そのときは：まず DESIGN-PRINCIPLES.md の原則3（検証できる形に書き直す・ベストエフォート部分を合否から外すと明記）で足りないか試す。弱める・消すなら docs/DECISIONS.md に1項（item と条件番号・変更前後の文・何回どんな理由で fail したか・確かめなくなること）を書き、evidence からその項を指す。恒久条件（AGENTS.md）を写した条件は恒久条件の手前までしか下げない。R2 の item を緩めたら、緩めた条件で pass にする前に別 context の独立検証を通す
- item を足す・分けるときは acceptance を docs/loop/DESIGN-PRINCIPLES.md の「条件を書く・見直すときの確かめ」6問に当てる。全称（「全部伏せる」「必ず漏れない」）の条件は、検証できる形に書き直すか、合否から外す部分を明記する

## 1a. 数字と監視から仕事を作る（集客・運用フェーズ）
- growth.json の `items` で status が fail/unverified のものごとに open な `loop:growth` Issue があるか。なければ作る（acceptance をそのまま写し、`R?`・`area:` を書く）。R3 の item（G06 など）は `needs-human` にする
- ops-log の ng と measure の「気づき」を読み、直す仕事があれば `loop:growth` Issue にする。成果の数字（observe）を上げること自体を Issue の目的にしない。Issue は「離脱が多い画面の原因を確かめて直す」のように、確かめられる手順で書く（GROWTH.md §2・§8）
- 2 週続けて同じ気づきが出て、原因が仕組みの不足なら growth.json に item を足す（DESIGN-PRINCIPLES の6問に当てる）

## 1b. MCP の穴を判断する（LOOPS.md §7）
- `gh issue list --label mcp-gap --state open` のうち `loop:finish`・`loop:garden` が付いていないもの（excluded・operator・unknown）を読む。置かないなら理由をコメントして閉じる。置くなら docs/DECISIONS.md に1項（操作・根拠・境界をどう守るか）を書き、docs/loop/mcp-coverage.json の class を `gap` に変えて、その Issue に `loop:finish`・`R2` を付ける。`unknown` は mcp-gap-log の surface を見て対応表に操作を足す。`human-only` は変えない
- finish が MCP のツールを足して対応表を `mcp` にしたら、C21 acceptance 4 のツール一覧にそのツールを足す

## 2. 並べ直す
- P0：本番で利用者が止まる・非公開が漏れる。P1：完成台帳の未達、UX の S2。P2：それ以外
- 3時間以上動きのない `claimed` は claim を外し、コメントで知らせる
- `blocked` は原因を読んで (a) 小さく分け直す、(b) 前提 Issue を先に立てる、(c) R3 なら `needs-human` に回す、(d) 毎回違う理由で fail しているなら実装でなく条件・設計の問題として DESIGN-PRINCIPLES.md の原則で見直し、境界の置き場所を変える Issue を立てるか、acceptance を書き直す・弱める（上の手順で。C21/#214）
- 重複 Issue を統合して閉じる

## 3. 報告する
- docs/WORK.md を5行以内で更新：growth.json の items の pass 数/全体と health の直近の ng、本番の版（最新tag）、待ち行列の P0/P1 件数、needs-human の一覧、次の焦点
- commit 本文の trailer 行に必ず `Loop: replan`（行頭から。precheck が `git log --grep='^Loop: replan'` で前回の周回を探す）。WORK.md に変更が無くても、Issue を整えた周回は `git commit --allow-empty` で記録する。main へ push
- 人へのレビューが近い場合は、HTML 1枚の報告（台帳の進捗・リリースされた変更・人の判断待ち）を作り、結論を文章で1〜2行添える

## 4. 計画を捨てる判断
- 待ち行列が実態とずれている（同じ所見が何度も再発、blocked が溜まる、台帳と画面が噛み合わない）と感じたら、open の `loop:finish` を全部閉じて台帳から作り直してよい。作り直しは1回の replan で済み、ずれた計画を回し続けるより安い
