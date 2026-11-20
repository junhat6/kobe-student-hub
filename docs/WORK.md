# Current work

- 2026-11-21：進め方を自律ループへ切り替え（[docs/loop/](loop/README.md)）。main＝直接pushの幹、本番は `npm run release` で release へ昇格（[RELEASE.md](RELEASE.md)）。初回の列車 `r2026.11.21.1`＝d2eef09（昇格のみ・本番 deploy なし）。Orca automation 6本（release/mend/finish/patrol/garden/replan）稼働。
- 完成台帳：[completion.json](loop/completion.json) 20項目、全て unverified（確かめ直し待ち）。最初の replan で `loop:finish` Issue に展開する。
- 本番：アカウント機能まで公開。通常投稿は閉じたまま（Workers Paid の契約判断待ち、#119）。本番 wrangler 設定の再作成も未了。
- 人の判断待ち（`needs-human`）：有料プラン、本番D1 migration の適用、CI 用 Cloudflare token。
- 次の焦点：UX巡回の初回（#131）で旅 J0〜J5 の現状を測り、S1/S2 から直す。
