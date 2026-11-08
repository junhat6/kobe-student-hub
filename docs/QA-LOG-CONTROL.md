# Queryless control 1要求のstored log相関確認

## 状態と範囲

**実照合は0rowで終了・未捕捉。独立の事後QAに限定結論への阻害所見なし。** query完了と条件echoは確認できたが、陽性相関・実row scan・秘密情報の非保存は確認できていない。

[旧閉鎖プレビュー照合](QA-CLOSED-PREVIEW-LOGS.md)の0rowの原因は未確定のまま保持する。今回の目的は、新しい非secret・queryless要求を1件だけ送り、対応するstored invocationを独立相関できるか確認すること。旧入力の再構成・再送ではなく、認証branchや秘密情報redactionの成功を調べる要求でもない。[実OAuth接続前のログゲート](LOGGING-GATE.md)全体の代替にはしない。

対象は既存の専用previewにある閉鎖fallback。実学校Google、provider交換、認証成功、実投稿、新route／labを使わない。この方法にはsource gate・配備・settings・sampling率・権限の変更やTail接続を含めない。previewが現在のmainと同じ版とは仮定しない。

## 固定した方法

1. 送信直前に対象・originの所有関係、単一version／traffic、deployment・version・settingsのpinを確認する。非secretの一意pathへのqueryなしGETを**1回だけ**送り、redirectを追わず、再送・追加health／catalog GETを行わない。Authorization、Cookie、body、code／state、実identityを送らない。期待する閉鎖応答は405。予期しないstatus・Cookie・Location・body、10秒のEOF期限、8KiB上限への抵触で停止する。
2. 送信開始から応答EOFまでの前後60秒を固定windowにする。window終了後30秒待ち、EOFから240秒以内にquery batchを一度だけclaimする。query応答が期限を過ぎても成功扱いにしない。
3. discoveryは1query、上限20row。`$metadata.url`と`$workers.event.request.url`の**OR group**で、各fieldへ同じ単一の完全URLを文字列の`in`条件として渡す。`datasets:[]`で未検証のdataset／service／typeを前提にせず、対象account・完全URL・固定windowでraw取得前から範囲を限定する。needle、全文、prefix、時間だけの検索へ変えない。
4. 実際の`COMPLETED`、`dry:true`、account・ミリ秒timeframe・意味を正規化したfilter echoを照合する。`dry:true`は実queryを実行する指定で、構文確認だけではない。`adhoc`は有無・型・boolean値を補助情報として記録し、過去の受入未達を上書きしない。ABRはrawの有無・型を区別し、欠落の既定値1と、明示null／不正値による不明を混同しない。
5. **discoveryが0rowなら即終了。** 新要求、再query、別key、needle、window拡大、sampling変更へ進まない。原因をsampling・未保存・filter不一致等に断定せず、未捕捉とする。
6. 実rowがある場合だけ、URLのorigin／path、GET・405、時刻、previewのservice／script、event ID、requestId／datasetを確認し、対応するinvocationを一意に相関する。HTTP RayIDとrequestIdが同じとは仮定しない。取得できるversionもpinと照合し、version欠落は帰属の限界として残す。
7. **一意な陽性invocationとquery ABR条件の確認後だけ**、実rowで得たdataset／service／requestIdと同じwindowで関連rowを取得する。この限定された関連取得だけはURL／type条件を外し、URLを持たないapp／error rowも含める。最大3page×20row、全体で最大4query。終端空page、cursor／IDの重複、optional countとの整合、version、truncation、scan上限を確認する。0row時の検索拡大には使わない。
8. source object・nested field・文字列をメモリ内で検査し、JSONとして解析できる文字列や、定めた範囲のURL／base64表現も調べる。解析できない通常文字列はraw textとして検査し、構造を解釈できたとは扱わない。打切り・truncation・取得／scan上限・曖昧な相関・pin変化は未確認とする。最後にdeployment／version／settingsを再照合する。

関連取得の完全性を判定できても、有限の待機後のquery snapshotに見えた同一request文脈までの証拠である。遅いingestionを含む全保存、provider／OAuth成功・例外branch、別のedge／trace／export層まで確認したことにはならない。物理的に返ったrow数と、sampling intervalによる重み付き推計も区別する。

## private ledgerと保持

送信前のdurableなintentと送信試行、正確な合成URL／一意値、時刻window、期待pinを、所有を確認したignored directoryの0600 ledgerへ残す。一度のquery claimも記録する。実credential、raw header／RayID、実リソースID、raw log／query payloadを保存・公開しない。公開結果は指紋、型、有無、boolean、件数と許可したfield名だけにする。

ledgerは**作成時から固定24時間**保持する。今回の期限は2026-11-09 13:44:26.830 UTC。自動削除daemon／schedulerは導入しておらず、期限で消える保証はない。rootが期限時に明示cleanupし、所有するledger／claimだけの削除・不存在とsanitized tombstoneを確認する。QAが未完了でも黙って延長・複製せず、期限切れなら未確認とする。これはremote logの削除ではない。

## 凍結したartifact

実行前の独立QAは、この限定した方法への阻害所見なしとした。事前レビューやoffline確認は、実APIのfilter／cursor／count挙動や実捕捉成功の証明ではない。

| artifact | SHA-256 |
| --- | --- |
| Plan | `b5ea9224edbbf0740ad10aeb69c69309c9f04b674aa78277dbac7abc692922d5` |
| HTTP method | `7540c8570aa1fd130d07d51eac76861abd865a75bb4ff83c1f09aa09d02f73ee` |
| Stored query method | `2e7a65452b53bb50ff7dbce68d78a95402504e6055282a5ab52a302bed709023` |
| Preexecution independent QA | `1647dafdba28a999ef49cd593afbd2db375aed4b34efbee2a32647958200ee49` |

## 実行結果

| 項目 | 現時点の記録 |
| --- | --- |
| 新control送信・HTTP境界 | 2026-11-08 13:44 UTCにGET一回。405・期待した閉鎖JSON、Cookie／Locationなし。追加health／catalog・再送0 |
| 実query件数／完了／echo／ABR／返却row数 | discovery一query、COMPLETED。dry／account／固定timeframe／semantic echo一致。resultとrunのABRは明示numberの1。returned rows／reported countはともに0 |
| adhoc | field欠落と記録。falseと混同せず、query定義の非保存は推定しない |
| 独立相関したinvocation・全nested row検査 | 相関0、実scan0。未確認 |
| 関連row／終端page／取得完全性 | 関連query0。陽性前なので実行せず、未評価 |
| deployment／version／settingsの前後pin | HTTP前／query前／終了時に一致。単一versionがtraffic100%で、現行mainと同一版とは推定しない |
| 操作件数 | この試験はHTTP1、telemetry query1、metadata GET6。Tail・設定変更・SQL・配備・credential／grant・敏感な入力caseは0。rootの予備metadata GET2は別記録 |
| ledgerの固定期限とcleanup | 0600で保持中、2026-11-09 13:44:26.830 UTCにroot所有のcleanup予定。自動削除保証なし |
| 独立の事後QA | ledgerからHTTP段階・query条件の指紋を再計算して一致。30確認が成立し、0rowで未確認という限定結論に阻害所見なし |

HTTP／claim用NodeとCloudflare実行cellは終了し、local serverは起動していない。実行結果のsanitized記録はmode0600、SHA-256 `fc201cd4f7815c92f501b7ee0d5e752f92ddcc2c63bb68829eb20cd37cc5a91f`。exact URL／合成一意値は有限保持ledgerだけにあり、公開していない。

事後QAは別contextでmethod・実記録・ledgerの所有／mode／指紋と時刻を照合した。初回QAの一件は、二度の`now()`による5ms差へ過剰な同値期待を置いていたため不成立だった。元記録を残し、実methodの呼出順と固定window内の整合へ訂正して全30確認を成立させた。要求・queryの再実行や運用結果の変更はない。最終private QAはmode0600、SHA-256 `f6fd2271b0c399f18840b053f5673e538c6cdd3d796a8285c6ef3d4a83590e7e`。

**欠落・未捕捉・未評価を、秘密情報の非保存や保護成功へ読み替えない。** 新しい`in` queryも0rowだったが、旧string `eq`の実効性や0件の原因を証明したとは扱わない。全callback branch、別ログ層、実ユーザー・実端末・学生価値は未検証のまま、ログゲート全体は未達である。
