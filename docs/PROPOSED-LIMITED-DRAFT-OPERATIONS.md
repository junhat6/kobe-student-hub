# 旧active前提の限定下書き運用案 — superseded

この案はPR #91時点のactiveアカウント向けローカル設計の履歴であり、PR #93/#94のpending本人限定試用によって置き換えられた。**現行仕様・継続判断の正本は [PENDING-DRAFT-TRIAL.md](PENDING-DRAFT-TRIAL.md)**。本書は実行手順でも現在の本番DBの確認結果でもない。

旧案は在籍判断、初期operatorの信頼連鎖、pending→active移行の後にgrantを設ける構成だった。現在の試用はpending本人のrestrictionとDB grantを照合する別経路であり、在籍承認・active移行・operator付与を前提にしない。旧案の権限付与・直接UPDATE・migration適用を現在の試用の準備として実行しない。

取消のDB正本、確定済み操作は遡及できないこと、結果不明時の照合、旧session復活を避ける再発行判断、保持と削除の分離という論点は正本へ集約した。migrationファイルやschema提案が存在しても、現在の本番適用状態・対象行・資格は示さない。以前の照会拒否／未実施という履歴も、現在の権限やデータの状態の根拠にはしない。
