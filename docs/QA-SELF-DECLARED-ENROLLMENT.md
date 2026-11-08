# 学校Google本人確認と自己申告年度の独立QA

2026-11-08、base main `c03012f013fb47fab18fb7d8ffc64d409e30ceff` からの通常参加準備。採用方針は[ADR](adr/0001-self-declared-enrollment.md)、用語は[CONTEXT.md](../CONTEXT.md)。架空の署名・本人・D1だけを使用し、本番の登録受付は有効にしていない。PRD原文、公開サンプル、production entryと配備設定は変更していない。

## 独立した検証

実装者と別の三つのコンテキストで、writer境界・登録transaction・ブラウザ操作を検証した。以下の独立ケースは通常の全体suiteにも含まれる。

| 対象 | 実行した検証と結果 |
| --- | --- |
| 参加資格の最終確認 | 独立writer12件＋年度policy/store14件の26件成功。未申告・入学前・卒業後、認証後の申告削除／変更、年度終端ちょうど、epoch失効、未来の更新時刻で、11の新規mutation/replay経路を拒否。終端1ms前は許可。拒否後のDB snapshotが不変であることを確認 |
| 本人管理と公開分離 | 卒業後も本人読取・年度CAS訂正・下書き削除・いいね取消・公開停止・logoutと別権限の運営読取を許可。6種類の公開DTOへ年度が出ないことを確認 |
| 通常登録 | 新規16件＋独立11件の27件成功。実JOSE署名とD1で、古い世代／epoch／subject floor、停止・削除再作成、別subjectのメール衝突、異なるsealed audience、replay、途中SQLのIGNOREを検証。account・年度・session・完了記録が部分commitしないことを確認。既存申告はcallbackで上書きしない |
| 登録body | 128bytes／128chunksと5秒のEOF期限。本文未完了・過多の空chunk・長さ不一致でもcommandを実行せず、attempt/provider/cookieを作らない。transport追加後に独立QAが27件を再実行 |
| 私的フォーム | 実装10件＋独立6件の16件がPC／mobileで成功。初期2項目は空、同一年度入力、必須／順序検証、明示保存と訂正、結果不明時の入力保持と手動readback、競合時の明示基準選択、同一session再開、旧sessionの遅い年度応答の拒否。6画像を独立確認し、横overflow・操作の欠けなし |
| SQL inventory | 独立inventory17件＋writer12件の29件成功。全52 SQL箇所を40 private（24 base、15 student、1 profile選択）と12 publicに固定。混合するいいね取消と追加、profileのget/create/retry、EnrollmentStoreの4 base箇所、fresh server clockを検証。旧auth/admissionの既存privileged除外は1 decide＋5 purgeの件数も固定 |

独立ブラウザ検証の最初の実行では、QA自身のhidden-roleとscreenshot selectorが失敗した。独立テストだけを訂正し、16件を再実行した。実装の変更やテストのskip追加はしていない。

## 全体確認

| コマンド | 実行結果 |
| --- | --- |
| `npm run build` / `npm run typecheck` | 成功 |
| `npm test` | 74ファイル・658件成功（17.41秒） |
| `npm run db:local` | 0016/0017を含むローカルmigration成功。remote操作なし |
| `npm run test:e2e` | 60件成功、unexpected/flaky/skip各0 |
| `npm run editor:build` / `npm run test:editor` | 成功、197件成功・既存skip1件（3.7分） |
| `npm run test:auth-browser` | 成功。架空providerと実Chromiumのsession-generation suite |
| `npm run test:pending-pilot` | 旧pending-only契約1件成功 |
| `npm run test:retired-trial` | 旧試用拒否8件成功 |
| `npm run deploy:check` | buildとWorker dry-run成功。remote配備なし |
| `git diff --check` | 成功 |

最初の全体unit実行では新しいstudent guardを旧literal名として数えるinventoryだけが失敗した。分類を緩めず、経路ごとの厳密な分類へ更新し、上記74ファイルを全件再実行した。ローカル自己署名HTTPSのhealth probeで出るCertificateUnknown診断とeditor bundleのサイズ助言は、既存fixtureの制約として扱う。

## 固定した証拠

テストは[独立writer](../tests/enrollment-writer-independent.test.ts)、[独立登録](../tests/self-registration-independent.test.ts)、[独立ブラウザ](../tests/editor-enrollment-independent.spec.ts)、[SQL inventory](../tests/auth-guard-inventory.test.ts)に保存した。独立QA完了時のSHA256は次のとおり。

| ファイル | SHA256 |
| --- | --- |
| `worker/auth/student-participation.ts` | `712674b555db5b04c95379b8aba286241b67249356f4104d01f61114b2a37e33` |
| `worker/auth/oauth-http.ts` | `8bcb296c7b972d09e93359e85eb0b484fce051138300c3c36f3e54d4d3123a2a` |
| `tests/auth-guard-inventory.test.ts` | `09213399a4319eeb6ec55df8f441d2e6c2fed84e0cb3bd402e0c475788e71cab` |
| `tests/enrollment-writer-independent.test.ts` | `cf9c4c7fd6943267c0ad6e7224db830e8682ff4a56a755cd33505a7177e8b247` |
| `tests/self-registration-independent.test.ts` | `7980787ddaee24e5f671512703457bcca316a3231346126fea1828df45953099` |
| `tests/editor-enrollment-independent.spec.ts` | `6ff053172cbc41518a0057ece356d633a33c9a7d08270e4e70259e77be5eb3aa` |

## 限界と次の接続

画面は既存のaccount/session fixture内で検証したもので、一般利用者のsignup入口や実Google往復はまだ公開していない。PC1280×720とChromiumのiPhone13幅390×664はviewport emulationで、物理端末・Safari・IME・screen readerの検証ではない。遅延したブラウザGETはbuffer済み応答で、stream EOFはclient/unit transport側の検証である。離脱率・実在籍・学生の理解や実践の改善は実測していない。

一時serverはPlaywrightが所有し、確認後に子プロセスを含めて終了した。対象loopback ports8787/8788/8790/8791/8792の待受がないことを確認。常駐serverや期限の延長はない。

`OAUTH_HTTP_RELEASE_ENABLED=false`、公開APIの`writesEnabled:false`を維持する。migration0016/0017はlocal/testだけで、remote SQL・operator付与・secret・OAuth設定・production配備は行っていない。通常account/signup入口、実ログとtransportの保護、運営権限・通知／問い合わせ、本人の回復／保持など[既存の公開条件](FIRST-RELEASE.md)を満たしてから実接続する。自己申告年度で停止アカウントを復帰させず、Googleの名前・写真・メールを自動公開しない。
