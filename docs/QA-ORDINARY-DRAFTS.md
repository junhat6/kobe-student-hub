# 通常下書き接続の独立QA

## 対象と判定

2026-11-08、実装者とは別contextで、固定source `198eb4b9961d4a123bb08c4b74fff681522b9dc1` を別のdetached worktreeへ展開して検証した。[受入条件](ORDINARY-DRAFTS.md)に対する、source gateを閉じた通常下書き接続の統合を妨げる所見はない。product sourceとtracked testは編集していない。

後続の `cf7035a18c854a322061816f59d233ae79ac0766` は、通常welcomeの装飾spanを省く条件と、通常recoveryの左境界線を1pxにするCSSのみ。元sourceへの厳密な文字列置換・CSS追加との一致を確認し、API・router・状態遷移・認証・testの変更がないため機能結果を継承する。この独立ブラウザ実行と画像は `198eb4b` のもの。`cf7035a` の最終見た目の再撮影・確認は別担当の結果待ちとして分ける。

**追補・最終表示の別実行:** `cf7035a`で既存の通常下書き16件とprivate capture2件、計18件が成功（43.2秒）。保存・空・復旧のPC/mobile計6画像を実装担当がすべて開いた。空状態の装飾span不在と、復旧欄の左と上の境界が1px・同色であることを両viewportで検証。fresh reviewerも新6画像をすべて開き、先の2指摘をresolvedと採点、限定したverdict passは`ship`だった。rootも最終の空・復旧画像2枚と独立の比較・隠蔽画像2枚を確認した。これは上記の独立機能12群とは別の証拠で、実学校Google・実端末・学生価値の判定には加えない。最終表示runのowned server／browserと8790待受も終了した。

## 実行した検証

| 実行 | 結果 |
| --- | --- |
| `npx vitest run tests/ordinary-drafts.test.ts tests/draft-http.test.ts --reporter=dot` | 2 files / 15 tests成功、6.36秒 |
| 独立private helperによる実local D1・HTTP検証 | 追加5群成功 |
| 独立private Playwright helper | PC 1440×1000とmobile 390×664、各6群・計12群成功 |
| ブラウザ画像 | 成功runの12枚すべてをQA担当自身が開いて確認、SHA-256をprivate記録 |

既存fixtureをesbuildでbundleし、通常entryと同じ `createOrdinaryDraftHandler` を使った。新しいlabや認証方式は追加していない。ブラウザは既存の `scripts/session-browser-preview.mjs` が提供する、一時HTTPS・合成署名Google認証・実local D1を利用した。providerへの実通信やremote API操作はない。通常の全suite・build・公開E2E・dry-runは実装担当の別記録とし、この独立QAの実行数に加算していない。

### HTTP・source境界

- 在学年度の未登録・将来・終了済みを別々に設定し、本人の一覧・個別読取りは200、作成・更新は404、既存行の文章・versionは不変と確認した。既存の自動年度seedだけでは通過してしまう条件を追加した。
- 現在の年度へ戻しても、別の本人・別CSRF proof・異なるOriginは拒否され、既存行を変更しなかった。
- 同じcompositionをdisabledで使うとunmatchedとなり、書込みが発生しなかった。
- focused testでdefault-false、runtimeのenable風の値でも本体が405のまま、healthのwrites無効、private header、本人権限・CAS・期限・body取得中のepoch変更を確認した。
- sourceを読み、本体OAuth／draft gateと通常frontend visibilityのfalse、公開catalogのsample専用DTO境界を確認した。合成identity・fault hookはtests側にあり、本体のrequest入力として実装されていない。既存の最終SQLによるsession／在学期間の再判定を弱める変更はない。

### PC/mobileで各1回検証した6群

| 組合せ | 確認した結果 |
| --- | --- |
| 実際の保存commit後、JSONのbytesは届くがEOFが来ない | 10秒の総deadlineで結果不明となり文章を保持。stream cancelを確認。同session再確認と手動読取り・基準更新で保存済みと確認でき、PATCHは1回のまま |
| 作成commit後のACK保留中に移動を承認 | 移動先へ遅着ACKがeditorを再表示せず、戻ると作成済み1件。自動再作成なし |
| dirty入力を残してsession確認が503 | private領域はhiddenかつinert。BackとForwardの取消で同じrouteを保ち、同sessionの再確認後に入力を復帰 |
| 別画面の更新によるCAS競合 | 手元の文章を保ったまま保存版と比較。基準更新だけでは再保存せず、明示保存でversion 3となる |
| 保存commit後のACK保留中にsession変更 | 旧editorを破棄。遅着ACKを解放しても、新sessionへ明示続行した一覧に旧文章を引き継がない |
| catalogと下書き一覧の障害 | catalogに依存せず、一覧失敗でもdirty文章と移動確認を保持。手動一覧再試行で復帰し、Markdown・SQL previewを表示 |

全12群で文章・proofをURLやlocalStorage／sessionStorageへ保存していないことを確認した。通常editorのmain／header／footerは各1つ、lab表示とpublication composerはない。preview状態で外側横overflowがないことを測定し、画像でもPCの2列とmobileの縦配置、保存状態・比較版・非表示状態を確認した。

EOF条件は、実共有handlerの保存後にブラウザhelperがResponse streamの終端を保留する注入であり、実ネットワーク装置での障害試験ではない。初回helperのfetch差替え位置と状態の期待を補正した後、全12群を先頭から通した。productの修正は必要なかった。

## 指紋と後片付け

- 機能検証tree: `51d518299c3c232870fa7777cbfa059f6a3612b2`
- presentation修正後tree: `cca0eb0f743dff6cb46200ecab783f4735d31058`
- source／fixture／test／runner／受入文書の21ファイルについて、両commitのSHA-256をprivate manifestへ保存。差異は上記2ファイルだけ。
- private manifest SHA-256: `aa2f10538d61471c16cd724a184c28dddb76b0213cf39152384bbdd325aaee2f`
- helper・結果・画像はprivateに保持し、ファイル0600、保存directory0700。公開文書へ画像、認証proof、実ユーザー情報や感想を転載していない。
- 所有ブラウザは `browser.close()` 済み。既存runnerの所有process groupの親・子3processを停止し、同groupの残存0、8790のlistenerなしを確認した。他のserverには操作していない。worktreeの依存symlinkも削除した。

## 残る範囲

別contextのdocumenterは最終sourceと保存／復旧の代表2画像を確認し、既存の青・白・背景・境界、system書体、44px操作対象、PC2列／mobile縦配置の継承と判断した。新しい視覚体系・素材を追加せず、DESIGN.mdの形式やsidecar不在、既存shellの文字記号iconという以前からのdriftは変更・規範化していない。この確認でも実端末・学生価値・本番公開を承認していない。

この結果は合成認証とlocal D1による選択した競合条件の確認であり、実端末・実学校Google・全通信障害・全interleavingの証明ではない。reload／close警告を含む実装担当の既存16群と、この追加12群は別の実行として扱う。

一般ログイン・投稿は引き続きsourceで閉鎖している。実在学生の在学確認、学生の利用価値、実ログの秘匿性、remote schemaや本公開の条件を満たしたとは判断しない。[FIRST-RELEASE](FIRST-RELEASE.md)の未解決条件は残る。

## CI失敗後のtest診断と独立検証

PRのCI `42477089261` は、既存の匿名作品探索caseがeditor-mobileで30秒のtimeoutとなり、cleanupにもcontext不存在のエラーを記録した。editor全体は196成功・1失敗・既存skip 1だった。失敗caseのtrace／画像は保存済みartifactに含まれず、本文・header待ち・cleanupのどの段階が先に止まったかは不明である。元の失敗をflake、product不具合、特定のheader raceのいずれとも確定していない。

固定 `1acd561` のprivateな段階記録付きfocused runでは、同じcaseがPC/mobileとも成功した。各6本、計12本の`allHeaders()`がすべて解決し、Cookie／CSRF header不在、本文のprivacy検証、context終了まで完了した。この成功はCI原因の特定には使わない。

最終test source `3976eea6721801dc28889a3400a0b5ebd2401b62` を独立にreview・実行した。変更は `tests/editor-project-discovery.spec.ts` の最初のcaseだけで、productのsrc／worker treeと関連config・fixture・依存lockは元の `1acd561` とbyte同一。旧assertion・`allHeaders()`・すぐ次へ進むclick順序を保持し、データ取得待ちやretryを追加していない。

testは処理をnamed stepで区切り、header取得のエラーを直ちに観測したうえで、成功経路の5秒stepで必ず再throwする。待機中に追加されたcheckも同じ予算内でdrainし、listenerを同期的に外してからエラーとrequest数を判定する。観測対象はこの境界までのrequestであり、cleanup中のrequestを含む永続的な監視ではない。本文の失敗後にcleanupもrejectした場合は本文の失敗を保持する。全体の30秒timeoutは変更していない。

| 最終sourceでの実行 | 実際の結果 |
| --- | --- |
| 同じfileの3 cases × PC/mobile、private focused config | 6成功、exit 0 |
| `allHeaders()`が解決しない合成故障 | header stepが5,000msで失敗 |
| actual header取得後に合成Cookie項目を追加 | header assertionが失敗 |
| actual header取得後に合成CSRF項目を追加 | header assertionが失敗 |
| 存在しないUI条件と、実context終了後の合成cleanupエラー | UIの失敗だけがprimary errorとして残り、値を含まないsecondary warningを1件記録 |
| 最初のbatch取得後に実same-origin公開requestを追加し、そのheaderへ合成CSRF項目を追加 | 遅いrequestの観測・header評価を記録し、追加batchのheader assertionが失敗。header stepは85ms |

故障注入はprivateなtestコピーに限り、実requestへ認証情報やCookieを付けていない。故障5件のPlaywright結果は**5失敗・exit 1**であり、通常テストの成功数へ加算していない。これは新test driverが故障を見逃さないことの確認で、元CIの再現ではない。先行した `c4296ed` の6成功・故障4失敗は履歴としてprivate証拠に分け、最終sourceの結果と混ぜていない。

private helper・段階記録・結果・source指紋は0600、保存directoryは0700。所有reader contextとPlaywright runnerは終了し、editor runnerの親・子8processを停止、所有group残存0と8788待受なしを確認した。依存symlinkも削除した。QAによるtracked source／test編集、remote API・設定変更、CI再実行、merge、deployはない。

5秒で制限したのはheader stepであり、SDKの`ctx.close()`が永久に解決しない条件を検証したものではない。local focused成功はfresh green CIを代替しない。このQA時点ではreleaseを停止したまま、次のCI判定を別に行う。
