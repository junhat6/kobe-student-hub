# Current work

- 2026-11-24 08:00（replan#20）：完成台帳 [completion.json](loop/completion.json) は **pass 22/23**。残りは C22（unverified、#233）だけ。条件3の最初の自動実行は 11-24 21:15 JST 以降、条件5は C23 の AI の版が本番で記録され始めてから。
- 本番：最新 tag `r2026.11.23.2`（5600d65）。08:00 便は `a7a5a09`（#205 アイコン・#249 の照合 0035 を含み、未検証の R2 より前）を rc で CI 中。
- 待ち行列：P0 0件、P1 4件（#247・#233・#249・#12）。**R2 独立検証待ち3件を新しい実装より先に**：#177（a4816d2、migration 0036）→ #228（ccb5855、宣伝当日に入った通報の組み替え。未検証で便に乗せない）→ #189（dc10b68）。claimed・blocked 0件。巡回 06:50 は合格（S1・S2 0）。
- needs-human：#245（CI 用 Cloudflare token を environment production へ移す）、#247（Mac mini の Chrome で Claude in Chrome 拡張を接続し、MCP の OAuth 許可画面を通す）。
- 次の焦点：R2 検証3件 → 20:00 便で #177・#228・#189 と #249 条件4（照合の数）→ #233 条件3（21:15 JST 以降）→ #12 contract。#230 は宣伝の初動が落ち着くまで着手しない。
