# 合成入力位置のリアルタイム照合

## 判定

**POST一件は想定どおり閉じたが、対応frameは0で未確認。** query／body／Cookie／Authorizationの4位置・8合成値すべてをUNASSESSEDとする。非検出・redaction成功・秘密情報の非保存へ変換しない。[前のqueryless対照](QA-REALTIME-LOG-CONTROL.md)の陽性とも別のunitである。

対象は同じpinを確認した閉鎖previewの一意な`/api/auth/*` fallback。実credential・identity・学校Cookieを使わず、実callback／provider branch・新機能・fixture配備を使わない。source gate・設定・sampling・権限・契約は変更しない。

## 固定した方法

独立したnamespace／O_EXCLのGO・claimで一回だけ実行する。queryのcode／state／nonce、form bodyのcode_verifier／client_secret／token、合成Cookie、Bearerの8値を分け、markerと独立した一意path・POST／405・時刻・worker／versionでframeを相関する。URL queryの完全一致を求めず、空／mask状／その他の形を別に観測する。合成値は小文字の非hex prefixを持ち、[TailRequest資料](https://developers.cloudflare.com/workers/runtime-apis/handlers/tail/)にあるtoken形状heuristicの条件と混同しない。同interfaceのheuristicが実際のreal-time clientへ適用されたと推定するものではない。

既存のraw noecho PTY、固定issuer・trace-v1、debug falseのclient write callback、socket1・frame最大1／256KiB、30秒の通信停止deadline・stdoutだけ公称500msを使う。送信はPOST1、redirectを追わず、期待405 JSON・10秒／8KiB・Cookie／Locationなしを確認する。timerはOS等による厳密な実時刻保証ではない。

相関後だけ、nested key／value・JSON文字列と有限のURL／form／base64表現を上限付きで検査する。値の検出はそのまま所見に残し、未検出は全walk完了時に限り「対象表現では未検出」とする。未知encoding・不正な宣言値・truncation・budget等は未確認。raw frameを保存・公開しない。

finallyで成功ACKから所有を確認できたTailだけを削除し、remote不存在・他Tail一覧・前後pinを確認する。所有consumerのterminal／PID不存在も別に確認する。旧claim／結果は変更・再利用しない。

## 実行前の検証

実装者21確認、漏出11例・unknown14例・相関不一致10例・receiver5例・journal3群、7sourceとshellの構文確認が成功。独立QAは47代表確認を行い、宣言encodingの不正shape、切り詰めの不正表示、値を残すatomic temp、他Tailの変化を成功扱いにしないこと等を確認した。部分的な保持fileは固定24h期限でrootが手動回復し、未確認の削除を成功と記録しない。

## 実結果

POST1は405・固定JSON・EOF、Cookie／Locationなし。socket1のOPENとdebug false送信callback後、frame0でACTIVITY_DEADLINEとなった。最終結果・consumer exit0・PID不存在は確認した。通信停止処理の観測時刻は公称deadlineの4ms後であり、物理transportの厳密な停止時刻や期限内保証とはしない。

API論理呼出し8（metadata GET4・list GET2・create1・delete1）で、所有Tailの作成／削除ACK・remote不存在、他Tail一覧とpin不変を確認した。独立事後38確認に、この狭い未確認結論への阻害所見なし。保持用transaction tempは0。追加要求・query・再送は0で終了した。

| 位置 | 合成field | 判定 |
| --- | --- | --- |
| query | code／state／nonce | 3値とも未確認 |
| body | code_verifier／client_secret／token | 3値とも未確認 |
| Cookie | 無効な合成Cookie | 未確認 |
| Authorization | 無効な合成Bearer | 未確認 |

| private artifact | SHA-256 |
| --- | --- |
| 凍結manifest | `8fd9e0754b5edd4f11e76a7511aac114ac37ec50263dff839da0de571aeb2c58` |
| 独立事前QA | `2a31256f61177a3c93bf00e04ec47ed38b998c7829ccd76816b6e435ee983fc4` |
| 実結果 | `868d568d53cd60e4224a393df4756d70ad63c619a1debdb0f2a7dd9378ac27ec` |
| 独立事後QA | `ff3fdc0168bd0296d215351e244c39dea4c3529fd9950d1256e2318f7cb6d474` |

合成値と相関値だけのprivate0600 ledgerは固定24h保持。期限は2026-11-09 16:43:36.821 UTC（2026-11-10 01:43:36.821 JST）。root手動cleanupで、自動daemonはない。新旧合計5ledgerの期限を維持し、延長・原値の複製で再試行を可能にしない。これはremote log削除ではない。

このunitは一意fallbackへの共有入力層の診断であり、exact callback GET・bodyを消費する通常route・provider exchange・stored／edge／trace／export層を確認していない。捕捉0の原因も確定せず、[ログ公開条件](LOGGING-GATE.md)を維持する。
