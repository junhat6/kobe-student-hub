# コードコピーの独立QA

対象は Issue #19 の本文コード操作。実装者とは別コンテキストでソース・文言レビューとローカルブラウザ検証を実施。以下ソースhashで検証対象を固定する。実装・テスト変更なし。

## 判定とレビュー

検証範囲でblocking不具合は確認しなかった。DOMのpre.textContentだけをwriteTextに渡し、ハイライトmarkupやtoolbarをコピー対象に混ぜない。Promise解決後だけ成功を表示し、pending時は再操作をdisabledにする。拒否/未対応は例外詳細を露出しない一般メッセージと明示的な手動選択へ進む。選択時はpreへfocusし全DOM Rangeを選択する。clipboard読取り、コード実行、execCommand、記録・永続保存、新たな権限要求処理は追加されていない。raw HTML無効、inline codeの表示、画像非表示の境界も維持する。

初期レビューで操作ボタン40pxとDESIGNの44px目安との不一致を指摘し、実装者が44pxへ修正。最終ソースで確認した。重大なアクセシビリティ不具合としては扱っていない。buttonのaccessible nameとstatus、手動選択後のfocusをブラウザで検証したが、スクリーンリーダー実機の読み上げは未確認。

CODE-ACTION.mdはE23からH03を仮説として分離し、他候補を保存/認証/運用条件や学生trial待ちと比較している。コピー回数を学習や価値と同一視せず、編集画面や新protoを追加していない。実OSのpermission/clipboard挙動を未保証とする説明は実装と一致する。

## 独立実行

実装者の最終run終了後に実行:

```sh
npx playwright test tests/code-copy.spec.ts --workers=2 --output=test-results-independent-code-copy --reporter=list
```

**6 passed (5.0s)**。3ケースをdesktop Chromium / iPhone13設定mobile Chromiumで各1回、新規contextで実行。mobileはエミュレーションであり実iPhone/Safariではない。ローカルChromium/localhost用sandbox許可を使用。実装者の全36E2E/build/dryrunと独立6件を区別し、全体再実行とは主張しない。

- 実記事の表示コードをコピーし、fixture writeTextへ渡された文字列がpre.textContentと完全一致。成功表示を確認。
- 拒否・API未対応を単一initScriptとURL modeで確定し、内部例外が非表示であること、失敗案内、選択後pre focusとRange.toStringの完全一致を確認。page横はみ出しなし。
- 2つのblockとinline codeをfixture記事で表示。2番目だけの先頭空白・tab・日本語・末尾LFを含む文字列一致、literal script文字列の非実行、pending disabled・成功未表示、Promise解決後の成功を確認。

Clipboard APIだけをresolve/reject/unavailable/deferredのpage fixtureへ置換し、OSクリップボードを上書き・読み取りしていない。手動のRange選択確認はnativeコピー内容の保証ではない。ChromiumのSelection.toStringは末尾LFを省くため、実装者初回runのその等価assert失敗はRange照合に修正済み。自動writeTextのDOM文字列一致とは区別する。

## 視覚証拠

独立出力から4枚を保存し、実画像を開いて視認。PC/mobileともコード付近に「コピーしました」があり、手動選択では「コードを選択」と端末操作案内、選択ハイライトが見える。mobileの案内は折り返して収まり、重なり・画面横はみ出しを確認しなかった。成功画像はfixtureの応答を表し、OSクリップボード成功の証拠ではない。

| 画像 | SHA256 |
| --- | --- |
| [copy-success-desktop.png](evidence/code-copy/copy-success-desktop.png) | `b596ddab83e5735e0ddf3ca65ff51623c162a1807df18bc0536c0714ea899295` |
| [copy-success-mobile.png](evidence/code-copy/copy-success-mobile.png) | `85e596b44463d4fdd76946c13eaf46caeeac2cb7ded0a192354d2ed51cd40ec3` |
| [manual-selection-desktop.png](evidence/code-copy/manual-selection-desktop.png) | `7f7c5dd6b409c66e175577fdd7ecf8a1e53072c2af1896f2e970829d8a13aa66` |
| [manual-selection-mobile.png](evidence/code-copy/manual-selection-mobile.png) | `b1afa4bb1e1d2428cd75e2f2dd3f861e7ae8d8324a38b584fd54acc36a40bd33` |

## ソース照合・未実施

```text
92de64b3b34bea424a4e8dbefa272e1e30a405b8e554a61363d329aac8439451 src/CodeBlock.tsx
dea970305d4ae293e0ce1fd76c1c1eddb20c5a9948822c4337d93175d89b4ea9 src/MarkdownRenderer.tsx
d888926dc3f5a5bb90c024129c90f0d8ec29d818c390cdf0798bfa313baecf1c src/style.css
81a0f2ab3d72486c5acd4693d1ddff5db7a3a152f833fad877cfd75dfca70124 tests/code-copy.spec.ts
```

公開配信後、native OS clipboard/permission UI、実端末/Safari、スクリーンリーダー、学生の実践・理解・価値検証は未実施。実コマンドも実行していない。remote SQL・認証・R2・契約・設定に触れていない。後続では合意した使い捨てclipboardでの実機確認と学生trialを分けて行う必要がある。

### Commit correlation

独立runは上記hashで固定したworking-treeに対して行った。後から実装者が、4ファイルがPR #20のsource commit `ba456d00c75221e9d89835655a6304d08706714c` と一致することを照合した。commit時点を独立run開始時点と取り違えない。
