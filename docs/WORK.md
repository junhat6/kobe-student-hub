# Current work

- 2026-11-26 20:00（replan）：完成台帳 [completion.json](loop/completion.json) は **pass 24/24**。#298（`project.write`）は main 済み（32e4332・独立検証済み）で閉じ、#299・#300 も閉じた。mcp-gap sync は新しい出来事なし。
- 本番：最新 tag `r2026.11.26.3`（7862179）。#12 migration 0050・0051（作品の下書きの MCP の印）・#247 `/mcp`・#298 作品の下書きの MCP ツールを含む。
- 待ち行列：**P0 0件**。P1 2件（#12 は 0050 の本番適用後に payload 消去 Worker、#247 は needs-human）。P2 0件。blocked 0件、claim 中 0件。finish の着手先は夜便が出るまでない。
- needs-human：#247（Codex CLI を `/mcp` で接続→create_draft→下書き一覧で確かめる。本番の「接続を許可する」はオーナーが押す）だけ。
- 次の焦点：夜便で 0050 と `/mcp` を本番へ → #12 の payload 消去 Worker（1行ずつ `WHERE … payload IS NOT NULL` で消し changes で判定）→ #247 をオーナー在席時に確認。
