# Browser-bound PKCEフローの独立QA

対象はIssue #24、未接続のworker/auth/browser-flow.tsとtest-only fixture。実装者とは別コンテキストでdesign/source/document reviewと独立local実行、公開production拒否確認を実施。実装・テスト変更なし。検証対象SHA256は末尾に記載。

## 判定・指摘修正

最終検証範囲でblocking不具合を確認しなかった。初期レビューでは非同期decrypt前に取得したnowをconsumeまで固定するため、処理中の期限跨ぎが旧時刻で許可され得る点を指摘した。最終版はcrypto後にfresh時刻を読み、時計巻戻りとcookie期限を拒否してからconsumeする。startもchallenge計算後に最終時刻確認を行い、その後は同期returnする。追加clock-sequenceと端数秒cookie期限境界を独立実行した。これはrequest側の判断時刻の検証で、remote DBのcommit時wallclockまで厳密に保証する主張ではない。

固定Google provider・exact canonical HTTPS origin/callback、専用clientID形式と32bytekeyの設定検査、POST+Origin完全一致のstart、Fetch Metadata補助、PKCE S256、JWE dir/A256GCMの暗号化とissuer/audience/iat/exp/maxAge、重複query/cookie拒否、bounded入力、state照合、一度の条件付きD1claimは整合している。provider denialは一度消費して一般結果だけを返す。invalid/unmatched入力は有効attemptを消費せず、別進行中flowのCookieをclearしない。Origin検査を認証やauthenticated mutation用CSRF完成とは扱わない。

BROWSER-FLOW.mdには次の限界が正しく記載されている。単一Cookieゆえ並行startは前のtabを安全側に失敗させ得る。hdは表示hintであり学校在籍認可ではない。start途中失敗でorphan行が残り得てTTLはretentionではない。caller configはtrusted server専用。claimのcode/verifier/nonceはserver-private値であり、test fixtureがJSON化する形をproductionへ接続してはいけない。実providerexchange後の既存Google署名/学校identity検証、account admission/session/CSRF/privateowner、実ログ秘匿gateが必要。

## 独立実行

親の最終run終了通知後、fixtureを自分で再bundleして実行した。

```sh
node scripts/build-test-fixtures.mjs
npx vitest run tests/browser-flow.test.ts tests/oauth-attempts.test.ts tests/worker.test.ts
```

**29件成功、3 files、683ms**。browser-flow13件、attempt10件、publicWorker6件。sandbox許可の範囲でlocalWorkers/D1を使用した。親の83tests/build/dryrun、既存UI38E2Eを独立側で全て再実行したとは扱わない。

実暗号処理とlocalD1でRFC7636既知vector、暗号化Cookie属性/内容、固定providerfields、設定/Origin不正時拒否、改ざん/別key/client/browser/重複/期限/不正payload、単発/20並行claim、provider denial、処理中期限/clockrollbackと端数秒cookie期限を確認。fixtureのCookieはRequest headerとして手動供給し、ブラウザのSecure/HttpOnly/Lax/__Host強制やprovider redirectを実証していない。鍵はlocaltest用メモリ生成で本番鍵ではない。

production worker/index.tsは変更されず、新helperのimportなし。既存production bundle .worker/index.jsにBrowserOAuthFlow/新Cookie名がないことを独立検索した。test-only entryはfixtures専用bundleでありwrangler production mainではない。

## 公開Workerの独立HTTP拒否確認

秘密query/credentialを使わず公開originへ実行:

| Method / path | Status | Set-Cookie | Location |
| --- | --- | --- | --- |
| GET /api/auth/start | 405 | なし | なし |
| POST /api/auth/start（空） | 405 | なし | なし |
| GET /api/auth/callback | 405 | なし | なし |
| POST /api/auth/callback（空） | 405 | なし | なし |

GET /api/healthは200、development-preview、writesEnabled=false。新helperを公開したという結果ではなく、実認証が依然閉じていることを確認した。UI変更なしのためscreenshotは追加していない。

## ソース照合

```text
73870af6b4d77529f2dfa3ffdc559995c3b93cd5a62a4add30d758b52059c08f worker/auth/browser-flow.ts
0f408bb419d96ed62d899cde07f3e0a3f76014c26beff0ee8cf901d55263b937 tests/browser-flow.test.ts
c21e8138d61bc73de05dfa875060a7b3fa9ad46dee873d13196ae595a033fc4f tests/fixtures/browser-flow-worker.ts
ced34e0eeb8e5489bfa19657dbf7426ad23771b0ea9854c3d94dd98c68bc16a5 worker/index.ts
e1537e8c40a89e80ce70466860b10ec8c17d3c4ff2649daec6ff87de63d628ac scripts/build-test-fixtures.mjs
```

## 未実施・残るgate

実Google設定/ログイン、production鍵/credential作成、remote attempt書き込み、real exchange、authenticated session/cookie、sessionfixation/revocation/CSRF、学校在籍/運営、実ブラウザCookiepolicy、Safari/実端末、platform secret-canary/log監査、cleanup運用、学生価値検証は未実施。新schema、remoteSQL、新persistentgrant、R2/契約/設定変更は独立側で行っていない。local replay testsは全OAuthリプレイ防御や公開サービスの完成を意味しない。実ログゲートは未充足のまま。

### Commit correlation

The recorded tested source hashes match source checkpoint `24b18dc900cc75b997408b91a8d8e9672a331ae2` in PR #25. The independent run began against the corresponding working tree; recording the later commit does not change that execution provenance.
