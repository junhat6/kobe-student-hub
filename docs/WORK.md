# Current work

- 2026-11-21 replan#4：完成台帳 [completion.json](loop/completion.json) は pass 9/20（C01–C06 C13 C18 C19）。残り11件は全て open の `loop:finish` Issue に対応。
- 本番：最新 tag `r2026.11.21.3`（1ff4649。release も同じ SHA）。通常投稿は本番で閉じたまま。
- 待ち行列：P0 0件。P1 12件（loop:finish）。P2 11件（#142 #143 #167 #168 #169 #172–#177）。
- needs-human：#165 Workers Paid、#166 本番 Worker 設定の再作成と D1 migration（0024・0025）の承認、#11 CI 用 Cloudflare token、#12 R2 画像の課金条件、#5 学生による試用。
- 次の焦点：詰まりは実装でなく R2 独立検証。#152（C08）・#158（C14）・#171（C20 作品側）は実装済みで verifier 待ち（#158・#171 は claim を外した）→ 合格で C08・C14・C20 を pass。その後 C09（#153）・C07（#151）。
