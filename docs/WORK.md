# Current work

- 2026-11-24 20:00（replan#23）：完成台帳 [completion.json](loop/completion.json) は **pass 22/23**。残りは C22（unverified、#233）だけ。条件3の最初の自動実行は今夜 21:15 JST の回。
- 本番：最新 tag `r2026.11.24.1`（ba8e62c、11-24 夜便。11-24 の朝・夜の CI 赤で止まっていた 80 commit と migration 0035〜0040 を出した。記録 #211）。便は落ちたら直して `--continue` で出しきる（DECISIONS 2026-11-24）。
- 待ち行列：P0 0件、P1 5件（#189 4段目＝残りの client と readRequest の CSRF test、#249 条件4は 11-25 08:00 便の release-log、#233 は 21:15 JST 待ち、#12 は #249 待ち、#247 needs-human）。P2：#265（保護表の INSERT OR REPLACE と見えない文字だけのタイトル）。blocked 0件。
- needs-human：#247（CLI 3種の確認＝Chrome の Local Network Access 許可、claude.ai のテスト下書きの削除）。
- 次の焦点：20:00 便の結果 → #233 条件3（21:15 JST）→ #189 4段目 → #265。`tests/media.test.ts` の1件（Body has already been read）は flaky 候補として再発したら Issue にする。
