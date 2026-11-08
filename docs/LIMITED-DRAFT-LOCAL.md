# 初期active限定下書きローカル設計 — superseded

Issue #4、PR #91当時の履歴資料。既存activeアカウント1件を対象に、Google署名検証・browser-bound OAuth・session・私的下書き保存と、最終SQLの所有者・epoch・期限・取消をローカルで検証した。ここでの未接続・試験専用schemaという記述は当時の範囲であり、現在のproduction entryやDBの状態を表さない。

PR #93/#94でpending本人向け専用経路が採用され、初期operatorやactive移行を試用条件にする案は置き換えられた。**現行仕様と取消・再発行・保持の正本は [PENDING-DRAFT-TRIAL.md](PENDING-DRAFT-TRIAL.md)**。現在の試用のために在籍承認・operator付与を行う手順ではない。

当時の独立試験結果は [QA-LIMITED-DRAFT-LOCAL.md](QA-LIMITED-DRAFT-LOCAL.md) に残す。架空provider・ローカルD1の成功は実本人・実機・本番DBの証明ではない。fixtureはローカルだけで使用し、デプロイしない。
