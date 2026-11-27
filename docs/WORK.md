# Current work

- 2026-11-28 00:00 replan：完成台帳 [completion.json](loop/completion.json) は **pass 27/27**（変化なし）。方針は [DECISIONS 2026-11-27](DECISIONS.md)。
- 本番：最新 tag `r2026.11.27.3`（a857038）。#12 は本番の media 照合で閉じた。#319・#320 の修正は本番に出ている（#320 は本番 bundle に旧文言が無いことを確認）。
- 待ち行列：**P0 0件・P1 1件**（#247、needs-human）・**P2 1件**（#322 通報ダイアログの「セッション」と重複文、R2）。loop:ux・blocked・claimed は 0件。mcp-gap の未判断 0件・同期 0件。
- needs-human：#247（Codex CLI を `/mcp` で接続→create_draft→下書き一覧で確かめる。本番の「接続を許可する」はオーナーが押す）だけ。
- 次の焦点：finish が #322 を直し、別 context の R2 独立検証を経て朝便へ → patrol で #319 を本番のログイン画面で確かめる → #247 をオーナー在席時に。
