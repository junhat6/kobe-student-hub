# 記事・作品の公開画面文言: 独立QA

2026-11-05、実装者とは別コンテキストでレビューとローカルブラウザ検証を実施。基準commitは `18c3b4f94255e45d85ebeec09eb33dd9d0b782bf`、対象は下記hashのworking tree。製品source・既存テストの変更はQA担当では行っていない。

## 判定

検証範囲でblocking不具合は確認しなかった。作品詳細は「この作品は、こんな人へ」「つくった学生」、記事詳細は従来の「この記事は、こんな人へ」「書いた学生」を保つ。0件案内は選択中のarticle / project / allに対して「記事」「作品」「記事・作品」となる。共通のcatalog読込中・失敗、本文復旧先、missing、関連0件は記事・作品を含む表現となる。

製品差分は `src/main.tsx` の5行置換で、表示文字列と文字列選択の式のみ。URL生成、検索・絞込、storage、一覧位置復帰、navigation、認証、Worker、設定、schema、secretsには差分がない。無効なkindは既存検索処理で全件除外されるまま、今回の案内は「記事・作品」となる。allへの検索動作の正規化は追加されていない。

mobileでは既存CSSにより詳細asideが非表示である。投稿者の文言はDOMの存在で確認し、表示中のheader投稿者も検証した。asideをmobileへ新たに表示する変更はない。

## 独立実行

最新buildを配信するlocalhost8787で以下を実行。

```sh
npx playwright test tests/content-kind-copy.spec.ts --workers=2 --output=/tmp/kobe-content-copy-independent-results --reporter=list
```

**12 passed (3.6s)**。記事/作品詳細、単一entry fixtureによる関連0件、混在一覧の3記事+1作品、種類切替、article/project/allの検索0件、すべて表示への復帰をdesktop ChromiumとiPhone13設定mobile Chromiumで確認。

これとは別の一時QAスクリプトで **22チェック成功**（PC/mobile各11）。記事/作品の詳細見出し・投稿者文言と横はみ出しなし、4種kind（article/project/all/unknown）の0件、0件のまま作品への切替、解除後4件への復帰、存在しない作品の案内、503時の共通失敗案内、遅延応答時の共通読込案内から作品詳細への復帰を確認した。503と遅延はブラウザのAPI route fixtureで再現し、サーバー設定を変更していない。

初回Chromium起動はsandboxのMach権限で失敗した。ローカルブラウザ実行のsandbox拡張が承認された後に上記実行が成功した。製品失敗とは区別する。

## 視覚確認と対象固定

ローカル一時領域の作品詳細PC/mobile、作品0件mobileの画像を実際に開き、見出しと0件文言が収まり、重なりがないことを確認。詳細画像は本文lazy loading中の状態であり、本文完了の画像証拠とは扱わない。画像・一時スクリプト・実行結果は公開リポジトリへ追加していない。

```text
7e1cd5a36cf7a04cfa8f348a12c481c74b0e6bb5666bb3677b43a2b93f96dd40  src/main.tsx
e445d77e2dfd6221b8e8f4d70b6ab22e00203082618b9e1cba2c6408ec2be2b6  tests/content-kind-copy.spec.ts
343e9829a56d2174d9b0eae3ee55ef15aa6198b112b88146bbb820606409fe4e  dist/index.html
c8885f49e44ed4ed6510d389dd766d38e46dcd6166ef7e0ddb0ad05f69ca04e4  dist/assets/index-C_zIERLH.js
36a6c6e8963812ec58c501b8f76db6d0477393dbe05770e19ba22a560bc62edc  dist/assets/MarkdownRenderer-Bqhnhz9O.js
693f21fae8bde088ee95499e2fb2ee5dd9a1aa6891d734e40c171555b5d5ce2d  dist/assets/index-TfhgnYfT.css
```

実装者のbuild・全体テスト結果とは区別し、独立QAで全体suiteやbuildを再実行したとは主張しない。実端末、Safari、スクリーンリーダー、公開配信後、学生による文言理解・価値検証は未実施。新credential、production logging、remote SQL、認証・公開設定、Issue #4/#38、PR approvalは操作していない。
