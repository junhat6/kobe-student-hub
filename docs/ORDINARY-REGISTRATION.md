# 通常の登録と本人の年度確認

これは通常のアプリ本体へ接続したローカル準備で、本番の登録受付ではない。実際の画面entryは`src/main.tsx`、登録条件は[自己申告年度のADR](adr/0001-self-declared-enrollment.md)。新しい本人限定試用やlabを作らず、既存の8790合成認証環境で同じ本体entryを検証する。

## 通常の導線

- `/signup`: 初期値を推測せず、非公開の入学年度・卒業予定年度だけを必須入力する。年度は4月から翌3月までで、3月卒業の例を入力欄に添える。Googleの氏名・写真・メールは公開プロフィールへ自動反映しない。
- `/login`: 登録済みの学校Googleアカウントで続ける。年度の再入力やaccount作成は行わない。
- `/account`: 現在のsessionを確認し、そのsessionに結合した年度の読取・訂正・logoutを提供する。登録画面に既存の有効sessionがあれば、Googleを再度求めずこの画面へ進む。

3ルートはcatalogの取得・障害から独立する。登録とloginは明示操作からbootstrap→一回限りのcommand→register/startへ進む。clientは合計10秒、4096bytes/chunksとEOFを境界にJSONを読み、固定Google origin/path・callback・各protocol値を確認してから移動する。command／CSRFのproofはAuthorizationにだけ置き、年度・本人情報・proofをbrowser storageへ保存しない。

通常ブラウザのcallbackは成否とも固定clean `/account`へ303とし、caller指定のreturnTo・結果query/hashを採用しない。着地だけで登録成功と表示せず、serverの現在sessionとguarded年度readを確認する。legacy adapterの既定のroot着地と、旧pending pilotの専用着地は互換性のため分ける。

## 不明な結果と入力の保持

開始中の重複操作はUIの同期latchで拒否する。取消・期限・遅着・移動失敗で自動再送せず、入力を保持して明示的な状態確認へ進む。ログインが確認できた場合は本人のaccount画面へ、401の場合は入力を確認して新しく開始する操作へ進む。確認不能だけを理由に二度目のGoogle操作を自動実行しない。

Googleへの移動中止やbrowserの戻る／pageshowも結果不明として扱い、消費済callbackを再送しない。account画面では既存のsession隠蔽・失効・手動確認・明示続行を共用する。同一sessionなら隠した年度入力を再開し、異なるsessionなら前の入力を破棄して続行を求める。通信中止は既にserverへ保存された変更を取り消さない。

## 二つの閉じた公開条件

Viteのbuild-time `__ACCOUNT_UI_RELEASE_ENABLED__`は既定falseで、現在の公開ナビ・サンプル画面に通常accountを出さない。これは画面のvisibilityであり、認証や所有権の根拠ではない。JSの配信物を秘密扱いもしない。

Workerの`OAUTH_HTTP_RELEASE_ENABLED=false`も維持する。future wiringはJSON start応答、固定account着地、本人のenrollment handlerを同じserver gateに結合しており、runtime設定だけで通常認証を開かない。公開APIはsample-only／writesEnabled:falseのまま。旧pending pilotと撤去した本人限定試用の境界は変えない。

合成ブラウザ環境だけがfrontend visibilityをtrueにして、本体と既存Labをmulti-entry buildする。fixtureの署名、token制御、遅延制御、local assets配信はproductionへ輸入・配備しない。実Googleへのnavigationはテストで捕捉し、架空署名と実local Worker/D1のcallbackへ戻す。

実接続前には[実ログ保護](LOGGING-GATE.md)・[一回限りの認証試行](OAUTH-ATTEMPTS.md)・実Google設定とtransport・対象を確かめたremote schema・運営／通知・本人管理など[公開条件](FIRST-RELEASE.md)を満たす。viewport emulation、動作QA、自己申告を、実端末・学生の価値・学校による在籍証明へ置き換えない。
