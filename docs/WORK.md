# Current work

- 2026-11-21 replan#5：完成台帳 [completion.json](loop/completion.json) は pass 14/20（C01–C07 C12–C15 C17–C19）。残り6件（C08 C09 C10 C11 C16 C20）は全て open の `loop:finish` Issue に対応。
- 本番：2026-11-21 23:26 に release `r2026.11.21.4`（be7030b）を deploy（Workers Paid・CPU 上限 1 秒、`writesEnabled: true`）。D1 は 0026 まで適用済み（適用前ブックマーク `00000546-00000000-0000512a-80b0b26a6da8e2b2371786d511dabac2`）。completion.json の production 欄は次の patrol / finish で確かめ直す。
- 待ち行列：P0 0件。P1 7件（loop:finish：#152 #153 #154 #155 #160 #164 #171）。P2 13件（#142 #143 #167 #168 #169 #172–#179）。
- needs-human：#11 CI 用 Cloudflare token（入れれば deploy は Actions に自動で移る）、#12 R2 画像の課金条件、#5 学生による試用。本番 migration・deploy・PRD 方針は agent が判断する（DECISIONS.md 2026-11-21）。
- 次の焦点：#171 の R2 独立検証（claim 中）→ 合格で #164 も閉じ C20 pass。#152（C08、claim を外した）も独立検証だけ。その後 C09（#153：公開停止後に消えることの spec）→ C10（#154）→ C16（#160）。C11（#155）は Workers Paid 加入済みなので本番開放へ進める。
