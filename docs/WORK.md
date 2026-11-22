# Current work

- 2026-11-22 replan#8：完成台帳 [completion.json](loop/completion.json) は **pass 20/20** のまま。patrol（f5d21f1）で J0〜J5 を PC/モバイルで完遂、S1/S2 0件。
- 本番：最新 tag `r2026.11.22.1`（85d0476）のまま。2026-11-22 の列車は rc の full CI が2回赤で昇格せず（91496a8：公開一覧の同名件数の確認が20件上限で崩れる→#191 で修正／f2e5c73：#192 作品救済テストの30秒 timeout、ローカル30回では再現せず）。main は15 commit 未反映、migration なし。D1 は 0026 まで適用済み。
- 待ち行列：P0 0件、P1 1件（#192 列車を止める test の揺れ）、claimed 0件。P2 13件（loop:ux #143 #168 #173 #174 #178 #179 #185 #190、loop:garden #177 #186 #187 #188 #189）。
- needs-human：#12 R2 画像の課金・契約条件、#5 学生による試用（実利用者）。
- 次の焦点：#192 を直す → main を `npm run release -- --deploy` で本番へ昇格（3周続けて未反映）→ #190 モバイルの公開ボタン折り返し → #188 媒体容量上限 → #186 Actions major（rc で full CI）。
