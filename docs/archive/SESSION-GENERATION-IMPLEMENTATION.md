# ブラウザ世代によるセッション保護 — 認証公開前の実装

2026-11-05、Cycle49。設計PR84・閉じたD1/HTTP検証PR85を基に本体の非公開部品へ適用した。**実Google接続・実ユーザー提供・remote migration・デプロイではない。** `worker/index.ts`の`OAUTH_HTTP_RELEASE_ENABLED=false`を維持する。実鍵、credentials、権限、実データ、本番設定・DBは変更しない。

## 棚卸しからの変更

独立した[認可SQL棚卸し](QA-AUTH-GUARD-INVENTORY.md)で9リポジトリの48 SQL箇所（私的36／明示した公開12）を分類した。重複していたlive条件を`worker/auth/session-guard.ts`へまとめ、全私的SQLで同じpredicateとbindingsを使う。作品公開前の下書き読取にも、所有者だけでなく最終認可を追加した。静的な箇所数の検査と、各領域の読取／更新でpreflight後にcontext世代を変える実D1試験を併用する。公開用のSQLは本人認証の代わりに既存の公開状態・サンプル境界・DTO条件を維持する。

共通guardはtoken hash、account ID、request context hash、現在context generation、contextの作成・期限、account active/session_epoch、revoked、sessionの作成・最終利用・idle・absolute期限を確認する。私的proofはclockも保持し、最後のSQLへbindする際に時刻を取り直す。時計が安全整数でない／巻き戻った場合は拒否する。これはWorkerからSQLを送る時点の時刻であり、DBエンジンのcommit時刻や、既に確定した操作の取消を保証するものではない。

## ブラウザとHTTPの契約

- `POST /api/auth/bootstrap`は同一Originの空コマンド。匿名contextだけを一度発行する。既存有効contextを再発行・refreshしない。host-onlyの`__Host-kobe-browser`はSecure/HttpOnly/SameSite=Lax、最大8時間。受領後の明示操作からstartを行う。
- `POST /api/auth/command?action=login|pending-registration`はcontext/action/発行時generation/失効順序stamp/最大60秒に結び付いた一回用nonceを返す。actor・学校メール・sessionは返さない。start/registerは`Authorization: Bearer command.<proof>`を必要とする。旧customproofheaderへのfallbackはない。[現在のproof transport](AUTH-PROOF-TRANSPORT.md)を参照。
- nonceの条件付きUPDATEとtriggerがgeneration更新・attempt作成を一つのDB操作へ結び付ける。新しいstartは同じcontextの古いsessionと保留attemptを無効にする。Google取消や失敗で以前のsessionへ自動復帰しない。古いnonceの再送からCookieを再発行しない。
- callbackは従来のJWE/state/browser binding/PKCE/nonce/purpose/署名検証を保持する。DB claimを獲得した一つのownerだけが完了でき、最終session INSERTが現在のcontext/generation、失効方針、active accountを再確認する。attempt単位のUNIQUEと完了markerで重複発行を防ぐ。callbackは試行Cookie・context Cookieを書き換えない。
- 古いA成功応答のsession CookieがB完了後に届いても、Aのgenerationが古いので認証・私的SQLは拒否する。**ブラウザのCookie上書きそのものを防ぐ保証ではない。** Bのsessionを自動再発行せず、明示した新しいログインで回復する。
- `POST /api/private/logout`は、従来の有効session CSRFに加え、`POST /api/private/logout-command`で得たcontext/action-bound nonceでも実行できる。後者はsession Cookieが古くても、同じbrowser contextの保留試行を取り消せる。nonceのexpected generationが既に変わっていれば拒否する。完了済みnonceの再送はacknowledgmentだけで再更新しない。
- logoutの世代更新が確認できなければ成功と返さない。成功時もSet-Cookie削除を出さず、遅延応答で後のsessionを消さない。Cookie内に残る失効tokenはサーバーで受理しない。別のbrowser context／端末をまとめてlogoutしない。
- 私的session DTOはCSRFだけのまま。DB不明は503、確認済みの無効sessionは401。UIは私的入力を閉じ、明示した新しい認証と確認・続行が済むまで古い編集を再利用しない。自動再認証や古いフォームの別本人への引継ぎは行わない。

## 本人未確定の試行をどう失効するか

当初案の「誰かのaccount失効で全保留試行を失効」は採用しない。[比較と独立レビュー](PENDING-ATTEMPT-REVOCATION.md)に従い、global revisionは順序stampとしてだけ使い、最終的に判明したGoogle subjectの最新失効floorと比較する。

session_epoch変更、status変更に伴うepoch変更、account削除が、そのsubjectのfloorを原子的に進める。callbackでまだ本人が不明でもclaim自体は可能で、本人判明後のsession／pending受付の最終SQLが古い本人の試行を拒否する。**他の学生の実行中・保留ログイン、登録受付、既存sessionを一律に失効させない。** logoutはbrowser contextだけを進め、このsubject floorを進めない。現行の公開／私的APIに任意accountのstatus/epochを変更する機能は追加していない。

削除後の再登録・同じsubjectの再作成で古い試行が復活しないよう、私的なsubject＋最新floorを一時保持する。メール、表示名、完全な履歴は保存しないが、これは本人識別情報であり匿名化とは呼ばない。古い未期限切れcommand/attemptが残る間は保持し、不要になったfloorを一回最大100件、後続bootstrap/command時に削除する。元のcommand stampはattemptへ引き継ぎ、60秒commandの後に600秒attemptを作り得るため、単純に失効から10分で削除する方針ではない。

削除時に永続的なminimum stampを原子的に進め、時計が戻っても削除済みfloor以前のcommand/claim/完了を拒否する。quietなサービスでは次の認証操作まで識別子が残り、SQL読取量は累積データ・同時試行数で増え得る。**物理削除のSLA、負荷／query plan、濫用時のレート制限と運用は未完了の公開前ゲート。** 自己削除・運営の大量status変更等を提供する前に保持と実行負荷を確認する。他学生の強制再ログインは避けても、DoS対策が完成したという意味ではない。

## migrationと互換性

`0012_browser_session_order.sql`は追加のlocal準備。context/command/floor状態、既存attempt/sessionへのnullable列・trigger/indexを追加する。既存のaccount、下書き、公開記事、プロフィールを削除／公開しない。既存sessionはupgrade時に失効させ、contextのない旧rowを許すfallbackは置かない。従来のactive/epoch/revoked/idle/absolute条件も共通guardに残す。sessionの絶対期限は既存8時間とcontext残存寿命の短い方で、idle活動によって延長しない。idle最終利用の更新は維持する。

旧schemaでは失敗を閉じ、勝手なmigrationや架空identityで復旧しない。test-only helperだけが架空データのschemaとcontextを準備する。productionはschemaを自動変更しない。実migrationは対象・backup・差分を別途確認する操作であり、今回実施していない。将来の認証有効化後に、generationを無視する旧認証コードへdowngradeしてはならない。SQLロールバック、追加列の部分適用防止、旧row失効とデータ保持は[独立migration QA](QA-SESSION-GENERATION-MIGRATION.md)を参照。

## 検証と残条件

- [SQL棚卸し・全9領域の最終認可QA](QA-AUTH-GUARD-INVENTORY.md)：静的棚卸しと各privateリポジトリの実D1競合、計108件通過（その後、新規リポジトリの未分類防止も追加）。
- [migration・subject floor・時間のQA](QA-SESSION-GENERATION-MIGRATION.md)：15件通過。削除／再作成、他学生の試行継続、pending受付、100+5件GC、clock rollback、失敗時のwatermark rollback、preflight後の期限・時計巻戻り、期限切れattempt削除後の有効session維持を含む。
- [実Chromium HTTPS QA](QA-SESSION-GENERATION-BROWSER.md)：5件通過。実際の遅延Set-Cookie、401、明示再ログイン、logout競合、別端末context、Cookie属性と実AccountSessionLabの入力閉鎖／続行を確認。架空providerであり実Googleや物理端末ではない。

全体の最終実行・CI・main反映状態はEVIDENCEを参照。新しいブラウザ試験をCIへ追加し、テスト用HTMLや文書が公開CSSへ混入しないようTailwindの検出をsrcへ限定した。fixture用のビルドとSQL Text ruleはlocal editor構成だけで、本番設定は変更しない。

これらは認証を閉じたmainへ統合する判断材料。実Google、実鍵・DB、在籍／卒業・回復、privacy/retention、レート制限、platform logging、実運営・端末・学生価値の既存ゲートは未完了。認証公開の承認・実サービス完成とは扱わない。
