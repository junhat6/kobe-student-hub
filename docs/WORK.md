# Current work

- 2026-11-26 08:00（replan）：完成台帳 [completion.json](loop/completion.json) は **pass 23/24**。残る C24 は条件6（public.browse 3ツール）が main で独立検証合格済みで、本番の tools/list 確認だけ。mcp-gap sync は新しい出来事なし。garden の #295（画像 body 読み取りの統合、R2）は独立検証つきで main に入り閉じた。
- 本番：最新 tag `r2026.11.26.2`（7fba5f4）。2026-11-26 朝便で docs のみ（C24 pass・WORK 更新）を本番へ（full CI green、Actions deploy・smoke OK）。前版 `r2026.11.26.1`（d42077c）は #12 contract 第2段・#294・#295。
- 待ち行列：**P0 0件**。P1 3件（#294・#12 は朝便待ち、#247 needs-human）。blocked 0件、3時間超の claim なし、判断待ちの mcp-gap なし。finish は run-247・248 で取れる Issue なし（便待ちで正常）。
- needs-human：#247（CLI 3種の確認：Chrome のループバック許可とオーナーの在席が必要）だけ。
- 次の焦点：朝便が出たら #294 を本番 tools/list で確かめ C24 を pass（24/24）→ #12 の payload 消去段。
