# Current work

- 2026-11-26 16:00（replan）：完成台帳 [completion.json](loop/completion.json) は **pass 24/24**。mcp-gap sync で #298（`project.write`、gap → finish R2）と #299（`draft.list`、MCP にあるのに http で利用 → garden）が立った。
- 本番：最新 tag `r2026.11.26.2`（7fba5f4）。main には未出荷の 17b06e9（#12 migration 0050）・c946454/3e6da47（#247 `/mcp`）・fade4c7/075e60f/28dbed2（search・history の polish）が載っている。
- 待ち行列：**P0 0件**。P1 2件（#12 は 0050 の本番適用後に payload 消去 Worker、#247 は needs-human）。P2 の #298 を作品の下書きの作成・更新に絞り、受け入れ条件と DECISIONS 2026-11-26 を書いた → 空回りしていた finish が取れる。blocked 0件、3時間超の claim なし。
- needs-human：#247（Codex CLI を `/mcp` で接続→create_draft→下書き一覧で確かめる。本番の「接続を許可する」はオーナーが押す）だけ。
- 次の焦点：finish は #298（R2 独立検証まで）→ 夜便で 0050 と `/mcp` を本番へ → #12 の payload 消去 Worker → #247 をオーナー在席時に確認。
