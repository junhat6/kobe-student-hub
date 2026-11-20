# Article moderation intake 独立QA

対象はIssue #36の未接続通報受付/一時非公開/pending通知/運営read primitive。実装者とは別コンテキストでsource/schema/document reviewとlocalWorkers/D1独立実行。実装・テスト変更なし。対象sourcehashは末尾。実通報、実メールや運営権限を作ったという結果ではない。

## 判定・修正

最終範囲でblocking不整合を確認しなかった。独立レビューで、operatorが認証済みでも全reported contentがdeleted等の対象外になった場合、LEFT JOIN後のWHEREでsentinelも消えnullとなる境界を指摘。最終版はeligible contentのaggregateをLEFT JOIN内へ置き、初期/全対象外は[]、失効したoperatorはnullとする。独立実行で確認した。

親の追加hardeningも最終版に含む。hide UPDATEにkind=article/status=publishedを明記。旧content schemaに過大title/bodyがあり得るため、queue/case titleはSQLで200 codepointsへ限定し、256KiB超本文のcaseはDB projection前に拒否する。過大本文を黙って切って完全なcaseのように返さず、queue metadataは残してcaseはunavailable。これは実運営の過大記事対応を完成させるものではない。

## 原子性・重複・privacy

reportは実SessionStoreのPOST/Origin/CSRFを通り、最終INSERT SELECTでlive session/account/epoch/timeとpublished articleを再検査する。clientからreporter/operator/statusを受け取らない。UNIQUE(content_id,reporter_account_id)の重複は既存idへのno-op UPDATEでreceiptを返し、AFTER INSERT通知を増やさない。3件後のhidden/非対象や不正入力は一般null。

新reportとAFTER INSERT triggerのoutbox保存、3件目hidden更新は同statement transaction。outboxが失敗すると3件目report/status変更もabortする。1/2件目report_received、3件目temporarily_hiddenがpendingとして残り、送信済み/メール到達とは扱わない。12同accountではvote/event1件、12別accountでは受理3件/event3件/hide1件。

account削除時SET NULLで既存voteとcase/outboxを維持し、新NULLreporter insertはguardで禁止。これは本人確認/人間単位一意性や削除・retention方針の完成ではない。削除後再登録の同一人物計数や復元後再通報は未決。distinct accountを確実なdistinct humanと呼ばない。

operator allowlistはtrusted constructor設定、空default、最大10件のコピーをfreezeする。実session/finalSQL再検査と結合し、headers/JSONのroleで権限を得られない。queue20件metadata/case最大3private reportsのみ明示DTOで返し、reporter account/email/secretをDTOへ混ぜない。未通報draft等の任意read機能ではない。reason/detailはboundedprivate dataで、SQL-like文字列はbindされたliteralとして保持する。

## 独立実行・来歴

初版ready後の独立runはmoderation11/session12/worker6の**29件成功（935ms）**。その後queue/legacy bound/hide defenseとactual public projectionテストが揃った最終版でfixtureを再bundleし、次を実行した。

```sh
node scripts/build-test-fixtures.mjs
npx vitest run tests/moderation.test.ts tests/worker.test.ts
```

最終は **19件成功、2 files、819ms**（moderation12/worker7）。unchanged session12を最終19件に含めたとはしない。親のfull147tests/localDB setup/UI E2E/deploycheckとも範囲を区別する。sandbox許可はlocalWorkers/Miniflare隔離DB用で、persistent localD1/remote操作を独立側は行わない。

最終moderation12件でthreshold/dedup/concurrent、outbox abort rollback、account削除保持、非article/非公開/NULL/未知reporterの直接DBguard、defaultnone/operatorDTO/list20/時刻順、strictUnicode/UTF8/input、POST/CSRF/Origin/time、認証直後revoke/status/epoch、過大legacycase拒否、空operatorqueueを実行した。

publicWorker7件ではprivate report markerとoutbox/count等がsampleprojectionへ漏れず、既存sample4件/2profilesを維持。追加integrationは**trusted local fixture INSERT→実DBtrigger→本番sourceのGET /api/catalog**で、1/2件で記事掲載、3件で非掲載を確認し、no-storeとprivate marker非反射、pending outbox3eventsも確認した。report HTTP endpointを実装/公開したという証拠ではない。実request/session承認は別のmoderation12件で検証する。production worker/index.tsは不変、新moduleをimportしない。

## 文書・次の公開gate

MODERATION-INTAKE.mdはPRDの1/2通知・3一時非公開・運営復元/削除/説明/異議という全体と、今回pending保管までの単位を明確に分ける。現在の公開GETから消える結果は、新規query時のfilterの証拠であり既に受信した本文の消去や全CDN/client cache無効化の保証ではない。

公開への次判断には、実通知recipient/sender/retry/到達監視、実運営allowlist設定/操作UI/判断と監査、author説明/異議、復元/再通報とretention、実author publish/admission/卒業、private media、公開cache再検証と実ログgateが残る。これらを決めずにpublish/restore/deleteやsenderを便宜的に追加しない。実学校Google/realuser、remote0004/5/6、実メール、新grant/credentials、R2/契約/部署連絡、UI/学生価値は未提供/未実施。新画像作成・公開や保留画像の再送も行っていない。

## 検証対象SHA256

```text
f041daed105df818a0ce086d4c9641e76a19eca1f010aa2255a5a9b735482c0a worker/moderation.ts
c8b52e4ad5a594b5b93b6b312751bbeb40e37fc34693adf8492868650ba465ed migrations/0006_article_reports.sql
c5939aa58e27a82402ef75a8eb9f1d4853ea5ec35b9bacf5349025166ca4156d tests/moderation.test.ts
361074bcca840cc7cacb4d94eae8d73cfd4fcf1c7307e9119a06efc6036ca070 tests/fixtures/moderation-worker.ts
fc8b401d77161045b6de2f76d0a134f4fadfd7233413e0f8148792e2aba35054 tests/worker.test.ts
ced34e0eeb8e5489bfa19657dbf7426ad23771b0ea9854c3d94dd98c68bc16a5 worker/index.ts
```
