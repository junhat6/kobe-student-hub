# 一覧復帰の独立QA

対象: [Issue #17](https://github.com/junhat6/kobe-student-hub/issues/17) / [PR #18](https://github.com/junhat6/kobe-student-hub/pull/18)。検証ソースは `7b36e2781d265b2a3a5f3c1cf423561f57c869ee`。実装者とは別コンテキストでソースレビューとローカルブラウザ検証を実施した。架空サンプルのみ。実装・テストは変更していない。

## 判定

この範囲でリリースを妨げる未解決の不具合は確認しなかった。検索語・タグ・種別を保った一覧復帰、同一タブの元カードへのフォーカスと位置、関連コンテンツ経由の復帰が両viewportで成功した。学生の理解・有用性や実端末品質を検証したという判定ではない。

レビューで指摘した2点は実装者が修正し、最終ソースで再確認した。

- 直接開いた詳細の `from` だけを根拠に、詳細ページのスクロールを一覧位置として生成していた。現在は実際の一覧からの遷移だけがsnapshotを生成し、関連カードは存在するsnapshotだけを継承する。snapshotなしでは一覧先頭・mainフォーカスとなる。
- 入力4096文字以内でも日本語のURL正規化で出力が4096文字を超え、再検証時に拒否される可能性があった。現在は出力長も制限し、正規化の冪等性と日本語膨張の拒否をunitで確認する。

`safeListPath` は既知の公開一覧経路と既存パラメータのみを再構築する。外部URL、protocol-relative、backslash、fragment、API/詳細経路、長すぎる値を拒否し、不明パラメータと入れ子のfromを落とす。認証境界として扱っていない。復元値は対象URL一致、有限かつ上限内のy、制限長のentryIdを検査し、カード照合に値をCSS selectorへ埋め込まない。Mapは50件上限で、history stateにも小さな復元情報が入る。ブラウザ履歴の秘匿保証ではないという説明は実装と一致する。

## 独立実行

実装者の最終検証完了後に次を実行した。

```sh
npx vitest run tests/navigation.test.ts
npx playwright test tests/list-return.spec.ts --workers=2 --output=test-results-independent-list-return --reporter=list
```

結果: unit **4件成功**（56ms）、E2E **8件成功**（3.5s）。4シナリオをdesktop ChromiumとiPhone 13設定のmobile Chromiumで各1回実行した。モバイルはエミュレーションであり、実iPhone/Safariではない。localhost/Chromium実行に必要なsandbox許可を使用した。実装者報告の全68 unit / 30 E2Eとは区別し、独立側で全件を再実行したとは扱わない。

- 検索 `制作` + タグ `学び方` + 記事種別の1件一覧から詳細へ遷移。Back/Forwardと「← 一覧へ」で条件を保持し、元カードのフォーカスとy差4px未満を検証。横はみ出しなし。
- 実カードhrefを `window.open` で別タブに開き、その詳細をreloadした後も一覧条件を保持。別タブへの元位置移転は検証・保証しない。直接リンク、外部from、API fromはホームを既定とし、復帰先4件を確認。
- 作品フィルタと比較カードBの一覧状態を保持。
- 直接詳細→関連作品では架空の一覧位置を作らず先頭/mainへ復帰。実一覧→記事→関連作品では元一覧カードと位置へ復帰。

実装者の初回E2Eにあったaccessible nameのlocator誤りはテスト側で修正済み。最終独立実行では再現しなかった。

## 画像証拠

以下4枚を独立実行の出力からコピーし、実画像を開いて視認した。復帰一覧には検索語「制作」、記事選択、学び方タグ、1件のカードがPC/mobileとも見える。直接リンク画像には「← 一覧へ」があり、レイアウトの横はみ出しや重なりは見られない。ただし直接リンク画像は本文lazy読み込み中の瞬間であり、本文表示完了の証拠には使わない。href安全性とクリック後の4件一覧は上記E2E assertionが根拠。画像だけで位置・フォーカス復元を証明するものではない。

| 画像 | SHA256 |
| --- | --- |
| [復帰一覧 PC](evidence/list-return/restored-list-desktop.png) | `6c41275a84944839cdae205bf7bfb536d7fc9291858ddeeda59e910a3e565ebc` |
| [復帰一覧 mobile](evidence/list-return/restored-list-mobile.png) | `98538c24da0a5bb12388703ed6a52566051329a9b3ca0b7c9f285233e3e3fa0c` |
| [直接リンク PC](evidence/list-return/direct-link-default-desktop.png) | `52b943121b4cb8588d18b9160e923cfb21321f2de379df4930d1c0a61c8b43ae` |
| [直接リンク mobile](evidence/list-return/direct-link-default-mobile.png) | `66db00d4ba964ef8f321d0626f824e393759a1be426a2d4df5d31b069faad13a` |

## ソース照合と限界

SHA256:

```text
37700d7b3465b57e3456b47ea9b09cb486079856b24fd66e9782c76d8087843c src/navigation.ts
850203208fe24860a310ace8093ff283496ab615c9338f071327baf71e0f552a src/usePagePosition.ts
ea3e902d5b89325b404e85b9b07f9f361b53f0bd9ede2f237cb23a3166f3b47d src/main.tsx
8657e2a8a978fc1f74c40c697ecc34d996720d3e676b5326ca22a774bab9d350 tests/navigation.test.ts
6414b4a65b95a9937db4d9b9009052f00eda2c93561e9e0d2e1a797a3abb6155 tests/list-return.spec.ts
```

公開配信後の確認、実端末、Safari、ブラウザ再起動、動的データ変更時の復元、全投稿者プロフィール遷移graph、学生による価値検証は未実施。本文読み込み中の任意アンカー復元も対象外。`docs/LIST-RETURN.md` はこれらの境界とhistory stateの存在を明記しており、検証範囲の過大な主張は確認しなかった。リモートSQL・R2・契約・認証操作は行っていない。
