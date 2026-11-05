# OAuth callback Cookie ownership — independent QA

2026-11-05。独立コンテキストで baseline `9990116b9e1aa64672e8bcb19d06a2930f6f2d47` との差分、HTTP adapter、broker、browser claim、テスト fixture を確認した。実 Google、実 credential、remote DB、設定変更、デプロイは使用していない。

## 判定と範囲

修正は adapter の無条件 fallback clear を削除し、broker が非 null の結果を返した場合だけ、その結果の clearCookie を返す。state と現在の sealed Cookie が不一致なら claim は null になり、ログイン・登録のどちらでも一致しない応答には Set-Cookie が付かない。303 の clean root、空 body、no-store / Vary Cookie / no-referrer 等の既存ヘッダーは維持する。matching denial や交換失敗は、消費済み attempt の結果として Cookie を消去する。失敗結果は非 null なので登録へ fall through しない。登録 purpose で login claim が null の場合のみ登録 claim に進む。

baseline source の `result?.clearCookie??CLEAR_ATTEMPT` が、A start → B start → B Cookie を伴う stale A callback でも clear を出していたことを独立確認した。旧 fixture の実行による再現は開発担当の非公開記録であり、本 QA は旧版失敗を独立再実行したとは主張しない。

## 実行

`node scripts/build-test-fixtures.mjs` を実行後、以下を独立実行した。

```text
npx vitest run tests/oauth-http-cookie.test.ts tests/oauth-http.test.ts tests/oauth-http-independent.test.ts tests/browser-flow.test.ts tests/google-login.test.ts tests/pending-registration.test.ts tests/session-http.test.ts
7 files / 67 tests passed, 11.03s
```

最初の sandbox 内実行は Miniflare の loopback listen が EPERM となり、67件 skipped。ローカル listener の実行許可後、同じコマンドで上記の全件成功を確認した。

Cookie jar の9ケースは、すべての応答の getSetCookie を適用して次の request Cookie を作る。A/B の後の stale A、B 完了、matching denial / exchange failure と既存 session 保全・新規 start、完了済み callback replay と新しい B / 既存 session、8同時 callback と4 replay、malformed / missing / duplicate query / fragment、login / registration purpose の組合せを検証する。

独立 QA は2ケースを追加した。DB prepare を fixture で拒否して claim が null になった際の attempt / session 保全と復旧後 B 成功、および missing / duplicate / oversized Cookie ヘッダーで B を保全し最後に正常完了できることを確認した。これらの失敗中は token exchange が増加しない。エラー body、Cookie 内容、署名鍵、token は本記録に収録しない。

production entry の source gate は false、health writesEnabled も false。broker、browser flow、schema、production gate に差分はない。追加テスト以外の製品 source を QA は変更していない。

## 限界

この修正が保全するのは、request の現在の Cookie に一致しない callback である。matching A request が先に claim 済みで、その後の B start より A の clear 応答が遅着する場合は、同名 Cookie の clear が B を消せる。HTTP Set-Cookie は現在値を条件に削除できず、この応答順序競合の全面解決は本修正の範囲外。同時テストは同一 attempt の atomic winner と loser の無書込みを検証するもので、あらゆるネットワーク到着順序を再現しない。

DB claim 例外は browser flow が捕捉して null とするため Cookie は保持する。DB の更新が成功して応答だけが失われた場合は attempt 消費状態が不明になり得るため、同じ attempt の retry 成功は保証しない。claim 後の交換・session 作成失敗は broker の failed 結果として clear する。adapter の例外 catch 自体は変更しておらず、null では clear しない。既存 session の Cookie / DB row を callback の失敗や replay が取り消す仕組みは追加していない。

これは server-only ローカル fixture の動作確認であり、実ブラウザの Cookie 実装、実 Google sign-in、platform logging secrecy、学生価値検証の証拠ではない。実認証の release gate は未解除。

## 検証対象 SHA-256

| File | SHA-256 |
| --- | --- |
| worker/auth/oauth-http.ts | 593708982f829605a9d41949bf88182ca1d95d3407ba10d85f2059b32c6a10f8 |
| worker/auth/google-login.ts | c5e1217a2c78b6069b2d20de0c0c57470671fd8b95715c0419b8a1642859be11 |
| worker/auth/browser-flow.ts | 8441c45c1e4709e1009981256b61cba1168ef3b71d8739e61007b9b17f5b30d1 |
| tests/oauth-http-cookie.test.ts | 37bea405e0cc46ac0373a11cbeeb5bb9bc53d9fd99cbd33f2157d9c4730203f2 |
