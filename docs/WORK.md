# Current work

- 2026-11-21 replan#5：完成台帳 [completion.json](loop/completion.json) は pass 14/20（C01–C07 C12–C15 C17–C19）。残り6件（C08 C09 C10 C11 C16 C20）は全て open の `loop:finish` Issue に対応。
- 本番：2026-11-22 01:14 に release `r2026.11.22.1`（85d0476）を **GitHub Actions の deploy job** で反映（[run](https://github.com/junhat6/kobe-student-hub/actions/runs/44923396707)、未適用 migration なし・smoke OK）。以後 `npm run release -- --deploy` は Actions を見届ける。D1 は 0026 まで適用済み（0024〜0026 の適用前ブックマーク `00000546-00000000-0000512a-80b0b26a6da8e2b2371786d511dabac2`）。
- 待ち行列：P0 0件。P1 7件（loop:finish：#152 #153 #154 #155 #160 #164 #171）。P2 13件（#142 #143 #167 #168 #169 #172–#179）。
- needs-human：#12 R2 画像の課金条件、#5 学生による試用。CI 用 token（#11）は 2026-11-22 に repo secret で入り閉じた（environment `production` へ移すのは任意の推奨、RELEASE.md）。本番 migration・deploy・PRD 方針は agent が判断する（DECISIONS.md 2026-11-21）。
- 次の焦点：#171 の R2 独立検証（claim 中）→ 合格で #164 も閉じ C20 pass。#152（C08、claim を外した）も独立検証だけ。その後 C09（#153：公開停止後に消えることの spec）→ C10（#154）→ C16（#160）。C11（#155）は Workers Paid 加入済みなので本番開放へ進める。
