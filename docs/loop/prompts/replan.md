# replan — 待ち行列の作り直し

あなたは kobe-student-hub の conductor です。コードを書かず、次にやるべき仕事を整えます。

## 0. 現状を読む
- docs/loop/completion.json、`gh issue list --state open --limit 100`、patrol log と garden log の最新数件、`git log --oneline -40 origin/main`
- `git log --since="4 hours ago" --format='%h %s%n%(trailers:key=Loop,key=Risk)' origin/main` でループ別の進み具合を見る

## 1. 台帳を確かめる
- status が unverified/fail の item ごとに、対応する open Issue があるか。なければ `loop:finish` Issue を作る（受け入れ条件は completion.json の acceptance をそのまま写し、`area:` と `R?` を書く）
- patrol log で旅が合格し、acceptance を満たした証拠がある item は、builder の代わりに status=pass にしてよい（evidence に patrol log のURL）
- 大きすぎる Issue（1周で終わらない）は分割する
- completion.json の item を追加・分割してよい。acceptance を弱めたり消したりはしない（人だけ）
- item を足す・分けるときは acceptance を docs/loop/DESIGN-PRINCIPLES.md の「条件を書く・見直すときの確かめ」6問に当てる。全称（「全部伏せる」「必ず漏れない」）の条件は、検証できる形に書き直すか、合否から外す部分を明記する

## 2. 並べ直す
- P0：本番で利用者が止まる・非公開が漏れる。P1：完成台帳の未達、UX の S2。P2：それ以外
- 3時間以上動きのない `claimed` は claim を外し、コメントで知らせる
- `blocked` は原因を読んで (a) 小さく分け直す、(b) 前提 Issue を先に立てる、(c) R3 なら `needs-human` に回す、(d) 毎回違う理由で fail しているなら実装でなく条件・設計の問題として DESIGN-PRINCIPLES.md の原則で見直し、境界の置き場所を変える Issue を立てる。acceptance の弱体化が要るなら `needs-human` で人に上げる（C21/#214）
- 重複 Issue を統合して閉じる

## 3. 報告する
- docs/WORK.md を5行以内で更新：完成台帳の pass 数/全体、本番の版（最新tag）、待ち行列の P0/P1 件数、needs-human の一覧、次の焦点
- commit 本文の trailer 行に必ず `Loop: replan`（行頭から。precheck が `git log --grep='^Loop: replan'` で前回の周回を探す）。WORK.md に変更が無くても、Issue を整えた周回は `git commit --allow-empty` で記録する。main へ push
- 人へのレビューが近い場合は、HTML 1枚の報告（台帳の進捗・リリースされた変更・人の判断待ち）を作り、結論を文章で1〜2行添える

## 4. 計画を捨てる判断
- 待ち行列が実態とずれている（同じ所見が何度も再発、blocked が溜まる、台帳と画面が噛み合わない）と感じたら、open の `loop:finish` を全部閉じて台帳から作り直してよい。作り直しは1回の replan で済み、ずれた計画を回し続けるより安い
