# pending本人の期限付き下書き試用 — 現行仕様の正本

Issue #4。通常の在籍承認・一般ログイン・公開投稿とは別の、既存pending本人1件だけの期限付き私的下書き試用を説明する。現行仕様はこの文書に集約する。[旧active前提案](PROPOSED-LIMITED-DRAFT-OPERATIONS.md)と[初期ローカル設計](LIMITED-DRAFT-LOCAL.md)は superseded の履歴資料であり、現在の試用にactive移行や初期operator付与を要求・推奨しない。

## 現行コードで成立する境界

- [`worker/index.ts`](../worker/index.ts) は一般認証ゲート `OAUTH_HTTP_RELEASE_ENABLED=false` より前に限定試用を接続する。専用入口は `/api/auth/draft-trial`。非公開の `OAUTH_DRAFT_TRIAL` とOAuth設定が有効な場合だけ専用ページ・認証・本人下書きの経路を扱う。通常ゲートがfalseでも、この限定経路には私的保存がある。
- [`createLimitedDraftHandler`](../worker/limited-draft-http.ts) は既存Google署名検証・browser-bound OAuth・opaque session・CSRF・下書き処理を再利用する。HTTP入力やメール文字列だけで対象を指定しない。サーバー設定のaccount/epoch/期限とDB grantの一致、検証済みGoogle subject、pending状態、所有者を確認する。通常のSessionStoreはactive対象、restriction付き試用はpending対象であり、通常権限へ流用しない。在籍承認やoperator付与を行わない。画面内部のphase名 `active` は表示状態で、アカウントのactive移行ではない。
- [`session-guard.ts`](../worker/auth/session-guard.ts)、[`sessions.ts`](../worker/auth/sessions.ts)、[`drafts.ts`](../worker/drafts.ts) は発行・認証・下書きの最終SQLで現在のsession、browser世代、account epoch、所有者、grantの一致・未取消・期限を照合する。grantはDB時計でも確認する。事前の認証成功だけで後続保存を許可しない。
- [`0015_limited_draft_grants.sql`](../migrations/0015_limited_draft_grants.sql) はsingleton/外部キーで同時に最大1行のgrantを定義する。下書きschemaは [`0005`](../migrations/0005_private_article_drafts.sql)。ファイルの存在は、本番への適用・現在の行・権限を確認した証拠ではない。
- 専用assetsは [`build-trial-assets.mjs`](../scripts/build-trial-assets.mjs) で `.trial-assets` から `dist/trial-assets` へ組み込み、既存 `ASSETS` をadapter経由で使う。別の `TRIAL_ASSETS` bindingは現在のproduction entryでは使わない。配備側は `/api/*` と `/trial-assets/*` の両方をWorker-firstにする必要がある。ページ・assetsの表示可否はDB grantを照会しないため、入口表示だけで本人の利用可否を判断しない。

公開catalogは引き続き `is_sample=1` の明示DTOだけ。一般ログイン、記事・作品の公開、公開プロフィール、運営経路はこの試用では開かない。healthの `writesEnabled:false` は公開プレビュー側の表示であり、「限定私的下書きも保存不能」「全APIが読み取り専用」の証明ではない。公開閉鎖はルーティングとローカル拒否試験を併せて判断する。

## 期限・取消・セッション・再発行

| 項目 | 現行実装と運用上の区別 |
| --- | --- |
| grant期限 | parserの受付上限は検証時刻から100時間以内。設定された絶対期限を自動延長しない。100時間は現在の実期限、毎回の利用保証、再発行の承認ではない。実値は非公開の運用記録で管理する。 |
| session期限 | 最長8時間、かつbrowser context・grant期限の短い方まで。最後の有効な認証から30分のidle制限もある。Cookieが残っていても有効性はサーバーで再確認する。grant有効中の再ログインも新しい明示的認証であり、8時間連続の利用を保証しない。 |
| 取消 | DB grantの `revoked_at_ms` が正本。認可された対象・期待epoch・未取消状態を条件とする更新が確定して初めて取消完了とする。DBで取消が先に確定した発行・認証・最終下書きSQLは拒否する。既に確定した保存は遡及しない。 |
| 設定停止 | runtime設定の削除・無効化は入口や新しい処理を閉じるが、それだけで既にbind済み要求の取消完了を保証しない。配備の巻き戻しもDB取消や消去ではない。 |
| 結果不明 | 取消・配備等の結果を成功扱いせず、許可された最小の読み戻しで実状態を照合するまで同じ操作を重ねない。承認された対象・範囲を越えて照会しない。 |
| 再発行 | 独立した対象・期限・失効確認と承認が必要。古い未取消grantの上書きや `revoked_at_ms=NULL` での復活を推奨しない。既存sessionが新grantで復活しないことを検証した具体案が必要で、現行の文書は再発行コマンドやepoch操作を承認しない。active/operator付与を再発行の代用にしない。 |

取消・再発行・設定変更の管理UIやセルフサービスは提供していない。この説明だけを根拠に本番SQL・権限操作を実行しない。

## 未保存入力・保持・削除

[`AccountSessionLab`](../src/editor/AccountSessionLab.tsx) は、通信不明時・hidden/pagehide時に未保存入力をこのページのメモリ内に保持して隠す。復帰後の新しい同一session確認で再開する。旧応答の成功・失敗・finallyは新しい確認を終わらせず、別session・確定失効・logout時は旧編集画面を破棄する。ページを閉じる／再読み込みすると未保存入力は失われる。自動保存・別端末同期・OS画像の完全消去を保証しない。[表示競合の修正と試験の限界](QA-DRAFT-SESSION-VISIBILITY.md)を参照。

DBに保存済みの下書きと未保存メモリは別物。grant期限切れ・取消・logoutは保存済み下書きを自動削除しない。本人の下書き削除APIには現在の認証・所有者・期待versionが必要だが、現在の試用画面には削除ボタンがない。期限後にこのAPIで本人が削除できるとは限らず、別の本人確認・認可と運用判断が必要。保持期間、期限後の安全な本人削除・回復、バックアップ／ログの消去は未決・未検証で、試用継続の次の判断として扱う。取消時に勝手にデータを削除しない。

## 証拠を分けて読む

| 種類 | 確認できること | 確認できないこと |
| --- | --- | --- |
| ソースと公開CI | [PR #94](https://github.com/junhat6/kobe-student-hub/pull/94) がpending限定の本体接続・assets包装・100時間上限を追加。[同main CI](https://github.com/junhat6/kobe-student-hub/actions/runs/42355310320) は架空データで成功。[PR #95](https://github.com/junhat6/kobe-student-hub/pull/95) がhidden/復帰競合を修正し、[main CI](https://github.com/junhat6/kobe-student-hub/actions/runs/42365598994) も成功。 | CIは本番DB・現在のgrant・実Google・本人利用・実機の試験ではない。 |
| 配備時の実環境観測 | PR #95のrelease報告では、当該mainのWorker配備版の100%稼働と設定照合、通常の未ログインGETによるhealth ok・試用画面表示を確認した。 | その観測時点の結果であり、現在のDB行・本人ログイン／保存／再開成功を証明しない。今回の文書更新では実環境の照会・配備を行わない。 |
| ローカルの操作QA | PR #94/#95と[QA記録](QA-DRAFT-SESSION-VISIBILITY.md)の範囲で、架空provider・ローカルD1、ChromiumのPC／モバイル幅、実タブ切替を確認した。合成イベントと実タブは区別している。 | 物理iPhone/Safari、実際のpersisted BFCache復元、OS画像消去、本番の一連の本人試用は未確認。 |

入口が表示されること、申請の受付、在籍承認、ログイン成立、保存・再開成功は別々の結果である。コード・画面・CIだけから本番の移行履歴や本人の成功を補完しない。必要な秘密の保護は[LOGGING-GATE.md](LOGGING-GATE.md)で層ごとに扱い、設定一致やログに現れなかった例を完全秘匿の証明にしない。

## 一般公開に向けて残る判断

在籍・卒業・回復、規約と同意、保存済み私的データの保持／削除、運営者・通報・通知・異議、濫用対策、実環境のログ／配信保護、実本人・実端末の一連の操作確認は、それぞれの提供範囲で必要な判断・証拠を残す。[FIRST-RELEASE.md](FIRST-RELEASE.md)は一般提供／公開投稿の残ゲートを整理する。限定試用の成立をこれらの完了、または一般開放の承認と扱わない。
