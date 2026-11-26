# Current work

- 2026-11-27：オーナーの UX フィードバック7点を受け、台帳に C25（エディターを CodeMirror 6 に）・C26（カード・相対時刻・プレビュー画像・ヒーロー）・C27（作者カード・SNS リンク）を足した。完成台帳 [completion.json](loop/completion.json) は **pass 24/27**。方針は [DECISIONS 2026-11-27](DECISIONS.md)。
- 本番：最新 tag `r2026.11.26.4`（03432e8）。main は 06f0d55（#12 erase を R2 bytes と一致する行だけに）ほか editor・polish の commit が未出荷。media 照合は行 25・欠落 0・不一致 0。
- 待ち行列：**P0 0件**。P1 は #305・#12・#247（needs-human）に加え、#306 エディター・#307 カード・#308 相対時刻・#309 ヒーロー・#312 作者カード。P2 は #310 自動カード・#311 プレビュー画像を選ぶ（R2）・#313 SNS リンク（R2）。blocked 0件。
- needs-human：#247（Codex CLI を `/mcp` で接続→create_draft→下書き一覧で確かめる。本番の「接続を許可する」はオーナーが押す）だけ。
- 次の焦点：finish が #305（audit に payload 残りの列・release-log に表示、独立検証）→ release 便で 06f0d55 と #305 を出す → release-log で「残り 0」を見て #12 を閉じる → #247 をオーナー在席時に。 UX は #307 → #308・#309 → #306 → #312 の順（#310・#311 は #307 の後、#313 は #312 の後）。
