# Current work

- 2026-11-27 16:00 replan：完成台帳 [completion.json](loop/completion.json) は **pass 27/27**（変化なし）。方針は [DECISIONS 2026-11-27](DECISIONS.md)。
- 本番：最新 tag `r2026.11.27.1`（bfe1285）。main はその後 5 commit（#320 の文言、ホームとカード注記・/works/new の polish、通報テストの flaky 修正、finish の指示。patrol run-53 は c817a0a で合格）で、20:00 の夜便に載る。migration なし。
- 待ち行列：**P0 0件・P1 2件**（#12 は夜便の release-log 待ち、#247 は needs-human）。P2・loop:ux・blocked・claimed は 0件。mcp-gap の未判断 0件・同期 0件。
- needs-human：#247（Codex CLI を `/mcp` で接続→create_draft→下書き一覧で確かめる。本番の「接続を許可する」はオーナーが押す）だけ。
- 次の焦点：夜便の release-log で「D1 に本体が残る行 0」かつ欠落・不一致 0 を見て #12 を閉じる → patrol で #319・#320 を本番で確かめる → #247 をオーナー在席時に。それまで finish は空振りでよい。
