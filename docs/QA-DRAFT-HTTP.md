# Private draft HTTP 独立QA

対象はIssue #30、未接続createPrivateDraftHandler。実装者とは別コンテキストでsource/契約/文書レビュー、fixture再bundleとlocalWorkers/D1実行を行った。実装・テストの独立側変更なし。対象sourcehashは末尾に記載。

## 判定とレビュー

最終検証範囲でblocking不具合は確認しなかった。実session/CSRF認証をJSON取得前に行い、本文取得後はdraft storeで再認証し、最終SQLでもlive session/account/owner/versionを再確認する。client identity/owner/statusを採用しない。本文読取のPromise.raceにはDB変更を含めず、timeout敗者が遅れて読み終えても保存へ進まない。

親が指摘したtiny chunk配列の負担に対し固定2MiB bufferへ修正。独立側はempty chunkがbyte数を進めず即完了readがtimer taskを飢餓化し得る点を追加指摘し、最終版は空chunkを含む65536chunk上限で有限化する。cancelはrejectionを処理しbest effort、無期限awaitしない。失効/epoch変更が本文取得中に起きる直接テストも依頼し、最終版でnoinsertを確認した。

transport cap2MiBはJSONescapeを含むraw UTF8上限で、保存body256KiBやtitle200codepointsを拡大しない。Content-Lengthだけに依存せず実byte数/一致を検査し、UTF8fatal decodeとJSONparse、media type/charset/encodingを限定する。5秒deadlineはbody acquisitionの境界で、handler全体のDB/crypto時間やCPU preemption保証ではない。

## HTTPとprivacy

canonical collection GET/POST、単一UUID GET/PUT/PATCH/DELETEのみ。query/余分pathは固定404、対応prefixの不正pathも404、無関係pathはnull。405には静的Allowのみ。全matched応答は共通JSON/private,no-store/Vary Cookie/no-referrer/nosniff/noindex,nofollow、CORS許可/Set-Cookie/Location無し。missing/other-owner/stale/storagefailureは同じ404 draft_unavailable、authは固定401、transportは固定invalid_requestで詳細や本文をechoしない。これはlocal生成レスポンスの検証であり実platform cache/logの秘匿証明ではない。

## 独立実行

実装者ready後に実行:

```sh
node scripts/build-test-fixtures.mjs
npx vitest run tests/draft-http.test.ts tests/drafts.test.ts tests/sessions.test.ts tests/worker.test.ts
```

**41件成功、4 files、6.46秒**。HTTP11/draft12/session12/publicWorker6。sandbox許可はlocalMiniflare/Workers実行用。隔離DBのみで、persistent localD1/remoteへ操作していない。親のfull128tests/UI E2EやGoogleintegration10件は今回独立範囲に含めない。

HTTP11件でCRUD/DTOと201/200/400/401/404/405/408/413/415/503の共通privacyheaders、他owner/missing/conflict同一結果、path/query/method、auth-before-parse、JSON/UTF8/media/encoding/宣言長の不正・不一致・実stream超過を実行した。escaped control characterの保存256KiB境界を受理し、privileged/null入力は拒否。small chunks受理、empty flood413を2秒未満、上流cancel停止でもoverflow413を2秒未満とするassertが通過した。

late bodyは5秒（assert4500ms以上6500ms未満）で408となり、700ms後にもrow数不変。fixtureが初回実認証の完了後、本文yield前にaccount epochを変更すると404、row数不変。これは合成stream/ローカルDBによる動作証拠で、実ネットワークや実ブラウザ測定ではない。fixtureのsession注入/clock/失敗制御は公開してはいけない。

publicWorker負テストでは両draft prefixのGET/POST/PUT/DELETEが未接続405、private marker非露出を確認。production worker/index.tsのsourceは不変。今回UI無しでscreenshotは追加しない。

## 文書と未提供事項

DRAFT-HTTP.mdのrawlimit対storagelimit、chunk/deadline、localheaders対livecache、未保存文字保持のfutureUI責務、remote未適用・本物認証/ログ/運用gateは実装と整合。編集画面、autosave/競合回復/端末間実利用、realGoogle/key/client、実browserCookie、在籍/卒業/admission、実ログ/キャッシュ監査、quota/abuse、公開/media/moderation/通知/異議、学生価値は未提供/未検証。remote0004/0005、新schema/credentials/grants/R2/契約/設定を独立側で操作していない。

## 対象SHA256

```text
bc92603e20518a9a4a433eebd69737e34a5d010fb9c5d1842e4f4a559c0a9fda worker/draft-http.ts
ef720de714c45da6ea894484e9b70e4c9b2f80fc7e276bda3fce52a3acddb907 tests/draft-http.test.ts
6ad5a76f1d04253ae521d4c25c852fcccaad4d0173f56060ffaa7cddb6ab3152 tests/fixtures/draft-http-worker.ts
ced34e0eeb8e5489bfa19657dbf7426ad23771b0ea9854c3d94dd98c68bc16a5 worker/index.ts
```
