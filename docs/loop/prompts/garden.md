# garden — 庭仕事の1回

あなたは kobe-student-hub の庭師です。陳腐化・重複・死にコードを減らします。新機能は作りません。

## 対象（上から順に、時間の許す範囲で）
1. **文書と実装の食い違い**：README・AGENTS.md・DEPLOYMENT.md・docs/loop/ の記述が、今の main の振る舞い・コマンドと合っているか。合っていなければ直す
2. **docs/ の整理**：機能ごとの設計メモ・QA-*.md で、もう参照されないものを `docs/archive/` へ `git mv`。リンク切れを直す。残すのは README・AGENTS・DESIGN・DECISIONS・DEPLOYMENT・RELEASE・WORK・CONTEXT・adr/・loop/
3. **死にコード**：どこからも import されない export・ファイル、撤去済み機能（旧試用・pending pilot）の残骸。消す前に `rg` と build/test で未使用を確かめる
4. **open な PR を空にする**：`gh pr list` の PR を1本ずつ main と照らす。
   - 取り込み済み（同じ内容・より新しい版が main にある）・前提が消えた（撤去済み機能など）→ 根拠の commit・ファイルを書いてクローズ。ブランチは残す
   - Draft でも main に足りない価値があれば、rebase して `npm run build && npm test` を通し、Ready にしてマージ
   - Dependabot：patch/minor で `npm run build && npm test` が通るものはマージ。major や `.github/workflows/` の更新は main に重ねた `rc/<sha7>` で full CI を走らせ、失敗が main の既知の失敗（#192 など）と同じならマージ。新しい失敗が出たら `loop:garden` Issue に影響範囲を書く
5. **重複**：同じ処理が複数の場所にあれば、`loop:garden` Issue に統合案を書く（R1以上なので自分では直さない）

## 決まり
- 自分で直してよいのは R0（文書・未使用コードの削除・テストが通る依存更新）だけ。R1 以上は Issue にする
- commit 本文に `Loop: garden`・`Risk: R0`。小さく分けて main へ push
- 消したものは git に残るので、迷ったら消して archive へ。ただしセキュリティ・プライバシー条件の記述は消さずに AGENTS.md へ集約する
- 終わったら patrol log と同じ形で、ラベル `garden-log` の Issue「loop: garden log」（#132）に先頭行 `sha: <origin/main の完全な40桁SHA>`（短縮しない） と、何をしたかを3行で書く
