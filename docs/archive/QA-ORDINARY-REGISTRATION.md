# 通常登録画面と本人確認のQA

2026-11-08、base main `4f3fe88`からの通常導線の接続。[登録処理の前回QA](QA-SELF-DECLARED-ENROLLMENT.md)を再実装せず、[通常の画面と公開条件](ORDINARY-REGISTRATION.md)を同じ本体entryで検証した。sourceのfrontend visibilityとWorkerのOAuth gateはfalseで、本番の登録受付を開いた記録ではない。

## 実行した確認

| 確認 | 結果と範囲 |
| --- | --- |
| `npm run build` / `npm run typecheck` | 成功。通常本体、private account、Worker、fixtureとtestの型検査 |
| `npm test` | 76files／686passed、18.92秒。既存Worker/D1回帰も含む |
| client関連の独立確認 | 新規client22件＋独立6件＋既存session/enrollment client21件、計4files／49passed |
| `npm run db:local` | 既存local migrationsとsample editorial処理が成功。remote SQLなし |
| `npm run test:e2e` | 62passed、12.9秒。既存60件と、既定buildで通常3ルート・account nav・auth/private requestが開かないPC/mobile各1件 |
| `npm run editor:build` / `npm run test:editor` | 197passed／既存skip1、3.8分。共有境界へ移した既存編集旅程の回帰 |
| 登録画面の担当別browser実行 | 登録・login・拒否・通信結果不明・中止・catalog障害の14件成功、34.3秒 |
| 独立browser実行 | 6シナリオ×PC/mobileの12件成功、31.3秒。下表参照 |
| `npm run test:auth-browser` | 最終集約36passed、1.2分。うち2件はsource gateの静的確認で、残りはChromiumのbrowser操作。既存の逆順callback／logout／期限も両viewportで実行 |
| `npm run test:pending-pilot` | 旧pending-only契約1passed |
| `npm run test:retired-trial` | 撤去した本人限定試用の拒否8passed |
| `npm run deploy:check` / `git diff --check` | build・Worker dry-run・差分確認が成功。remote配備なし |

最初のpublic実行は新規テストの見出しに余分な句点があり2件失敗、既存60件成功だった。testの指定だけを実画面へ合わせ、全62件を再実行した。旧session-order helperは303のheader読取からJSONへ切り替えた際、browser内で本文を消費せずPlaywright側で待ち、集約実行の旧8件がtimeoutした。helperを本体と同じbrowser内のJSON本文読取へ直し、順序・Cookie・失効のassertionを維持して最終36件を再実行した。PC/mobileでhold barrierのtagも分離した。登録画面・認証条件を緩めた修正ではない。実行0件の診断は成功件数へ含めない。

## 別コンテキストの独立QA

| 対象 | 確認した境界 |
| --- | --- |
| transport | command EOF前にはregisterしない。途中abort、複数のsession証明を含む合計10秒、headers後／EOF時の失効、最終証明のnetwork failureでも私的年度を返さない。固定Google URL、exact DTO、限定したbootstrap409、Authorization proofを実コードでも確認。独立6件に阻害所見なし |
| 同一session | pagehide／確認失敗で私的入力を即時隠蔽。手動の同一session確認後に未保存年度を保持して再開 |
| session変更 | 別tabのlogout／新しいloginで旧入力を破棄。候補確認後にさらに状態が変わっても、その候補を自動で開かず再度の明示続行を待つ |
| Googleからの中止・復帰 | 移動中止、合成persisted pageshow、実history backで、停止したままの画面や自動の認証再開始にならず状態確認へ戻れる |
| 私的年度の最終証明 | 取得済みの年度があってもEOF直前にsessionが変われば、signupへ古い年度を表示せず、手動の現在状態確認まで待つ |

独立browserの初回には、認証済みユーザーが`/login`からaccountへ戻る既存方針を考慮しないtest setupと、意図的に止めたnavigationに対するPlaywrightの待機が失敗した。明示logoutとローカルnavigation中断の完了待ちへtestだけを訂正し、最終12件を全件実行した。実装上の阻害所見はなく、source変更やskip追加は行っていない。

## 画面・記録の確認

実装者は本体を1440×900、390×844、1200×867で操作し、signupと保存年度のaccount画面をcaptureした。最初の一括確認で重複説明を減らし、任意のlogout説明をdetailsへ移して一括修正し、二度目の確認で5画像を開いた。各画面に横overflow・pageerrorなし。登録の主操作は確認した390×844内にも収まる。独立担当は別にlogin／account確認不能／signed-outのPC/mobile6画像を開き、確認不能時の私的年度非表示を確認した。

fresh contextのfinish reviewerは、5画像のsignup/accountと追加6画像のlogin/unknown/signed-outをそれぞれ`ship`と判定した。提示した画面の可読性・関連label/help・focus・私的情報の隠蔽に必須修正なしという範囲で、機能や実運用を包括承認したものではない。未撮影の開始失敗は機能テストとsource確認の範囲。

別のdocumenterはPRODUCT、DESIGN、surface brief、実装を照合し、既存の色・日本語system font・12px面・8px操作部と44〜48px対象を継承した通常extensionと確認した。新しい世界やdurable token変更はなくDESIGNを保持。base時点のcard11px／search9pxと文書12px／8pxの差異は既存driftとして未変更。新しい配信rasterはない。mechanical detectorは新規form／account CSSと共有境界で指摘0だった。私的回答・画像・生ログはこの公開文書へ転載しない。

## 最終sourceの照合

| ファイル | SHA256 |
| --- | --- |
| `src/account/Registration.tsx` | `a60f74edd55b56f0c77948ada45c73ea81e75bdf462218276422ce2649799941` |
| `src/account/AccountSessionBoundary.tsx` | `119caf047725bc96e425378f4a197d3572011d6a3a414bf5fccb2201695f9908` |
| `src/account/registration-client.ts` | `0e92e54e47a07fbdc03b9c2def935c56265ab23962e76f94b5aeabc3f6e7b069` |
| `tests/registration-client-independent.test.ts` | `af6165988a0c57218652ae0b15918457946a236ee64cdc1a4a2dce94ab3184e6` |
| `tests/session-registration-independent-browser.spec.ts` | `7a2c21c1553dd3c6bed3aca9babb249dc5e021e5a2178e9a68cecd4d7f5f2857` |

## 限界と後片付け

架空の署名・本人・D1だけを使用した。Google URLへのnavigationは捕捉し、固定token/JWKS先はfixtureで応答した。実Google、実在籍、実BFCache、実機Safari／IME／screen reader、学生の理解・実践・離脱率は未検証。viewportの違いを物理端末の実績へ置き換えない。localの自己署名HTTPS health probeのCertificateUnknown、NO_COLOR、既存editor chunkサイズの助言は既存fixtureの制約として区別する。

実装者・担当別QAが起動したserverはすべて確認後に子processごと終了し、ports8787/8788/8790/8791/8792に待受なしを最終確認した。失敗診断のserverも停止を確認してから同じportで再実行した。常駐や期限延長はない。

remote SQL・secret・credential・operator付与・本番設定／配備変更は行っていない。次は既存の実ログ経路・認証設定と公開条件を実接続の証拠に基づいて具体化する。新しい入口や合成試用を増やすことで実サービスの不足を埋めたことにはしない。
