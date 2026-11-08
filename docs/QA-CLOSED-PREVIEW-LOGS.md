# 閉鎖プレビューの実ログ照合 — 2026-11-08

## 範囲と受入条件

実認証を開く前の、既存の専用プレビューに対する限定的な運用検証。学校Google・provider交換・認証成功・実投稿を実行するものではない。source main `37b07fc`と既存プレビューの配備版は同一と仮定しない。[ログ公開ゲート](LOGGING-GATE.md)全体は引き続き未達とする。

要求は一度だけ、最大6件に固定した。実credential・実ユーザーデータを使わず、redirectを追わず、10秒の応答本文EOF期限と8KiB上限を設けた。予期しないstatus・Cookie発行・Location、またはhealthの書込停止境界の変化で後続を中止する。設定変更・配備・Tail接続・新しい権限付与は行わない。

実行者とは別コンテキストのQAが送信前にスクリプトを読み、次の受入条件を固定した。

- 配備・version・traffic・settingsを前後で照合し、対象の変化を見逃さない。
- canary検索とは別に要求とinvocationを個別に相関する。非secretの一意path controlを他の要求の捕捉証拠に流用しない。
- 対応したinvocationと関連ログの全nested fieldを検査する。集計件数や表示列だけで非保存と判定しない。
- case別の捕捉数、取得限度、省略・truncation・曖昧さを記録する。保存時sampling、query側ABR、caseの捕捉を区別する。
- 見つからないcaseは未確認。捕捉したrowのcanary非検出も、そのcase・layerだけの結果とする。

## 実行したHTTP要求

2026-11-08 08:29:37–08:29:38 UTCに、既存の専用プレビューへ以下を送った。再送・本番へのcanary送信は行っていない。

| case | 既存経路／入力位置 | 実応答 |
| --- | --- | --- |
| health control | `/api/health`、canaryなし | 200、`writesEnabled:false` |
| path control | 閉じた`/api/auth/*` fallback内の非secret一意pathとquery | 405 |
| query | `/api/auth/callback`のcode/state/nonce、偽Authorization/Cookie | 405 |
| duplicate | 同callbackの重複state等、偽Authorization/Cookie | 405 |
| denial-shaped | 同callbackのerror/error_description/state、偽Authorization/Cookie | 405 |
| body/headers | POST `/api/auth/register`の偽body・token等、偽Authorization/Cookie | 405 |

6件ともCookie発行・Locationなし。path controlは相関確認のための既存fallbackへの1要求で、新機能や認証branchではない。`denial-shaped`等の入力名も、実際のprovider拒否処理を通ったことを意味しない。

## 実ログの結果

**結論は6件とも未確認。秘密情報の非保存・redaction成功は判定できない。** 2round・計4queryで終了し、追加trafficは送っていない。

既存権限でWorkers Observabilityのevents／calculations queryを実行した。[公式API](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/)の`dry:true`はqueryを実行して結果を永続化しない指定で、構文確認だけのモードではない。時間幅は送信開始から応答完了までの前後60秒に限定した。

1. dataset・専用preview service・一意path controlでeventsを検索したが0row。
2. 同dataset/serviceと、今回のHTTP応答から得た要求ID候補だけでeventsを検索したが0row。HTTPのRayIDとログのrequestIdが等しいとは仮定しない。
3. 同候補のcalculationsを取得した。対応する実rowの保存時sampling intervalは得られなかった。集計を実捕捉数の代わりには使わない。
4. 一意controlのorigin/path・UUID・時間幅を維持し、service/typeの前提だけを外してeventsを一度照合したが0row。

4queryとも報告されたABRは1。ただしquery側ABRは、保存時samplingや要求ごとの捕捉とは別情報である。dataset/serviceの実値とRayID対応を陽性rowで確認できず、0件の原因をsampling・ログ未保存・検索不一致のいずれかに断定していない。

| case | 期待invocation | 独立相関できたinvocation | full-row／関連app・error検査 | 判定 |
| --- | --- | --- | --- | --- |
| health control | 1 | 0 | 未評価 | 未確認 |
| path control | 1 | 0 | 未評価 | 未確認 |
| query | 1 | 0 | 未評価 | 未確認 |
| duplicate | 1 | 0 | 未評価 | 未確認 |
| denial-shaped | 1 | 0 | 未評価 | 未確認 |
| body/headers | 1 | 0 | 未評価 | 未確認 |

raw row取得・保存は0件。返却rowがないため、nested field、canary不在、truncation、関連app/errorの不在も確認できない。返却件数は上限未満だったが、queryの完了状態を確認した記録はなく、reportedCount等を含むページ不足判定も実証していない。実行・取得・捕捉の完全性は未確認である。

前後とも単一version・traffic100%で、次の指紋は一致した。配備時刻は2026-11-05 04:29:22 UTCであり、main `37b07fc`の配備証明ではない。実設定値やリソースIDは公開しない。

| 対象 | SHA-256 |
| --- | --- |
| deployment ID | `026585dd6de5d495a9afabdef3bbfbb3f0f52787cf6c2a4e37b522e8b883b190` |
| version ID | `824b644c0f68a7fde2cbfabedc482a6cee08898f64388e3dc37826a1714ace8d` |
| settings（キー整列JSON） | `5e28453e0584b2cc7d0c1dca779e3b0c9a00b0b9e4b00b41a0c0ca9e275dc7a7` |

## 独立QAと次の判断

別コンテキストで結果、query／scan template、時間単位、ledgerとの一致と公開文書をレビューした。ledgerとmethodの指紋、probe前のpreflightと前後pinの一致、millisecondsの時間幅と未確認の解釈に阻害所見なし。独立QAがquery完了状態・ページ不足判定の未実証を指摘したため、上記の限界へ明記した。scanコードも実rowには一度も適用されておらず、検証済みの捕捉手段として再利用できるという結論にはしていない。

次は一件の非secret controlを独立に相関できる捕捉方法を具体化し、query完了と全関連rowの取得を先に検証する。再試行を増やして偶然見つける方法は採用しない。実ログ層と実認証branchの未確認は引き続き公開ゲートに残す。

変更は文書のみ。localの差分確認と5文書の相対リンク156参照先の存在確認が成功。通常CIの実行結果はPRの完了記録に残す。新しい画面・server・browser検証は追加していない。

## 証拠の取扱いと限界

生ログは公開しない。照合用の一時ledgerはgit除外・mode0600でローカルに置き、独立QA後にprobeスクリプトとともに削除・不存在を確認した。削除前にQA照合済みの指紋と所有者を再確認した。sanitizedな対象指紋・方法・coverage・結果・QA・削除記録だけをmode0600で保持する。プラットフォーム上の保持・消去をこのローカル処理から保証しない。

今回の閉鎖fallbackで、成功、期限切れ／再送state、provider error／timeout、unhandled errorの実認証branchは検証できない。他ログ層や実ブラウザ／実Googleの不足も残る。設定や実ログを限定的に確認できても、実callback・一般ログイン・投稿の有効化条件を満たしたとは扱わない。
