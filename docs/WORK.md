# Current work

- 2026-11-26 12:00（replan）：完成台帳 [completion.json](loop/completion.json) は **pass 24/24**。mcp-gap sync は新しい出来事なし、判断待ちの mcp-gap Issue なし。
- 本番：最新 tag `r2026.11.26.2`（7fba5f4）。main には未出荷の 17b06e9（#12 migration 0050）・c946454/3e6da47（#247 `/mcp` 受け口、R2 独立検証 PASS）・fade4c7（search polish）が載っている。
- 待ち行列：**P0 0件**。P1 2件。#12 は「既存データの書き換えは別の列車」の規則（RELEASE.md）により、0050 が本番に出た後の便で payload 消去 Worker に進む。#247 は needs-human。blocked 0件、3時間超の claim なし。finish が取れる Issue は次の便まで無い（正常）。
- needs-human：#247（Codex CLI を `/mcp` のまま接続→create_draft→下書き一覧で確かめる。本番の「接続を許可する」はオーナーが押す）だけ。
- 次の焦点：次の便で 0050 と `/mcp` を本番へ → #12 の payload 消去 Worker（1行ずつ id・sha256 で照合、changes で判定）を起票どおり着手 → #247 をオーナー在席時に確認。
