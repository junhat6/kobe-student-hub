# Googleコード交換の独立QA

対象は未接続GoogleLoginBrokerとlocal test-only integration。実装者とは別コンテキストでsource/document review、fixture再bundle、localWorkers/D1実行を行った。実装・テスト変更なし。provider/JWKSネットワーク応答はstubだがRSA署名生成・検証と既存PKCE/JWE/D1/sessionの実処理を使う。実Googleとの交換結果ではない。

## 判定・レビュー指摘

最終検証範囲でblocking不具合は確認しなかった。固定token endpointへPOST formでのみcode・stored verifier・exact redirect・server client/secretを送り、stateのatomicclaimを交換前に終える。返却ID tokenは既存Google RS256/JWKS verifierによるissuer/audience/nonce/email_verified/hd/domain等の検証を経て、既存active accountだけにopaque sessionを発行する。unknown/pending accountを自動作成・active化しない。access/refresh payloadを保存・公開しない。

レビューで2点の検証不足を指摘し、実装者が修正した。

- redirectのgeneric failureだけでは誤って外部へfollowした場合もpassし得る。最終テストはoutbound destinationを記録し、302後の実送信先が固定token URLの1件だけであることをtest本体でassertする。Workerdのmanual redirectを使い非成功/redirected応答を拒否する。
- Abort timerだけでbody read/cancelまで確実に応答を返せるとは証明できなかった。最終版はfetch+body取得だけを5秒deadlineとraceし、abort/late response破棄、cancelはhandled best effortでawaitしない。署名検証とsession作成はrace winnerの後だけなので、timeout敗者の処理が後からsessionを発行するchainにはなっていない。stalled header/body/cancelの実テストを追加した。

bodyはContent-Lengthだけでなく実stream byte数32KiBで制限し、UTF-8/JSON不正・id_token欠落・token自体の上限/形式を拒否する。失敗結果は一般kindとattempt cookie除去だけ、内部provider errorやidentity/code/tokenを反映しない。claim済attemptは失敗後に復活させず、新startが必要。

## 独立実行

実装者のready通知後に共有fixtureを自分で再bundleし実行した。

```sh
node scripts/build-test-fixtures.mjs
npx vitest run tests/google-login.test.ts tests/browser-flow.test.ts tests/sessions.test.ts tests/worker.test.ts
```

**41件成功、4 files、10.70秒**。provider10、browser13、session12、publicWorker6。localWorkers/D1実行用sandbox許可のみ使用。親のfulltest/UI E2Eとは独立実行範囲を区別する。local persistent D1へ操作せず、Miniflare隔離DBのみを使った。

正しいform/PKCEとreal署名からactive account session、foreign signature・誤nonce・誤学校identity拒否、不正設定時DBwrite/claim前拒否、providerエラー/redirect/no-follow/不正JSON/欠落/宣言長と実stream上限、provider denial、unknown/pending account非作成、12同時callbackで交換1件を実行した。

stalled headersとstalled bodyは各4500ms以上6500ms未満でgeneric failureとなるassertを通過し、再claim不可。cancelが終わらない上流でも2秒未満でfailureを返すassertを通過した。これはlocal fixtureでのtoken交換/読込deadlineの証拠であり、後続JWKS・D1を含むcallback全体の5秒保証ではない。既存JWKS取得には独立した5秒timeoutがある。

production worker/index.tsは変更されていない。production .worker/index.jsにbroker/new session Cookie/token endpointの識別子がないことを独立検索した。fixtureのprivate JSON identity/cookie/CSRFを公開endpointへ接続してはいけない。UI変更なしのためscreenshotは追加していない。

## 文言と未提供の境界

GOOGLE-LOGIN.mdは5秒交換budgetとJWKS独立timeout、activeadmission別、private result非公開、両Cookieを別々に設定する将来controller責務、clean redirect/no-store/log gateを正しく区別する。DEPLOYMENTはremote0004未適用と現publicWorker未接続を明記し、build/CIをremote適用と扱わない。

実Google client/secret/鍵の作成や設定、remote0004/attempt/account/session書き込み、実Google交換、ブラウザredirect/Cookie強制、realenrollment/卒業policy、実platform secret-canary/log監査、投稿/所有者/下書き/media/moderation、学生価値は未実施/未提供。new persistentgrant、R2/契約/remote設定も操作していない。timer/no logger/localfixture成功は実ログ秘匿や公開可能品質の証拠ではない。

## 対象SHA256

```text
4e6d8e8297fa11424582ef02477bd807c19d30abb9803243237d92c967c4b413 worker/auth/google-login.ts
a92272c0a9a07c03a1d9d469ddafdb4fd7a96ec518e2ee4880ded579dd9139d3 tests/google-login.test.ts
8b5bf007f44866d304a26a2aeb971eefaab0e1e2009508ddf10f4e9e4e9c76ec tests/fixtures/google-login-worker.ts
ced34e0eeb8e5489bfa19657dbf7426ad23771b0ea9854c3d94dd98c68bc16a5 worker/index.ts
```
