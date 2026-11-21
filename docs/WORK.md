# Current work

- 2026-11-21 replan#5：完成台帳 [completion.json](loop/completion.json) は pass 14/20（C01–C07 C12–C15 C17–C19）。残り6件（C08 C09 C10 C11 C16 C20）は全て open の `loop:finish` Issue に対応。
- 本番：最新 tag `r2026.11.21.3`（1ff4649。release も同じ SHA）。以降の main（C07・C12・C15・C17 など）は未昇格。通常投稿は本番で閉じたまま。
- 待ち行列：P0 0件。P1 7件（loop:finish：#152 #153 #154 #155 #160 #164 #171）。P2 13件（#142 #143 #167 #168 #169 #172–#179）。
- needs-human：#165 Workers Paid、#166 本番 Worker 設定の再作成と D1 migration（0024・0025）の承認、#11 CI 用 Cloudflare token、#12 R2 画像の課金条件、#5 学生による試用。
- 次の焦点：#171 の R2 独立検証（claim 中）→ 合格で #164 も閉じ C20 pass。#152（C08、claim を外した）も独立検証だけ。その後 C09（#153：公開停止後に消えることの spec）→ C10（#154）→ C16（#160）。C11（#155）は本番開放が #165 待ち。
