# Current work

- 2026-11-22 replan#9：完成台帳 [completion.json](loop/completion.json) は **pass 20/21**。7427fdc の「自分のAIエージェントで書き・読める」を C21（unverified）として追加し #196 に積んだ。patrol は前回（f5d21f1）で J0〜J5 合格、S1/S2 0件。
- 本番：最新 tag `r2026.11.22.1`（85d0476）のまま、main は24 commit 未反映、migration なし（D1 は 0026 まで）。rc/8ad2739 は /guide「運営者」の幅で赤（5106bce で修正済み、#192 のテストは通過）、rc/5106bce の full CI が走行中。
- 待ち行列：P0 0件、P1 4件（#192 rc の test の揺れ、#196 C21 確認、#188 媒体上限の定数1か所化と理由文 → #195 上限引き上げ migration）、claimed 0件。P2 14件（loop:ux #143 #168 #173 #174 #178 #179 #185 #190 #194、loop:finish #193、loop:garden #177 #186 #187 #189）。
- needs-human：#12 R2 画像の課金・契約条件、#5 学生による試用（実利用者、H02〜H04 の確かめ方もここ）。
- 次の焦点：rc/5106bce が green なら `npm run release -- --deploy` で本番へ昇格 → #196 C21 の確認 → #188 → #195 → #193（前提の agent 作業は main に入った）。
