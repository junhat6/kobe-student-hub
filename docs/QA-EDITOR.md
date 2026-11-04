# ローカル下書き編集UIの独立QA

対象はIssue #32。実装者とは別コンテキストでsource/体験レビュー、追加browser test3ケース、実localHTTPSブラウザ操作、現在runの画像視認を行った。編集source/harnessは変更せず、承認されたtests/editor-independent.spec.tsとこのreport/画像だけを独立側で作成した。sourcehashは末尾。

## 判定と修正履歴

最終検証範囲でblocking不具合は確認しなかった。

1. 初期sourceでは下書き切替/新規作成のfetch中も旧入力を編集でき、完了したopenがその間の文字を上書きするraceを指摘。opening状態でnavigation/create中だけ入力/補助をfreezeする修正を確認。保存中のtypingは引き続き可能。独立テストでslowGET中の非editableと完了後の復帰を確認した。
2. 初期画像では非focusのskiplinkが一覧上に重なった。親/providerも同じ画像不良を確認し、clip方式へ修正。最終keyboardテストでTab時に可視、Enterでmainへfocus、blur後width1pxを確認し、最終画像で通常時の重なり消失を視認。
3. 親の追加観点で、実DBcommit後に応答だけ503へ置換した不明結果を独立テスト。手元の文字を保持→readlatest同内容→明示base採用で保存済み/保存disabled、PATCHは1回だけ。UIは内容一致時に追加保存を促さず保存確認済みと表示する。

検証準備の誤りも区別する。独立初回12件は旧段階で成功したが、後のskip補強runは私がeditor:buildを省いたため古い.editor-previewを配信して2件失敗。diagnosticはmainfocus済み/skip非focus/旧CSS clipなしを示した。製品sourceの新たな不良とは扱わず、最終は明示再buildして全14件成功。旧run画像を最終証拠へ混ぜていない。

## 最終独立実行

```sh
npm run editor:build
npx playwright test --config playwright.editor.config.ts --workers=1 --output=test-results-independent-editor-verified --reporter=list
```

**14件成功、13.1秒**。既存4ケース+独立追加3ケースをdesktop ChromiumとiPhone13設定mobile Chromiumで各1回。localHTTPS127.0.0.1:8788、専用fictional account/isolated fixtureD1、実SessionStore/privateHTTP/D1storeを通る。別contextによる競合は別物理端末の実証ではない。Playwrightはself-signed証明書エラーを当該contextだけ無視。CertificateUnknownのserver警告は出たが全case成功し、OStrust/globalTLSを変更していない。

最終build assetはindex-B1J8v_cP.css / index-BPx1OFHT.js。親のunit/runtime/full公開UI E2Eとは実行範囲を区別する。独立側は新client unit全件を実行したとは主張しない。serverはrun後自動停止した。

## 体験のステップと評価

1. **入口とkeyboard — 正常。** ローカル専用/架空account/公開不可が画面に明示。00画像はTab時のskiplink、Enter後mainfocusはassert。通常編集画像ではskiplinkを隠す。title/bodyにlabelとfocus表示がある。スクリーンリーダー実機や全WCAG準拠は未確認。
2. **作成→編集→preview→保存→reload再開 — 正常。** 空のserverdraft取得後に編集可。安全rendererを使いscript実行・画像外部取得無し、inline/Markdownを表示。別fixture accountのreadは404。14case内で明示保存・reload・再開、localStorage/sessionStorage空、URLにtitle無し、Secure/HttpOnly sessionCookie属性を確認。02画像は保存済みdraftへの移動完了とtitlefocus。
3. **保存待ちと失敗 — 正常。** realPATCH応答をhold中にtypingした文字は保持され、旧snapshot成功後も新文字はdirty/save可。503を受信しerror表示まで待って保持を検査。独立ではlatestGETも503にしてbody保持・基準変更button無しを確認。03画像では未保存表示と手元文章、回復導線が同時に見える。
4. **競合と明示回復 — 正常。** 二つのbrowsercontextで先に保存した版を、古い版から無断上書きできない。readlatestはreadonly比較、明示base採用でも手元文字を変えず次のCAS保存。独立はkeyboard選択→太字補助→preview/編集往復と、latestread失敗から再取得/明示回復を検査。04画像は手元文字保持と次保存の説明。
5. **保存応答だけ失われた場合 — 正常。** server200commit後の503注入でも再読と明示確認で保存済みに到達し二重PATCH無し。05画像は一致内容・保存確認message・保存disabledを示す。単にnetworkfailureを返すmockだけの証拠ではない。
6. **下書き移動 — 正常。** dirty状態のconfirm取消でtitle/bodyを保持。確認後slowreadの間は編集不可、完了後正しいdraftとeditableを復帰。beforeunloadはsource上best effortであり、実モバイル終了/crash回復を検証したとはしない。

PC/mobileとも最終画像で本文/失敗案内/操作が収まり、page全体の横はみ出しassertを通過した。mobile一覧は横scroll方式で、編集エリアより前にまとまった高さを取る。現在の機能不良とは判定せず、実学生trialでは一覧と入力の行き来の負担を観察する余地がある。保存済み/未保存の文字表示は色だけに依存していない。

## 最終画像証拠

以下10枚は今回最終runからローカルへコピーし、すべて実際に開いて視認した。リポジトリへ保存する画像は7枚。04-mobileと05-desktop/mobileの3枚はローカルに保持し、個別の公開承認待ちのためリポジトリには含めない。scale=css、app-onlyで架空テスト文章だけ。00はfocus時viewport、02〜05はfullPage。通常編集・失敗・回復画像にskipの不正overlayがない。画像だけでnetwork/DB/競合を証明せず、上記assertと組み合わせる。

| 画像 | SHA256 |
| --- | --- |
| [00-keyboard-skip-desktop.png](evidence/editor/00-keyboard-skip-desktop.png) | `2acd28eb5c7d7a22c25eaa59e7fd7831996de93d4c83034a34bd9c7edf82cda7` |
| [00-keyboard-skip-mobile.png](evidence/editor/00-keyboard-skip-mobile.png) | `26578d6bb2dbf9186ed4c6939968a597be6d956e250d2bd1f3689141d6734fee` |
| [02-navigation-restored-desktop.png](evidence/editor/02-navigation-restored-desktop.png) | `d788b7583d37325df149a66453a17b781ebe156017ed1e18616bf7252ae10499` |
| [02-navigation-restored-mobile.png](evidence/editor/02-navigation-restored-mobile.png) | `030a481a4f2dd978665b89130353b4514c778913478e2e647e263cc1d3c5ed60` |
| [03-read-failure-keeps-text-desktop.png](evidence/editor/03-read-failure-keeps-text-desktop.png) | `0c9956a80959337c3fe9df84d29d71b71a0d958dfb70a076ad6c7a138340ad54` |
| [03-read-failure-keeps-text-mobile.png](evidence/editor/03-read-failure-keeps-text-mobile.png) | `2f1a97a904145e776815f93945619b491e79024e1e4774958e35a1787f9d5768` |
| [04-explicit-recovery-desktop.png](evidence/editor/04-explicit-recovery-desktop.png) | `9a2346103472bba5620e2e92997408d665d80999623d0ad07436a8e895627d13` |
| 04-explicit-recovery-mobile.png（ローカル保存・公開承認待ち） | `3272234136386544009b182b188a8b7bd2a8dd62a47b7acefa1e72b1fe58a4e2` |
| 05-unknown-outcome-confirmed-desktop.png（ローカル保存・公開承認待ち） | `f56363854d2744f758abefbbd55396db1658f9c367f452cf835290cb8e039724` |
| 05-unknown-outcome-confirmed-mobile.png（ローカル保存・公開承認待ち） | `6a9c10460aecce4ba7b5aa54fe7a50e05d46ab216e80d8fd08da370bba54a0a2` |

## 構成・未検証境界

editorはproduction mainからimportせず、別Vitebuild/.editor-preview/localhostfixtureのみ。実学校Googleログインではなくhardcodedfictionalidentityからテストsessionを作る。private textはcomponent memoryのみでstorage/URLへ永続化せず、自動保存/公開成功は表示しない。realidentity切替/logout時のremount・私的buffer消去とsession/bootstrap統合は別途必須で、ambientCookie変更だけでprivacy完成とはしない。現session失効エラー時buffer保持はlocalUXの証拠に限る。

remote0004/0005、productionrouting/deploy、実Googleclient/key/secret、新grant/R2/契約/OStrustを独立側は操作していない。実学生の価値、物理端末/Safari/IME・mobilekeyboard、browserclose/crash復旧、actualログ/キャッシュ秘匿、卒業/在籍/運営、realpublish/media/moderation、pagination/autosaveは未提供/未検証。ProductDesign audit/index/frameworkの画像先行・体験別notesを参考にしたが、同package内critical-overrides/preflightscript参照は解決不能だったため、完全なpluginworkflow実行とは主張しない。既存委任QAとして実画像と操作事実のみを記録する。

## 検証対象SHA256

```text
79b733f06b4768e4109d9b212177795247d683d32ef02fc0806063532c9a0428 src/editor/DraftEditor.tsx
8077c9dd98a0d95ad37207b064f174f390a5d27dcf5827b774991a69e4390afc src/editor/draft-client.ts
b0b5cb092736212818ec0aa17ed0906f32e0da93b5e85cc04b4f26aa2fba51c5 src/editor/editor.css
cd7ccd09237aa00be62eaf24e73980af702a69626f55592f1d42d3a4adcc3812 tests/editor-independent.spec.ts
005095182d8026854e5d318da9379aa97dc6c4667def0b20b15a92185429a3b2 tests/editor.spec.ts
d7237b98617be76f45a14d2eefa056b744112c8416b415ddc85da5ee0aa4e185 tests/fixtures/editor-worker.ts
fb5969a2a8c7017307ffca645f5d41bcc0d9b46ffadd2c7b22d4284e2e2e2e69 playwright.editor.config.ts
961ef47f85ebfb99c5721a82351eeffd92676d8f4792f4622bf67cebd5e916db wrangler.editor.jsonc
7c3306ebd0ec92307f504a64b754c7ea1209df0003e39e346e837918af06e3c7 vite.editor.config.ts
```
