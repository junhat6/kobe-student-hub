# Local publication snapshot 独立QA

対象はIssue #39、未接続ArticlePublicationStoreとlocal schema/fixture。実装者とは別コンテキストでsource/schema/契約/docレビュー、fixture再bundleとlocalWorkers/D1独立実行。実装・テスト変更なし。対象hashを末尾に記録。実ユーザーのpublish操作や本番投稿体験の検証ではない。

## 判定・修正

最終検証範囲でblocking不整合は確認しなかった。主なreview/調整点:

- publish側でmanual public profile IDの形式検査が不足し、成功receipt後readerがauthor IDを拒否し得た。publish/trigger/readerへ同一のASCII slug/長さ検査を追加し、dot/leading whitespace/private accountやsubjectのID再利用を拒否する。実Google名/emailを自動公開しない。
- 元v1を公開後private v2へ編集すると旧要求retryが失敗する範囲を明確化。最終版はlive owner/session・現在のdraft owner/manual profile一致・元versionとcanonical metadata・published状態を照合するreceipt-only SELECTにより同IDを返す。新しい私的文字は公開へコピーしない。draft削除でlinkがNULLになった後はretry不可だがpublic snapshotは残る。
- anonymous readerはpublication-record-backedかつauthor/profileが一致するpublished non-sampleだけに限定。raw legacy非sample行を新たに開かない。publicreadでprivateactiveaccountを要求して卒業等を自動非公開化する設計にはしていない。
- SQLite length(TEXT)のNULでの短縮を考慮し、SQL byte上限/NUL拒否/ロード後codepoint検証でlegacy projectionをboundedにする。
- receipt SELECT/readerと異なりconflict fallbackだけauthor一致guardがなかった点を最終補強。stored authorが変わるとpublish/readとも拒否し、元へ戻すと元DTOを返すcaseを実行した。現clientからpublic contentを編集できる経路があるという指摘ではなく、保存状態の整合防御である。

## Snapshot・原子性・privacy

authenticated POST/Origin/CSRFと最終SQLのlive token/account/epoch/time/保存済draftowner/versionを検査。strict inputはconfirmPublic=trueとbounded metadataだけで、client title/body/owner/profile/status/sample/date/IDを採用しない。title/bodyはDBの指定保存版からのみcopy。空白title/bodyやstale/other-ownerを拒否する。confirmPublic flagは物理的な本人クリックの証拠ではない。

article_publications INSERTとAFTER INSERT triggerのcontent copyは同statement transactionで、content挿入ABORT/IGNORE時はchangesチェックにより両方残らない。新UUIDでarticle/published/is_sample0を固定する。12同一要求は1snapshot/同ID。canonical tag順やNFKCを揃えた同metadata retryも同ID、別metadata/versionは既存公開内容を上書きしない。後のprivate edit/deleteは公開copyを変更しない。

3distinct account reportでhiddenになると新anonymous readは拒否、replayでもpublishedへ戻さない。deletedも同様。復元/削除/再通報/retentionやhuman一意性は別policy。現在のread拒否は既受信本文の消去や実CDN/clientcacheの再検証保証ではない。

readerはEntry/Profileだけの明示DTOでprivate owner/draft/sourceversion/Google identity/report/outbox/sessionを除外し、manual nonsample profileとpublication recordの一致を確認する。snapshot公開後のprofile表示方針・同意・編集UIは未提供。manual mappingの存在自体を在籍/卒業eligibilityの証明とは扱わない。

## 独立実行・来歴

最初のfinal-ready通知後にfixture再bundleしpublication11/moderation12/worker7の**30件成功（983ms）**。その時のworker fixtureは前段階で、actualpublicationrecord/mappingのsample非露出追加と最後author guardの前だった。これを最終privacy根拠に混同しない。

両修正ready後に次を独立実行:

```sh
node scripts/build-test-fixtures.mjs
npx vitest run tests/publication.test.ts tests/worker.test.ts
```

最終は **18件成功、2 files、745ms**（publication11/worker7）。変更のないmoderation12は先行30件で実行済みで、最終18に含まれるとはしない。親のfullsuite/localDB/E2E/deploycheckとは範囲を区別。sandbox許可はlocalMiniflare隔離DB用で、persistent localD1/remoteを書き換えない。

publication11件で正しい保存版/明示confirmとanonymous DTO、private編集/削除後snapshot保持と旧要求retry、12並行/canonical再送、ABORT/IGNORE rollback、blank/stale/otherowner/privileged/bounds、manualprofile/IDprivacy、mapping変更/legacy malformedNUL/過大body/日付/author不一致、unrecordedlegacy拒否、POST/CSRF/Origin/clock、実moderationとの1/2read可→3hidden/read不可/replay非復活、認証直後revoke/status/epochを実行した。

最終publicWorker fixtureはtrusted local操作でmanual nonsample profile/mappingとarticle_publicationsを挿入し、実snapshot triggerを通したprivate source linkageとnonsample contentを作る。production GET catalogはそのID/本文/profile/記録を返さず、既存fictionalsample4件/2profilesだけを維持する。これは単にraw real-content行を置く検査より広い。report-triggered production GETの非掲載/privacy検査も通過。production worker/index.tsは不変で新reader/storeをimportしない。

## 文書と残る公開条件

PUBLICATION-BOUNDARY.mdは、ローカルprogrammatic snapshotを本物のpublish button/匿名HTTP経路と区別し、旧v1retry後編集時の限定、draft削除後link切断、record-backed read、manualprofile同意と未提供onboardingを正しく説明する。

実学校Google/browser/logout/CSRF bootstrap、在籍/卒業/admission、本人profile作成・確認UI、公開HTTP/cache/log保護、actualmail/運営審査/説明/異議/復元、private media、retention/account削除policy、学生価値は未提供/未検証。remote0004/5/6/7、新credentials/grants/実operator設定、契約/R2、実投稿やdeploymentを独立側は操作していない。新画像作成/公開/保留画像の再送もない。これらのgateを、local confirmflagやactive accountだけで迂回できるとは扱わない。

## 最終対象SHA256

```text
c921f0eb6845e6ec1463fd7e9d69c68862e727a98550989d22ac24a93eab4018 worker/publication.ts
f4d0976e9d18ccb346e7a4dde996627a97e0604b6cb3bc933d0220204b1ce8c6 migrations/0007_article_publications.sql
1ce5ed1fc6574f21803064d2c3f8608506ec287d6eae6aaed49da9c6f2d44628 tests/publication.test.ts
b94b95b2d5cf027f351a3898a8782eff3d19425564ea0674fc2a3ef900b783ca tests/fixtures/publication-worker.ts
954d192d89a7fd3475321ea517440fda4b1d83262a3b64a4e3e0ad4e1159d5a3 tests/worker.test.ts
ced34e0eeb8e5489bfa19657dbf7426ad23771b0ea9854c3d94dd98c68bc16a5 worker/index.ts
```
