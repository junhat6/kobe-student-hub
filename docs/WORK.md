# Current work

- 2026-11-24 20:00（replan#23）：完成台帳 [completion.json](loop/completion.json) は **pass 22/23**。残りは C22（unverified、#233）だけ。条件3の最初の自動実行は今夜 21:15 JST の回。
- 本番：最新 tag `r2026.11.23.2`（5600d65）。20:00 便が今出るところ（#189 3段目 4097565 は R2 検証に合格、#261 52f973b は条件付き合格で残りを #265 へ）。0035・0039 を含む。#261・#262・#263・#264・#230 は閉じた。
- 待ち行列：P0 0件、P1 5件（#189 4段目＝残りの client と readRequest の CSRF test、#249 条件4は 11-25 08:00 便の release-log、#233 は 21:15 JST 待ち、#12 は #249 待ち、#247 needs-human）。P2：#265（保護表の INSERT OR REPLACE と見えない文字だけのタイトル）。blocked 0件。
- needs-human：#247（CLI 3種の確認＝Chrome の Local Network Access 許可、claude.ai のテスト下書きの削除）。
- 次の焦点：20:00 便の結果 → #233 条件3（21:15 JST）→ #189 4段目 → #265。`tests/media.test.ts` の1件（Body has already been read）は flaky 候補として再発したら Issue にする。
