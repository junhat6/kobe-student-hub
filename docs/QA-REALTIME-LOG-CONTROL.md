# 閉鎖プレビューのリアルタイム対照

## 範囲と判定

実認証を開かず、既存の閉鎖プレビューで非secretな一要求とTailの実frameを相関する検証。保存ログの[0row結果](QA-LOG-CONTROL.md)とは別の層であり、[OAuth公開前のログゲート](LOGGING-GATE.md)を満たしたとは扱わない。実Google、本人限定試用、fixtureの配備を使わない。

最初のTail試行はcreate／deleteのACK、所有Tailのremote不存在、他Tailと版・設定の不変、所有consumerの終了を確認した。一方、最終consumer payloadが欠落したため、HTTPの実送信は0〜1、応答・frame数・陽性相関は未確認として終了した。durableなHTTP claimだけで実送信や405を推定しない。旧claimと実行記録は変更・再利用しない。

## 新しい一回の方法

1. 別の所有directoryとO_EXCL journalを使う。版・設定・trafficのpinとTail一覧を取得し、対象違い・drift・不明な一覧で停止する。
2. 既存接続でTailを一回作成する。合成headerの値・GET・確認したscript versionでfilterを限定し、他人のTailを変更しない。create ACKが不明なら作成を繰り返さず、一覧差分だけで所有を推定しない。
3. 返されたcapabilityはRAMから専用PTYのstdinだけへ渡す。raw modeとechoなしを先に確認し、command／環境変数／file／公開出力へ入れない。接続先issuerを固定し、redirectと自動再接続を拒否する。
4. `trace-v1`のOPEN後、`debug:false`を送信する。公式[Wrangler 4.157のclient](https://raw.githubusercontent.com/cloudflare/workers-sdk/wrangler@4.157.0/packages/wrangler/src/tail/createTail.ts)と同じwire optionsを使い、write callbackの成功を待つ。これはclientの書込み完了であり、serverのfilter ACKとは呼ばない。
5. 期限内だけdurable HTTP claim後にqueryless GETを一回呼ぶ。Cookie・Authorization・body・実identityは送らない。redirectを追わず、10秒・8KiBの応答上限、期待する405の閉鎖JSON、Cookie／Locationなしを確認する。
6. socket一個、frame最大一個・256KiB、通信停止deadlineを30秒に設定する。v3はstring／Buffer／ArrayBufferだけを許し、byte上限を先に調べてfatal UTF-8でdecodeする。BOM・lone surrogateを黙って除去／置換せず、既存JSON検査を保つ。期限でHTTPをabortしsocketをterminateする。最終診断のstdoutだけに公称500msの猶予を置き、追加の通信には使わない。相関は完全URL・GET・405・時刻・scriptと取得可能なversionを確認し、nested field・JSON文字列・truncationを上限付きで検査する。raw frameは保存しない。
7. finallyで、成功ACKから所有を確認できたTailだけを一度削除し、remote不存在・他Tail一覧・版と設定のpinを確認する。所有PIDは正確なcommandと照合して終了・不存在を確認する。exit codeだけでcleanup成功としない。

timerは公称の設定値であり、OS等による実時刻精度や厳密な時間上限の保証ではない。今回のactualでは設定deadline内の停止時刻を確認した。収集率・設定・契約・credential／grant・SQL・配備・実認証の変更は含めない。ここでの一回はapplication／APIの論理的な呼出し回数であり、下位transport内部の物理送信数を断定しない。

## 実行前の確認

診断回収のoffline候補は、旧実装のno-frame時のpayload欠落と、新実装の診断回収をmockと実PTYで確認した。旧実行の欠落原因を確定したものではない。新しいpath・journal・wire callback・期限後のHTTP拒否は、別のfocused確認と独立レビューで検証する。mockの結果を実frameの捕捉と加算しない。

## 結果と再計画

診断回収を修正したv2は、2026-11-08 15:42:50.938〜15:42:57.915 UTCに一度だけ実行した。GET呼出し1、405・閉鎖JSON・応答EOFとCookie／Locationなしを確認。socket1、`trace-v1`、debug送信callbackの成功後にframeを1個受信したが、`MULTIPLE_OR_UNSUPPORTED_FRAMES`で停止し、陽性相関は未確認だった。frameの型・byte数は記録しておらず、binaryだったと断定しない。consumer最終結果は回収でき、exit0とPID不存在を確認した。

APIの論理呼出しは8（metadata GET4・list GET2・create1・delete1）。所有Tailのcreate／delete ACK、remote不存在、他Tail一覧と前後pinの一致を確認。独立事後QAの33確認にも、この限定した結論への阻害所見はなかった。新しい相関ledgerの期限は2026-11-09 15:42:53.879 UTC（2026-11-10 00:42:53.879 JST）で、root手動cleanupが必要。旧source・actual・ledgerの指紋は不変だった。

次の修正は、consumerが文字列だけを許す条件と、使用するws libraryのbinary表現を合わせるもの。[ws 8.21の資料](https://raw.githubusercontent.com/websockets/ws/8.21.0/doc/ws.md)は既定のbinary表現をnodebufferとする。別namespaceのv3で、実装者12確認・decoder10例・receiver8例が成功。独立29確認に加え、Buffer view範囲・fatal UTF-8・診断への本文混入拒否・enum／型強制の4代表検証も成功した。新GOを消費し、旧claimを再利用しない。これは旧受信内容の推定や、自動的な再送許可ではない。

v3は2026-11-08 15:51:45.710〜15:51:51.787 UTCに一度だけ実行し、**閉鎖fallbackのリアルタイム対照1件を相関した**。GET1／405と期待JSON・EOF、socket1、受信frame1。今回はBuffer2999byteと記録され、厳密UTF-8に適合した。完全URL・GET／405・時刻・scriptと、実rowにあるversionを照合した。key／value・nested container等の上限付きwalkは206nodeで完了し、truncationなし、log／exceptionとも0。診断名`fieldsInspected`はこのnode数で、固有field数とは扱わない。これは敏感な値を送った試験ではない。

v3もAPI論理呼出し8、所有Tailの作成／削除ACKとremote不存在、他Tail一覧と前後pinの不変、consumer exit0とPID不存在を確認した。独立事後32確認に、この限定した結論への阻害所見なし。このturnはv2＋v3の2unitで終了し、追加control／query／再送は0。v3 ledger期限は2026-11-09 15:51:48.514 UTC（2026-11-10 00:51:48.514 JST）、自動削除は未導入。

| v3 private artifact | SHA-256 |
| --- | --- |
| 実行前manifest | `ebf8bbf677803590e7296b0450e3cd2b309cccd1c33046e95b4cd929a3a11464` |
| 独立事前QA | `efb8d8760bbed7234a7dd799452a97c4dc06200f87130929e1266edf9db7594e` |
| 実行結果 | `54d5638d9c3505946ef1597884cb442ad72259b0b57e671165b15d19042c2915` |
| 独立事後QA | `3db754d8c335b881d53005cf53c798bb8b8e75d0e5e03505eb8570032b43f843` |

陽性でもquery／body／敏感なheader、provider成功・拒否・timeout・例外、stored／edge／export全層の保護は未検証である。

Cloudflareの[real-time logs資料](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/#limits)は保存ログとの違いと、高traffic時のsamplingを説明している。Tailが見えたことをstored logの保存・非保存や全要求の捕捉保証に置き換えない。

合成URL／UUIDの相関ledgerは作成から固定24時間のprivate0600保持とする。自動cleanupは未導入。rootが期限時に所有ledger／claimだけを削除し、不存在・parent fsyncを確認してからhashだけのREMOVED記録を残す。これはremote logの消去ではない。先の二ledgerの期限・削除責務も別に維持する。
