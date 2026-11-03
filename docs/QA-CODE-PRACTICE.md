# コピー待機・Git実践手順の独立QA

対象: [Issue #21](https://github.com/junhat6/kobe-student-hub/issues/21) / [PR #22](https://github.com/junhat6/kobe-student-hub/pull/22)、ソースcommit `1b8c452de4d4f1e7499874f8e3647e8beaa20c72`。実装者とは別コンテキストでソース/文言レビュー、ローカルWorkerとブラウザ、使い捨てGit環境を検証。対象ソースは末尾SHA256で固定。実装・テストは変更していない。

## 判定

検証範囲でblocking不具合を確認しなかった。手動選択は常時利用可能で、writeText未完了時にもpreへfocusして全DOM Rangeを選択できる。pendingを別stateで保持し、元のwrite要求が解決/拒否しても手動選択案内を上書きしない。実OS要求のcancelやtimeoutによる取消を主張していない。未完了のcopyボタン自体はdisabledのままだが、明示的な選択経路が利用できる。native要求は後から完了し得るという限界をCODE-ACTION.mdが明記する。

記事はブランチ作成、エディターでのREADME手動編集、diff確認、add/commitを順に分ける。コードblockは3つ、手動編集は本文説明でありコマンドに紛れない。既存commit・tracked README・cleanな自分専用練習repoの前提を明示する。編集保存を省けば新commitができないことと、正しい手順で記録できることを独立実行した。

SQLは公開架空sampleの特定id・is_sample=1・status=published・旧本文完全一致を条件とするbody UPDATEだけ。既存migration0002は差分なし。再適用/編集済み/旧本文だがdraft/旧本文だがnon-sampleを保護する。schema/auth/ledger変更なし。db:localはlocal指定、deploy:productionはWorker-onlyでremote SQLを含まない。seed generatorは適用済migrationを再生成せずignored .wrangler内へ出力する。リモートへの適用可否をこのQAの許可や動作結果から推測していない。

既存CARD-STUDYへの任意E23観察追加は、試したくない/環境がない回答も許容し、本人同意・使い捨て環境・私的記録条件を維持している。別proto/回答収集機能を増やさず、AI操作確認と学生価値検証を区別しており、過大な完成主張は確認しなかった。

## 独立実行

実装者の最終run終了通知後:

```sh
npx vitest run tests/worker.test.ts
npx playwright test tests/code-copy.spec.ts --workers=2 --output=test-results-independent-code-practice --reporter=list
```

Worker/D1 **6件成功 (460ms)**、E2E **8件成功 (8.0s)**。localhost/Chromium/Worker実行用sandbox許可を使用し、remote操作なし。実装者の70unit/38E2E/build/dryrunは独立側の全件実行とは区別する。

ブラウザはdesktop ChromiumとiPhone13設定mobile Chromiumで4シナリオずつ。自動コピーのDOM文字列一致、3block/手動編集見出し、拒否/未対応、手動Rangeとfocus、複数block/inline/空白tab日本語末尾LF、pending、late resolveとlate reject後の案内維持を検証した。Clipboard APIをfixtureに置換し、OS clipboardへ書込/読取せずpermission付与もしない。選択Rangeの一致はnativeコピー文字列の保証ではない。

独立Git実行は /tmp/kobe-independent-git-practice.mjs でsample.ts本文から3bash blockを抽出し、使い捨てrepoだけで実施。dummy identity、global/system config無効、hooks無効、GPG署名無効。初期READMEをcommitし1block目でbranch作成→編集無しで3block目を実行するとcommit失敗→README見出しを手動相当編集→2block目diffに変更を確認→3block目成功。最終branch `try-new-title`、commit数2、working tree clean。実ユーザーrepo/global configは使用・変更していない。fixtureはOS一時領域の `kobe-independent-git-lIZBQl`。これは学生による実践ではない。

## 画像証拠

独立実行から保存した4枚を実際に開いて視認。PC/mobileとも3blockと間の手動編集説明、通常copy成功表示を確認。pending画像では「コピー中…」と手動選択ボタン・案内・最初のblockの選択highlightが同時に表示される。mobileの案内は折り返して収まり、重なり・画面横はみ出しを確認しなかった。画像はfixture応答とUIの証拠であり実OS clipboard成功の証拠ではない。

| 画像 | SHA256 |
| --- | --- |
| [copy-success-desktop.png](evidence/code-practice/copy-success-desktop.png) | `8c7938684b53546d05b844859a7f919610719daee1ce6a39584effbc332a9d69` |
| [copy-success-mobile.png](evidence/code-practice/copy-success-mobile.png) | `5e82ab4f03e737b57e2c2197a84e0c328ec6a66f1eaf5cc25ff64585500d5c2d` |
| [pending-manual-desktop.png](evidence/code-practice/pending-manual-desktop.png) | `0c0907c563b50c85c82fa563436b54347684752987a391c7fb29f975fa8b0c45` |
| [pending-manual-mobile.png](evidence/code-practice/pending-manual-mobile.png) | `3accb54285e9faa54f71ca319e72f4db465ff88e1497ef4b34d68fe4c2782fb5` |

## ソース照合・限界

```text
e0f35c9b544f1ca17a2ee138f84f9f87817bfe8b6720dbb96788a68bb0baa805 src/CodeBlock.tsx
890c06f7c7a9aba84da84b6f90ea6efb37d5f98f25cca3b164a5a45d1af4fff6 src/sample.ts
6dbe6b22155e69fd7adfff9a2016d69bc329fb18eea16310e5e4bbe155cb10d5 content-revisions/0001_git_practice.sql
2f85e636b8552e32359f01cba762fe493c91a3b8bc59ff3f9b138fae69952df6 tests/code-copy.spec.ts
75dda3be92a97b8be72f0291b7d6a9a978e8b2a516bc8a6db6c86701d8ddfbc8 tests/worker.test.ts
bf29ac92ff284c91e2c1be3eb374409cfa3aa83c4654fb4f6b7d3e47758bc8ce package.json
6e3464734aa3ff43c5d5d791050ba6215d28ca510e7c0095885d38069972bdad scripts/generate-seed.mjs
```

公開配信後、remote content revision、native OS clipboard/permission UI、物理端末/Safari、スクリーンリーダー、学生による理解・価値検証は未実施。認証・remote SQL・R2・契約・設定操作は行っていない。特定学生の実データや履歴は使っていない。
