# Worker外側の例外境界

## 問題と動作

使用中のHonoの`onError`は`Error` instanceを扱う。binding等が文字列・object・null・別realmのErrorなどでthrow／rejectすると、通常の`onError`を通らず`app.fetch`から外へ出る場合がある。これは未処理例外の経路であり、実際に秘密情報が漏れたという観測ではない。

production entryの外側に`ExportedHandler<Env>.fetch`を置き、`await app.fetch`のthrow／rejectをbindingなしのcatchで受ける。例外値のproperty取得・文字列化・log出力をせず、既存と同じ固定JSONの503へ変換する。fallbackのheaderはprivate／no-store、no-referrer、noindex、nosniffと既存のsecurity baselineを持つ。CookieやLocationを返さない。

通常のErrorは既存`app.onError`で扱う。公開sample、healthの書込み停止、旧試用URL404、通常表示／OAuth／draftのsource gateは変更しない。設定・schema・provider接続の追加ではない。

## 受入条件

- 実際のproduction exportを呼び、同期throw・非同期rejectの文字列／object／null／undefined／別realm Errorを固定503へ収める。
- 外側のcatchでは例外値を読まず、応答・header・consoleに合成の秘密markerを出さない。Hono側で先に走るinstanceof／prototypeの判定とは区別する。
- 通常Errorの既存応答とsecurity headerを維持する。並行する成功／失敗や、応答headerへの変更を別requestへ共有しない。
- 既存の公開sample4件／2人、閉鎖応答・health・旧URL拒否を維持し、実認証・投稿を開かない。

## 実装者の確認

source `aa2f219b1592aa31d3519561250d5b92fc97fd9e`で、実exportの14確認とtypecheck、build、78files／708unit、公開E2E62、localDB、deploy dry-runが成功した。初回typecheckは既存fixtureの2引数呼出しとの互換性を指摘し、`ctx`をoptionalにして訂正した。初回失敗は記録に保持し、成功へ加算しない。所有server／process／待受と一時dependency linkを終了・除去した。

別contextの独立QAは同sourceの3files／31testsとtypecheck・diffcheckが成功。実装者14、既存Worker／D1 10、追加独立7の構成で、Symbol／BigInt、revoked Proxy、prototype trap、DB getter、hostile Error property、成功／失敗の並行を確認した。Honoの先行判定がnative TypeErrorを作るcaseは既存Error応答であり、outer fallback専用headerを期待した初回2失敗をQA期待の訂正として保持した。製品の保護を弱める変更はない。CIと本番配備は実行後に別記録する。

| private evidence | SHA-256 |
| --- | --- |
| 実装者の確認 | `6b1dc2d2c98555d8fbd26248143c7c4b89f3f3a43d0dccdf42b60a4eb9ff952b` |
| 独立実装QA | `69b5a6967fe2659458585617ce9c1c7252cf246f0950e68946955836a3ad018e` |

初期PR CIは既存の削除browser caseの同期counterで失敗した。sourceのouter boundaryは不変で、試験だけを実際のpost-DELETE GET200・保存一覧を待つ形へ修正した。遅延時の成功と、503／GETなし／誤IDの拒否を区別して確認した。[CI失敗と限定再検証](EVIDENCE.md)を保持し、新headのgreen CI前にmerge／配備しない。

## 境界と次の作業

これは`app.fetch`が応答を返す前のthrow／rejectの境界である。応答返却後のstream、runtimeの強制終了、platform／providerの内部処理・ログまでの保証ではない。[実ログゲート](LOGGING-GATE.md)は未達のまま。

source監査では、意図したauthorization URL／Cookie／token formのsink、nonce等の私的DB保持とcleanupの実運用、設定不明時にcallback URLが残る経路も区別した。今回のcatchだけでそれらを解消したとは扱わない。実Google・browser/session・各ログ層と保持運用は別に検証する。
