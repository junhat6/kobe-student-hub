# 1人限定ログインと下書きのローカル設計

> **撤去済み機能の履歴:** 本人限定の試用機能は撤去します。この文書の試用専用URL・コマンド・接続手順は現行の利用案内ではありません。[撤去範囲と検証](RETIRED-DRAFT-TRIAL.md)を参照してください。

Issue #4 の実装準備。production entry に接続しない。既存のGoogle署名検証・browser-bound OAuth・session・下書き保存・編集画面を使用し、サーバー側の対象account ID、session epoch、期限を照合する。既存active accountのみが対象で、pendingからの承認やoperator登録は行わない。private draftの最終SQLでも所有者・session・epochと期限を確認する。公開・運営経路は提供しない。

取消の正本は同一DBの限定grantで、revoked_at_ms更新が確定して初めて取消完了とする。最終SQLはgrant・epoch・未取消・DB実行時刻を照合する。DBで取消が先に確定した要求は拒否され、既に確定した操作は遡及できない。外部policy削除だけは新規要求を閉じるが、bind済み要求の取消完了を意味しない。grantテーブルは tests/fixtures の試験専用schemaであり、本番migrationではない。再発行・保持・削除と初期grantの具体的な運用は未実装。

試験は架空Google署名とローカルD1だけ。実利用前には対象の在籍判断と限定承認・取消方法、初期operator付与の具体的手順、実DB schema状態、保存データの保持・削除、実端末とログの確認、本番設定と限定配備の検証が必要。実DB照会や変更、権限付与、配備はこの作業の範囲外。

`npm run test:limited` はローカルHTTPSでPCとモバイルを模擬する。`npm test` は既存回帰を含む。テスト用の認証・DB・画面は本番へ配備しない。

OAuth設定不正または削除時のcallbackは、認証パラメータを伴わない同一originの相対パスへ303で戻す。
