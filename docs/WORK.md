# Current work

- 2026-11-28 集客・運用フェーズ（[GROWTH.md](loop/GROWTH.md)）。台帳 [growth.json](loop/growth.json) の items は 3/9 pass（G03・G04・G05、本番に出た）。health の直近 ng なし（ops-log 11:11 JST、H1〜H4 ok）。`ksh_usage` は反映から 2.5 時間で 0 行（H5 は measure が判定）。
- 本番：最新 tag `r2026.11.28.2`（1d88a8c、臨時便 #339 Safe Browsing 対策）。G01（使われ方の計測）・G03〜G05（検索エンジン・sitemap・OGP）を含む（smoke OK）。
- 待ち行列：P0 0・P1 3（#330 G01 は measure が acceptance 5 を確かめて閉じる、#335 G06 と #247 は needs-human）。G02・G07・G08・G09 は持ち主のループつき Issue（#331〜#334、P2、finish は選ばない）。
- needs-human：#335（Search Console 登録と sitemap 送信）、#247（MCP の実クライアント確認）。
- 次の焦点：measure が 11/29 朝の日次で ksh_usage を確かめ #330 を閉じる（0 行なら送る側を疑う P1 を立てる）→ ops-log 2 日分で G09 を判定 → オーナーが #335 を済ませる。
