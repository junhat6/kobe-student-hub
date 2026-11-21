# Current work

- 2026-11-22 replan#8：完成台帳 [completion.json](loop/completion.json) は **pass 20/20** のまま。patrol（f5d21f1）で J0〜J5 を PC/モバイルで完遂、S1/S2 0件。
- 本番：最新 tag `r2026.11.22.1`（85d0476）。main はその後 13 commit 未反映（a03f2d5 初公開表示、165a165 閲覧履歴、9e3c66e 画像の断り理由など）。D1 は 0026 まで適用済み。
- 待ち行列：P0 0件、P1 0件、claimed 0件。P2 13件（loop:ux #143 #168 #173 #174 #178 #179 #185 #190、loop:garden #177 #186 #187 #188 #189）。
- needs-human：#12 R2 画像の課金・契約条件、#5 学生による試用（実利用者）。
- 次の焦点：main を `npm run release -- --deploy` で本番へ昇格（2周続けて未着手）→ #190 モバイルの公開ボタン折り返し → #188 媒体容量上限 → #186 Actions major（rc で full CI）。
