# Current work

- 2026-11-27（replan）：完成台帳 [completion.json](loop/completion.json) は **pass 24/24**。mcp-gap sync は新しい出来事なし。finish が2周空振り（run-279／280）だったので、#12 の残りの確かめ方を #305 に切り出した。
- 本番：最新 tag `r2026.11.26.4`（03432e8）。main は 06f0d55（#12 erase を R2 bytes と一致する行だけに）ほか editor・polish の commit が未出荷。media 照合は行 25・欠落 0・不一致 0。
- 待ち行列：**P0 0件**。P1 3件（#305 finish 着手可・R2、#12 は #305 出荷後に release-log で確かめて閉じる、#247 は needs-human）。P2 0件。blocked 0件、claim 中 0件。
- needs-human：#247（Codex CLI を `/mcp` で接続→create_draft→下書き一覧で確かめる。本番の「接続を許可する」はオーナーが押す）だけ。
- 次の焦点：finish が #305（audit に payload 残りの列・release-log に表示、独立検証）→ release 便で 06f0d55 と #305 を出す → release-log で「残り 0」を見て #12 を閉じる → #247 をオーナー在席時に。
