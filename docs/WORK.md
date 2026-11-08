# Current work

- 12時間の目標：2026-11-09 16:25 JST。実装・統合・本番反映を優先し、検証詳細はPRへ集約する。
- mainは[fragment/POST認証 #116](https://github.com/junhat6/kobe-student-hub/pull/116)と[実D1 quota試験枠 #118](https://github.com/junhat6/kobe-student-hub/pull/118)を統合済み。現在の本番はサンプル閲覧のみで、実Google・投稿は未開放。
- 次の価値仮説：通常の学校Google登録・年度管理・ログアウトを先行して開き、投稿準備へ進める。未公開候補[#117](https://github.com/junhat6/kobe-student-hub/pull/117)はOAuth/account UIだけ有効、authoring server/UIは無効。
- 実装：既存認証整理storeへ24時間猶予・15分間隔・各100件の固定policyとOAuth側schedulerを接続。運営通知のgateは別のまま。production cronはprivate設定への設置と実行確認待ち。
- 検証：整理deltaを含む813 unit・公開62が成功。既存HTTPS account PC/mobile2と別contextのstage23 unit＋2browserも成功済み。実platformの合成provider8分岐は保存ログの機密marker0を確認、400/503の保存event statusとspan相関の限界はLOGGING-GATEに記載。実Google・学生価値・物理端末の成功とは扱わない。
- 次の実行：整理処理の独立QAと統合CI後、cronを含むaccount-only本番反映・通常Google本人登録を確認。投稿開放には実operator設定・通知/問い合わせ・本人確認案内などの既存条件を別に満たす。
- PRD原文・恒久的なsecurity条件は変更しない。過去の作業履歴はGitと各PRを参照する。
