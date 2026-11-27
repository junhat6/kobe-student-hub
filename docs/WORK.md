# Current work

- 2026-11-28 **集客・運用フェーズへ移行**（オーナー決定、[DECISIONS 2026-11-28](DECISIONS.md)）。設計は [GROWTH.md](loop/GROWTH.md)、台帳は [growth.json](loop/growth.json)（items 0/9 pass）。completion.json は 27/27 pass で凍結。
- 本番：最新 tag `r2026.11.27.3`（a857038）。計測の受け口（G01、R2）は main に入り、独立検証のあと定時便で出る。
- automation：measure・ops・outreach を新設、polish を停止、finish（needs-human を数えない・毎時）・replan（6時間）・patrol（release 後だけ）を作り替え。
- needs-human：#247（MCP の実クライアント確認）。G06（Search Console）は G03〜G05 の本番反映後に立てる。
- 次の焦点：G01 の独立検証 → 朝便 → measure が ksh_usage の初日の数字を出す → finish が G03（index の列挙）・G04（メタ情報）・G05（sitemap）。
