# Current work

- 2026-11-22 replan#10：完成台帳 [completion.json](loop/completion.json) は **pass 20/21**。C21 は条件5（執筆キット `index` の project 列でホーム作業時に利用者名が出る）だけ不合格 → #196 を分割し前提 #209（P1）に。patrol は 5106bce で J0〜J5 合格、S1/S2 0件。#199 は a678c16 で解消済みのため閉じた。
- 本番：最新 tag `r2026.11.22.2`（a678c16）。以降の main（マイページ改修・アバター 0027/0028 migration）は未反映。rc/e754e4f の full CI がアバター・通報の browser spec 3件で赤（#208、P1）で列車停止中。
- 待ち行列：P0 0件、P1 6件（#208 列車の赤、#209 C21 条件5、#192 rc の揺れ、#196 C21（#209 待ち・blocked）、#188 → #195 媒体上限）、claimed 0件。P2 17件（loop:ux #143 #168 #173 #174 #178 #179 #190 #194 #200 #201 #203 #204、loop:finish #193 #205、loop:garden #177 #187 #189）。
- needs-human：#12 R2 画像の課金・契約条件、#5 学生による試用（実利用者、H02〜H04 の確かめ方もここ）。
- 次の焦点：#208 を直して rc green → `npm run release -- --deploy`（D1 0027/0028 の本番適用は RELEASE.md の手順で）→ #209 で C21 を pass → #188 → #195。
