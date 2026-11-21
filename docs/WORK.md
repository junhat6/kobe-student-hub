# Current work

- 2026-11-22 replan#7：完成台帳 [completion.json](loop/completion.json) は **pass 20/20**（C08–C11・C16・C20 が独立検証で pass。patrol 778fac8 で J0〜J5 を PC/モバイルで完遂）。
- 本番：最新 tag `r2026.11.22.1`（85d0476、GitHub Actions の deploy）。main はその後の修正（a03f2d5 初公開表示、165a165 閲覧履歴、9e3c66e 画像の断り理由など）が未反映。D1 は 0026 まで適用済み。
- 待ち行列：P0 0件、P1 0件。P2 12件（loop:ux #143 #168 #173 #174 #178 #179 #185、loop:garden #177 #186 #187 #188 #189。#167 は4件に分割して閉じた）。
- needs-human：#12 R2 画像の課金・契約条件、#5 学生による試用（実利用者）。
- 次の焦点：main を `npm run release -- --deploy` で本番へ昇格 → #188 媒体容量上限（R2）→ #186 Actions major（rc で full CI）→ UX の S3 を J2/J4 から順に。
