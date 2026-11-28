# Current work

- 2026-11-28 集客・運用フェーズ（[GROWTH.md](loop/GROWTH.md)）。台帳 [growth.json](loop/growth.json) の items は 3/9 pass（G03・G04・G05、本番反映は次の定時便）。health の直近 ng なし（ops-log 05:11 JST、H1〜H4 ok、H5 は G01 未リリース）。
- 本番：最新 tag `r2026.11.28.1`（b8dcfd6）。G01（使われ方の計測）・G03〜G05（検索エンジン・sitemap・OGP）を含む朝便が出た（smoke OK）。
- 待ち行列：P0 0・P1 2（#330 G01 は本番後に measure が acceptance 5 を確かめて閉じる、#247 needs-human）。G02・G07・G08・G09 は持ち主のループつき Issue（#331〜#334、P2、finish は選ばない）。
- needs-human：#247（MCP の実クライアント確認）。G06（Search Console）は G03〜G05 の本番反映後に立てる。
- 次の焦点：朝便 → measure が ksh_usage の初日を確かめ #330 を閉じる → 次の replan が G06 の needs-human を立て、11/29 以降に ops-log 2 日分で G09 を判定。
