# 本人限定の下書き試用の撤去

## 判断と範囲

ユーザーの明示指示により、本人限定の試用機能を撤去する。試用を継続するための期限表示・機能追加は行わない。アプリ本体の目的とPRD原文は変更しない。

専用ログイン画面・client、試用向けeditor分岐・削除UI、専用Vite入口・梱包・起動コマンド、productionの限定handler／runtime設定による有効化を除去する。共有のローカル編集・公開・セッション可視性制御と、閉じた通常認証・所有権・下書き基盤は維持する。

適用済みmigrationや共通アカウント／認証スキーマは巻き戻さない。旧restricted sessionの拒否・失効・最終SQLの回帰はtest-only helperに残す。これは製品の試用入口ではなく、fixtureを配備するコマンドもない。

## 受入条件

- 旧 `/api/auth/draft-trial` と `/trial-assets` 以下は、古い有効設定・Cookie・静的ファイルが残っていても404/no-storeで、DB・ASSETS・providerに触れずCookieを発行しない。
- `/trial-assets` とその子パスはWorker-firstの拒否経路に残す。SPA fallbackや残ったファイルを配信させない。
- 通常認証のsource gateはfalseのまま。古い試用設定ではprivate read/write、bootstrap、command、loginを再開できない。遅れたcallbackはqueryを落とす既存のclean redirectだけを返し、DB/provider/Cookieを使わない。
- 正常な公開サンプルの一覧→記事→投稿者、既存ローカルeditorとsessionの回帰を維持する。専用試用の成功テストは撤去後の拒否テストへ置き換え、無関係な検証を削らない。

## 本番の撤去

ソース撤去と、既存試用の失効・runtime設定除去を別々に確認する。専用target・現在の設定指紋・実schemaを非公開で照合したうえで、対象pending account／epoch／grantが一致する行だけを失効し、対応する既存sessionだけを失効する。アカウント・browser context・他の利用者・共通OAuthの秘密を削除／変更しない。

他のbindingは値を取り出さずinheritできるAPIを使い、試用bindingだけを除去する。最新uploadと配備中versionの一致を確認し、同時変更があれば止める。Worker配備はgreen mainの隔離buildで行い、古いassetsを含めない。前後の設定・binding・asset経路・配信版と実URLを照合する。実施結果はPRに記録し、個人情報・試用設定値・生の運用データは公開しない。

これは共通アカウント削除やバックアップ／ログの消去保証ではない。実Google操作や本人データの削除を、架空fixtureのQAから推測しない。

## 証拠と次の判断

[独立QA](QA-RETIRED-DRAFT-TRIAL.md)・[EVIDENCE](EVIDENCE.md)・[WORK](WORK.md)と撤去PRを参照する。学生価値の検証は未実施で、試用機能の撤去自体を学生の価値向上の証明としない。次の改善は記事・作品・経験共有の本来のjourneyに戻って選ぶ。
