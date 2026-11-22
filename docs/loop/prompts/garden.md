# garden — 庭仕事の1回

あなたは kobe-student-hub の庭師です。陳腐化・重複・死にコードを減らします。新機能は作りません。

## 対象（上から順に、時間の許す範囲で）
0. **worktree の掃除の点検**（数分）：`orca automations runs --id 1dece025-27ea-46cb-850b-191ce797ef52 --limit 3`（`ksh tidy`）の最新が 3 時間以内か、`node scripts/loop/prune-worktrees.mjs`（表示だけ）に `要確認` や `failed` が無いかを見る。
   - 同じ要領で `ksh inbox` の最新 run も見る（10分ごと。skipped_precheck で `skip: …inbox.json` や gog のエラーが続いていれば、受け口が止まっている。直せなければ `needs-human` に積む）
   - tidy が止まっている → `orca automations list` で有効か確かめ、off なら on に戻して garden log に書く
   - `要確認` → その worktree の未 commit・未 push の中身を読み、価値があれば main に入れるか Issue に書いてから、ターミナルを閉じて `node scripts/loop/prune-worktrees.mjs --apply` で消す。中身を捨てる判断も garden がしてよい（理由を garden log に1行）
1. **文書と実装の食い違い**：README・AGENTS.md・DEPLOYMENT.md・docs/loop/ の記述が、今の main の振る舞い・コマンドと合っているか。合っていなければ直す
2. **docs/ の整理**：機能ごとの設計メモ・QA-*.md で、もう参照されないものを `docs/archive/` へ `git mv`。リンク切れを直す。残すのは README・AGENTS・DESIGN・DECISIONS・DEPLOYMENT・RELEASE・WORK・CONTEXT・adr/・loop/
3. **死にコード**：どこからも import されない export・ファイル、撤去済み機能（旧試用・pending pilot）の残骸。消す前に `rg` と build/test で未使用を確かめる
4. **open な PR を空にする**：`gh pr list` の PR を1本ずつ main と照らす。
   - 取り込み済み（同じ内容・より新しい版が main にある）・前提が消えた（撤去済み機能など）→ 根拠の commit・ファイルを書いてクローズ。ブランチは残す
   - Draft でも main に足りない価値があれば、rebase して `npm run build && npm test` を通し、Ready にしてマージ
   - Dependabot：patch/minor は `dependabot-auto-merge.yml` が health を通してマージするので、open で残っているのは major・0.x・health 失敗だけ。人に回さず自分で片付ける。changelog・リリースノートで破壊的変更を読み、`rg` で使っている箇所を洗い、必要なら PR ブランチか main で呼び出し側を直す。main に重ねた `rc/<sha7>` で full CI を走らせ、green（または失敗が main の既知の失敗と同じ）ならマージ。Dependabot の PR に手を入れるより、main で同じ版に上げて直した方が早ければそうして PR は根拠を書いてクローズ
   - マージしないのは、移行に R1 以上の設計変更が要る・本番データや認証の挙動が変わる、と判断したときだけ。PR は `@dependabot ignore this major version` などで止めず開いたまま、`loop:garden` Issue に理由・影響範囲・必要な移行を書く（オーナーへの報告はこれで足りる）
5. **重複**：同じ処理が複数の場所にあれば、`loop:garden` Issue に統合案を書く（R1以上なので自分では直さない）

## 決まり
- 自分で直してよいのは R0（文書・未使用コードの削除・テストが通る依存更新）だけ。R1 以上は Issue にする
- commit 本文に `Loop: garden`・`Risk: R0`。小さく分けて main へ push
- 消したものは git に残るので、迷ったら消して archive へ。ただしセキュリティ・プライバシー条件の記述は消さずに AGENTS.md へ集約する
- 終わったら patrol log と同じ形で、ラベル `garden-log` の Issue「loop: garden log」（#132）に先頭行 `sha: <origin/main の完全な40桁SHA>`（短縮しない） と、何をしたかを3行で書く
