# セッション応答順の設計比較 — 実装前レビュー

2026-11-05。PR83の実装を置き換えるコードではなく、閉じたモデルによる候補評価。認証ゲート、Worker、DBスキーマ、Google、鍵、権限、実データ、配信設定は変更しない。既存の実装では古い成功応答のセッションが受理されるため、認証公開停止を継続する。

## 問題と保証の範囲

同一Cookie名の応答はリクエスト開始順やサーバー処理順で適用されるとは限らない。[RFC6265 §4.1.1/§5.3](https://httpwg.org/specs/rfc6265.html#storage-model) は並行Set-Cookie応答の競合と、名前・ドメイン・パスによる置換を定義する。古いAの成功ヘッダーがB完了後に届くと、現行実装では有効なAトークンへ戻る。Cookieのブラウザ内compare-and-swapを前提にしない。

目標は**古いヘッダーの適用を防ぐことではなく、古いトークンを誤った利用者としてサーバーが受理しないこと**。同じブラウザコンテキストについて、最後にサーバーで確定したstart/logoutを世代境界とする。人間のクリック時刻やネットワーク到着順を推測しない。Bへの切替が確定する前に権限検証・読取／書込を終えたAの処理は取り消せない。既に受信した私的データの消去や全タブの瞬時同期も保証しない。既存UIの隠蔽・世代ガードは引き続き必要。

現行のSessionStoreはトークン、active、アカウントsession_epoch、失効・idle/absolute期限を確認するが、ブラウザ単位の最新世代は持たない。新しいログインでも古いセッションは独立して有効。private repositoriesの最終SQLにもlive条件が重複しているため、SessionStoreだけの変更では不十分。現行logoutは現在トークンのCSRFで現在トークンだけを失効させる。候補のコンテキスト世代logoutはこの仕様を変えるので別途レビューが必要。

## 比較

| 候補 | 古いAの受理防止 | 損失・限界 | 判断 |
| --- | --- | --- | --- |
| 現行callbackで毎回ランダムsession | 不可。古いAも有効 | BからAへ戻る | 不採用 |
| ブラウザmutex、BroadcastChannel、fetch取消 | Cookie適用や別タブ・再起動をサーバーで保証できない | 補助UI用途に限定 | 単独では不採用 |
| callbackからsession発行を外し、同一originのfinalizeでCAS | 既にCASに勝った古いfinalize応答が遅れて届くため単独では不可 | 意図確認UIには使えるが世代検証が別途必要 | 最小案には追加しない |
| アカウント全体session_epochを毎回更新 | 同一アカウントには効くがAとBは別行 | 別端末を不必要に失効、別利用者競合は残る | 不採用 |
| 安定Cookieをそのまま認証sessionへ昇格／コンテキストから自動再発行 | 古いCookieを復元できても固定化・窃取時の権限昇格が危険 | 匿名識別子が再利用可能な認証能力になる | 不採用 |
| 端末鍵とリクエスト署名、UI側期待世代 | 大きな別プロトコルが必要。鍵・bootstrap・全経路検証が必要 | 復旧・端末移行・XSS・実装範囲が広い | 現時点の最小案ではない |
| **匿名コンテキスト＋サーバー世代＋全経路検証** | 同一コンテキストの古いAを拒否。コンテキスト不一致も拒否 | 古いCookieで一時ログイン喪失、start失敗でも以前のsessionを失効 | **次の実装検証に進める最小候補。未実装・未公開** |

## 最小候補の契約

1. **匿名bootstrapを分離する。** コンテキストのないブラウザへの専用同一origin POSTは、新しい予測不能なコンテキストを発行するだけで、attempt、本人情報、sessionを一切作らない。Secure/HttpOnly/host-only/適切なSameSite、private/no-storeとCSRF防護を要求。Cookie受領後の次の明示操作からstartを許す。無効／不明な既存IDを受け入れたり、そのIDで行を再作成したりしない。
2. **同じコンテキストCookieは再発行しない。** 通常start、callback、session検査、logout、refreshでコンテキストのSet-Cookieを出さない。bootstrapは常に新規IDを一度だけ返し、既存IDの再送や同じ応答の再利用をしない。期限延長・rotationは今回の最小プロトコルに含めない。Cookie削除／期限切れ時は別の匿名bootstrapへ戻り、古いsessionとの組合せは拒否する。
3. **startを世代境界にする。** コンテキストの同一origin/action-bound CSRFを確認し、世代を原子的に増やし、そのUPDATEが返す世代とコンテキストにattemptを同一トランザクションで結び付ける。別SELECTで「最新値」を読み直して別attemptへ誤結合しない。上限overflowは拒否。新しいstartは古いsessionを即座に無効にする。Google取消・失敗でも古いsessionへ戻さないため、開始前に未保存入力とログイン喪失を説明する必要がある。
4. **callbackはattemptを一回消費し、最終session INSERTで再確認する。** requestのコンテキスト、既存のstate/browser binding/PKCE/nonce/purpose、有効期限を検証。provider交換中にstart/logoutが進めばsessionを発行しない。最終INSERTはattemptに固定されたcontext/generation、現在世代、active/account_epochを同時に確認する。ランダムsessionトークンは毎回新規。既存のprovider検証・一回消費は省略しない。最終INSERTが成功しても遅延ヘッダーは起こり得る。
5. **認証のたびに現在世代を確認する。** token rowのcontextとrequestのコンテキストCookieが等しく、token generationと現在のcontext generationが等しいことを、従来のaccount epoch・active・失効・期限と共に確認。contextだけではactor、session、回復トークンを返さない。private read/writeの最終SQLにも同じ条件を入れる。preflightの成功だけを後の更新権限にしない。
6. **logoutはsession Cookieの正しさに依存しない。** 同一コンテキストの独立したaction-bound CSRFで世代を原子的に増やし、保留attemptと既発行sessionを失効させる。古いsession Cookieに置き換わっていてもlogoutできる。contextだけを知る者に認証権限を与えない。失効後の古いsession Cookieは認証に使えないため、遅延clearヘッダーを新しいログインに適用しないよう、最小案ではlogoutのCookie削除も行わない。暗号化されていないランダムtokenが元の期限までブラウザに残る保持・ログ上の影響は要レビュー。撤回済みトークンのサーバー再受理は禁止。
7. **回復は明示した新しい認証。** stale/mismatchは私的内容を返さずsigned-out、DB不明は503/unavailableとし、確認済みlogoutと扱わない。コンテキストからBのsessionを自動再発行しない。利用者が新しいログインを選び再検証する。自動で昔のCookieを消したりBへ戻したりすると別の応答競合を増やす。フォーム／クリップボードの扱いと手動再開は既存UI境界の下で設計する。

想定する追加状態は匿名context(id hash, generation, csrf proof hash, expiry/tombstone)、attemptのcontext/generation、sessionのcontext/generation。これは設計上の列の説明でありmigrationは作成していない。署名・暗号化・token形式・CSRF形式は既存検証との組合せを次の実装計画で具体化する。context proofの取得経路はrequestの厳密な一つのCookieにだけ結び付け、同一origin・CORS非公開・no-store・入力サイズ制限を要求し、actor/emailやsession再発行能力を返さない。start用とlogout用を区別し、古いproofが別context／別actionで使えないことを検証する。モデルの文字列は資格情報ではない。

### bootstrap競合の根拠と限界

二つの無Cookie bootstrapがC1/C2を発行する場合も、それぞれの応答はコンテキストCookieだけを発行する。C1のログインsessionを作るには、その唯一のC1 bootstrapヘッダーが既にブラウザへ適用されている必要がある。従って**まだ一度も適用されていない遅延C1 bootstrapは、既に発行済みのC1 sessionを同時に復活できない**。C2のsessionに遅延C1 Cookieが重なると不一致でsigned-outになる。以後のC1での明示ログインは新たな操作。

この説明は、同じcontext Cookieを再発行しないこと、bootstrapの応答をキャッシュ／再利用しないこと、ブラウザが一つの応答ヘッダーを一度だけ適用することに依存する。既存contextをrefreshする応答が遅延すれば、古いcontext＋古いsessionを同時に復元できる反例をfixtureに残す。応答の再送／プロキシ／Cookie期限・全Set-Cookie emitterを実HTTP・ブラウザで確認するまでは証明済みと呼ばない。Cookie一式の盗難・手動復元・端末バックアップ復元は通常のbearer credential再利用問題であり、この順序モデルでは解決しない。

### 端末・logout・replay・整合性

- 同一ブラウザprofileのタブは同じcontextの世代を共有。別端末は別contextで互いのstart/logoutを失効させない。account session_epochによる全端末失効は独立して残す。contextだけを窃取した者による世代変更DoSは残存リスクで、レート制限・検知・回復を後で具体化する。
- 遅れて**サーバーに到着したlogoutコマンド**がB開始より後に確定すればBも失効する。これは「最後に確定したコマンド優先」の契約。古いlogoutの意味を開始時刻へ戻さない。なお現モデルのaction-CSRFは一回限りではなく、完了済みlogoutを再送すると後のBもsigned-outになる。誤った本人の受理にはならないが、可用性の問題として残る。startの二重送信にも同種の失効が起こる。実装前にcontext/action-bound command nonceと結果の永続化による冪等再送、またはexpected-generation付きの拒否・再確認を選ぶ。DB結果不明時の再試行もこの設計に含める。遅延logout**応答**にはCookie更新がないため新しいBを壊さない。
- attempt replayは既存の一回消費で拒否。session replayは現在世代／context／account状態／期限で拒否する。contextが削除・期限切れなら拒否し、受信した古いIDでepoch0を再作成しない。session固定化を避け、匿名contextを認証トークンへ昇格させない。[OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) の認証時session更新、サーバー失効、Cookie属性の要求を維持する。
- 全認可読取は最新の権威ある状態に基づく必要がある。[D1公式の整合性説明](https://developers.cloudflare.com/d1/best-practices/read-replication/)ではreplicaが遅延し得る。古いbookmarkやunconstrained replicaを最新世代判定に使わない。現行primaryへの経路を保持し、将来Sessions APIを使う場合も各認可のprimary読取／最終SQL時点の保証を実D1で検証する。アプリのsessionとD1 Sessions APIは別概念。

## 閉じたfixtureと次の検証

`tests/fixtures/session-order-model.ts`はin-memoryの状態機械で、各メソッドを原子的DB操作と仮定する。暗号、provider、HTTP、Cookie属性、SQL、実D1整合性、実ブラウザ、UI/端末を証明しない。`tests/session-order-design.test.ts`の15ケースは古いAヘッダー拒否と明示回復、交換中の世代変更、start失敗時のログイン喪失、stale Cookie下のlogout、logoutコマンド／応答差、最終write再検証、端末分離、account-wide失効、context単独拒否、replay/expiry/deletion、DB不明、bootstrap分離、遅延bootstrap、禁止したrefreshの反例、二つのbootstrap/start/issue/headerの70通りの因果順序を検査する。反例テストは危険な状態の記録であり安全な実装の成功ではない。

実装前の判断：**この契約を最小候補として報告し、まだappへ実装しない。** 独立レビューとモデルが支持する範囲は限定的。次に許可する実装単位は、ローカル専用D1/HTTP fixtureに限定した原子性・CSRF・Cookie発行箇所・全private SQLの監査と逆順テスト。その結果を再レビューしてから本体変更範囲を決める。実認証の有効化はさらに実Google・ログ保護・資格・運営の既存ゲートを満たした後。

未完了：実SQLのトランザクション設計と二重claim、全private read/write条件、first-use実ブラウザ/HTTP再送、context寿命と保持/cleanup、token/CSRF形式、start/logoutの一回限りcommand／冪等再送、レート制限、UIのstart/logout警告と復旧、私的応答の遅延到着、実プラットフォームログ。**安全性を実証した実装や認証公開承認ではない。**
