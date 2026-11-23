# Current work

- 2026-11-24 04:00（replan#19）：完成台帳 [completion.json](loop/completion.json) は **pass 22/23**。残りは C22（unverified、#233）だけ。条件3の最初の自動実行は 11-24 21:15 JST 以降、条件5は C23 の AI の版が本番で記録され始めてから。
- 本番：最新 tag `r2026.11.23.2`（5600d65）。次の 08:00 便には #249 の照合（0035）、#203 の公開停止ダイアログ（巡回で解消を確認・close 済み）、#205 のアイコン表示（94b8004、R2 独立検証待ち）が乗る候補。
- 待ち行列：P0 0件、P1 4件（#247・#233・#249・#12）、R2 検証待ち1件（#205）、claimed・blocked 0件。巡回 03:30 は合格（S1・S2 0）。#249 は便で数が載るのを待ち、#12 の contract は #249 の数が全件一致になってから。
- needs-human：#245（CI 用 Cloudflare token を environment production へ移す）、#247（Mac mini の Chrome で Claude in Chrome 拡張を接続する。接続後に MCP の OAuth 許可画面を通す）。
- 次の焦点：#205 の R2 独立検証 → 08:00・20:00 便で #249 条件4 → #233 条件3（21:15 JST 以降）→ #12 contract。#247 は拡張がつながり次第。
