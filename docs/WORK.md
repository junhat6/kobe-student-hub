# Current work

- 2026-11-28 集客・運用フェーズ（[GROWTH.md](loop/GROWTH.md)）。台帳 [growth.json](loop/growth.json) の items は 5/12 pass（G03〜G06・G11。G06 はオーナーが Search Console に sitemap を送って #335 を閉じた）。health の直近 ng なし（ops-log 14:16 JST、H1〜H4 ok）。`ksh_usage` はまだ 0 行（H5 は measure が判定）。
- 本番：最新 tag `r2026.11.28.2`（1d88a8c、臨時便 #339 Safe Browsing 対策）。G01・G03〜G05・G10 の入口を含む（smoke OK）。
- 待ち行列：P0 0・P1 4（#330 G01 は measure が acceptance 5 を確かめて閉じる、#247 は finish が claude.ai コネクタ・Claude Code で確かめる、#348・#349 は needs-human）。G02・G07〜G10・G12 は持ち主のループつき Issue（#331〜#334・#346・#347、P2）。
- needs-human：#348（Search Console の「不正なページ」の審査をリクエスト）、#349（MacBook Air の Codex で create_draft を 1 回）。
- 次の焦点：オーナーが #348 の審査リクエスト → measure が 11/29 朝に ksh_usage（G01・G10 の 3）を確かめる（0 行なら送る側を疑う P1）→ finish が #247 → measure が 11/30 の週次で G02・G12。
