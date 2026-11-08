# 制作ノート・技術選定の独立QA — 2026-11-08

最終受入対象は `927c015`。末尾の再検証に阻害所見なし。以下の初回 `f8eb31b` の記録と画像指紋は、修正前の履歴として保持する。

## 初回f8eb31bの判定と対象（履歴）

提示範囲に阻害所見なし。対象sourceは `f8eb31bd2ae25d3dd86c00c27af3a2244618fdf4`（base `6812f1e`）。実装者とは別のQA contextで、固定commitをdetachした別worktreeから実行した。さらに独立した二つのtaskで、参考実験の再計測と手動D1監査を分担した。実装source・既存testは変更していない。

[受入条件](LEARNING-NOTES-DECISIONS.md)に沿い、公開架空sample `learning-notes`一件の技術選定例を確認した。題名・投稿者・関連先と既存画面を維持し、架空の制作／作品説明、運営による生成データの参考実測、公式技術資料を区別できる。起動・import後の10秒条件、両候補が条件内だった事実、工程を理由に選ぶ判断、条件変更時の再選定、就活で判断と未確認を説明する例までつながっている。3項目は「条件・判断・確認」で、各一文から始められる。

これはAIによる実装・動作QAであり、学生の理解・実践、記録負担や就職成果の成功判定ではない。本記録でremote editorial SQLやWorker配備は行っていない。

## 実行したlocal checks

| 実行 | 結果 |
| --- | --- |
| `npm run build -- --configLoader native` | TypeScriptとVite build成功。同梱dependencyを参照し、独立worktreeへbuild |
| `WRANGLER_SEND_METRICS=false npm run db:local` | local D1の17 migrationsとeditorial 0001/0002/0003成功 |
| `WRANGLER_SEND_METRICS=false npm exec -- wrangler deploy --dry-run --outdir .worker` | local Worker bundle成功。実配備ではない |
| `vitest run tests/worker.test.ts tests/catalog.test.ts` | 2 files／20 tests成功、893ms |
| 独立手動Miniflare/D1監査 | 27 cases成功、0.72秒 |
| 固定Python環境で参考実験scriptを別出力へ1回再実行 | 3反復×2 engine、両phaseの全96組一致 |
| 実Chromium desktop／mobile | 12受入群×2 contexts＝24群成功。長いcodeの内側scrollは追補4 checks成功 |

既存Worker testは、実D1の公開DTOとsource sampleの一致、旧0002と新0003の正確な一件変更・再実行0件、各guard対象の変更拒否、private/non-sample保護、逆操作と他row保持を実行した。public DTOは架空4件／2プロフィールを維持し、auth・投稿は閉じたまま。

独立手動監査では、全17 migrationsとeditorial 0001/0002から作った別の実D1を使用した。rollbackは全15列それぞれの独立変更を拒否し、forwardのID変更拒否、同一本文の別IDを両方向で保持、draft/deletedの両方向拒否、一件変更・idempotency・完全roundtrip、他3行不変を確認した。これはminimal fixtureの保存境界の証拠であり、公開HTTPの証拠は既存Worker testと下記browser操作で別に得た。

historical editorial0002とその逆操作はbaseからbyte一致。新SQLはschemaやmigration ledgerを変更しない。独立worktreeのtracked source差分は終了時0件である。

## 参考実験の独立再計測

既存のPython 3.12.12／DuckDB 2.0.0／SQLite 3.50.4環境を使い、元 `results.json` と異なるprivate出力へ同梱scriptを一度だけ実行した。依存取得・サーバー・remote DB・LLM呼出しは行っていない。元resultsの指紋は不変。

- 生成CSV：1,000,000行、18,139,028 bytes。
- CSV SHA-256：`f54a34d7d4bb768973b635c21ba1b3a01cd9847ad363d720735c390edb303cf8`。
- 全96組の件数・合計は、全6 runの両phaseで生成時のPython oracleと一致。
- 結果SHA-256：`9959ffa74a3a632890c277c1b3d16043f7f944337c23f414a0d520bd5003dedf`。

| 独立再計測・3回の中央値 | DuckDB | SQLite |
| --- | ---: | ---: |
| CSVから初回集計結果まで | 0.065963208秒 | 0.756272042秒 |
| 取込済みin-memory tableのqueryのみ | 0.011419375秒 | 0.282894500秒 |

再計測も両候補が10秒以内だった。記事の0.065秒／0.741秒は元の運営参考実験を丸めた値であり、再計測値で上書きしていない。タイミングの厳密一致は受入条件にしていない。

本文のSQLは改行と任意の末尾semicolonを除けば実験SQLと一致する。初回workflowは接続・CSV処理・集計を含み、SQLiteではPython CSV解析・整数変換・取込を含む。起動・module import・生成は除外し、OS cacheは未制御。取込済みqueryは別phaseである。メモリのピーク、永続化の耐久性、同時更新、実データ、別のloader／index／SQL／端末は検証していない。DB全般の速度順位に一般化できない。

private再計測結果SHA-256：`893be285540c494a83b9f0e7eeed0f51672c9cb1f455ac0ee7c0376a2f2d7371`。生成CSVの一時directoryは前後で残存差分なし、benchmark worker残存0を確認した。

## 実ブラウザーと画像レビュー

rootの確認用serverと別のlocal portを使い、実Worker／local D1から表示した。desktopは1440×1000、mobileはChromiumのiPhone13相当390×664。物理iPhone・Safariの試験ではない。

各contextで次の12群を確認した。

1. 架空4件／2プロフィール、書込停止health、homeの架空notice。
2. home→記事と、title／summary／想定読者／前提／読後説明のsource一致。
3. 架空の制作と運営の実測、時間条件・未確認の区別。
4. 月×カテゴリのSQLと、2候補・中央値を示すtable。
5. 「条件・判断・確認」の正確な3行枠。
6. SQLのnative clipboardへの完全コピー。
7. 3行枠のnative clipboardへの完全コピー。
8. clipboard拒否を注入したSQLのmanual selection fallback。
9. 同じく3行枠のfallback。
10. 記事→正しい投稿者→同じ記事。
11. 関連作品→その作品の投稿者→記事への復帰。
12. 9地点のdocument横overflow、runtime error、通信範囲。

native clipboardは計4件すべて、改行を含む表示payloadと一致した。SQL142文字、3行枠136文字であり、source本文のcode block指紋とも一致する。fallback計4件はfocusと全項目を保持。native Range選択は末尾改行1文字を省略したため、その差だけを区別して確認した。clipboard拒否は注入試験であり、実端末の権限拒否操作とは異なる。

18地点でdocument横overflowなし。長いmobile codeは内側の `code.hljs` が横scroll可能で、SQLはscroll幅641／表示幅308、3行枠は619／308だった。末尾側も実操作・画像で確認した。各contextのpageerror、console error、外部要求は0、観測したbrowser通信はlocal GETのみ。参考資料への外部リンクは自動で開いていない。

最終11画像と追補2画像、計13画像をQA担当が実際に開いて確認した。本文・SQL・table・3行枠・活用例は提示viewportで判読でき、tableの2候補と対応値を識別できた。画像はlocal/privateに保持し、repositoryやpublicへ追加していない。以下は内容を公開しない照合用指紋だけである。

| local image label | SHA-256 |
| --- | --- |
| `desktop-01-top.png` | `ec7edae21bc83d794f2780402351f3c7c465a39fb0a1b404a40f407feb0f672e` |
| `desktop-02-sql.png` | `a7720a71d23662eaf10edddd1f7ac23554e618f5afe12cb17d57f70b94576994` |
| `desktop-03-measurement.png` | `67463aae5f2f1fc84b4846647d6ab21284e4e8c145e5bf6d4f8f3b746527aec9` |
| `desktop-04-three-lines-copy.png` | `1df3e533ca7b73ea4f61bf327ea7102fab63b390eaa7c111d8c090bbffc61a21` |
| `desktop-05-reuse-and-explain.png` | `10f1955ad54e580e6ea21f2dec70046c12eac71149e33c84807cfcb600b1cb01` |
| `mobile-01-top.png` | `ad1f1397504973bdb55289e87008453ceaeb1aeec6bb6f87e9abaff0d187e252` |
| `mobile-02-sql.png` | `118a7bc6cbd03cf516a9fbed857c0896418c854f357100ae2985e186dbacef71` |
| `mobile-02b-sql-right.png` | `997fcc3a26cec4d655a8e6c0ba3788b1b27e810d7d6e8a6062f20eb3836f9e24` |
| `mobile-03-measurement.png` | `a538e19a7ef69c64589af801ac2dff8c8e4103f406c40e5c60432f04e9261814` |
| `mobile-04-three-lines-copy.png` | `679cf251fd675a36a4614b7aef93962d7172c083393d4c7c70724e150dbba6f1` |
| `mobile-05-reuse-and-explain.png` | `d08c3b1a48830686a0a6a1706da04eb316b29c1a5c9508f34fbb1117b50bcdc5` |
| `mobile-followup-frame-right.png` | `dfc4267a5321d10807e25613b33429660d33f3eb32ae30679a8bc260941c5087` |
| `mobile-followup-sql-right.png` | `4f73a5b1b614148e98b24df89eb36c64537801b7e7e416291715588573e4701a` |

## 診断と終了確認

初回server起動は、repositoryのpreview scriptが固定したportと追加port引数が重複し、Wranglerが起動前に拒否した。listenerは作られていない。同じrepository設定を使う同梱Wranglerの明示的なlocal起動へ切り替えた。

browser初回は関連作品への遷移直後に古い見出しを読んで停止した。QAコードの待機を、切替先の見出し一致へ修正し、24群を全件再実行した。product sourceやassertionは弱めていない。画像レビューでは、最初の右端確認が外側preを操作していたため、実際の内側codeを対象とした追補を行った。`mobile-02b-sql-right.png`単独を右端表示の証拠にせず、二つのfollowup画像と4 checksで確認した。

検証用serverは目的を分けた2 runで、それぞれ所有process groupの6実行単位をTERMで終了した。強制killなし。終了後は所有process残存0、8897／9247のlistenerなし、両Chromium root process終了を確認した。最初の拒否された起動と、一回目のserver rootも残存しない。手動D1のMiniflareをdisposeし、そのworkerd子1件も終了。未知・他sessionのserverは操作していない。

## source／test指紋と残る条件

| source at fixed commit | SHA-256 |
| --- | --- |
| `src/sample.ts` | `e9b325a65f8f23706d4dd73e3f1f48698ec92ab33baa0c46ed8efce011ae95c2` |
| `content-revisions/0003_learning_notes_decisions.sql` | `5fb7ca97a5fea8eb2d0bb57c7093e77c4613b7aa7c29a30b05e03b454659a3c9` |
| `content-revisions/rollback/0003_learning_notes_decisions.sql` | `64cf69c6f551dbb897fe6e94f7e5d4a0e06e3307ca55df2d6f0579b34f665511` |
| `package.json` | `cc17ccc3b546c356ee63190188d8fe3497e85ba521e2e540f2a60af8b6a7c43d` |
| `tests/worker.test.ts` | `bc1b674eafbce3ab6739c70dbf388354fcc799e840907552c7f64afff051e7fe` |
| `tests/catalog.test.ts` | `88dddac6b35e80063e9e1650623c25f1c2bde9cbf03101c7fd6f96404004c3be` |
| `docs/LEARNING-NOTES-DECISIONS.md` | `50159b958ec37aed7a536038a08bcc3b4cb993e8015dbf6e11d6e250d94ef4c2` |
| `experiments/learning-notes-db-choice/README.md` | `b923b45aa88abbba030bd0a5ed1bb6231ef6af19c29128e99a6d003746bbaa1a` |
| `experiments/learning-notes-db-choice/benchmark.py` | `fb0d8b22502ecee72bf4ea8abbd70b5aac910d84ae1dc98a87f8daa25af49eff` |
| `experiments/learning-notes-db-choice/results.json` | `b2ce961e594203ef756aa0d476273e95a20027e73c06ca7b30d1cd1eb1cfd4f7` |
| `content-revisions/0002_learning_notes.sql` | `02d630ceec3df792e84e67d278f6eb3e8d756b5a79fa7da2a97fe8248fd9060f` |
| `content-revisions/rollback/0002_learning_notes.sql` | `b46f75d53b0dd21aa2c3d911fccbade78c95b1d52df54f876c223fc1fcba03d2` |

独立手動D1 helper SHA-256：`882a64766431028481fa7f84602d27187de3d3bca250da242dd9b9e0f3b44d58`、sanitized結果：`63440ad1bbf8dc6fa5cb2bf90e682f552ffa2a5a21bffbc7fda7a4168392ebbe`。補助script・結果はprivateに保持し、新しいrepository testや機能は追加していない。

private QA helperと結果の指紋（内容・所在はpublicへ追加しない）：

| artifact label | SHA-256 |
| --- | --- |
| browser helper | `f6c1aaf52d60352cf28af6e8685e1fc3369a22cd80215f439e6307a0ca697985` |
| browser final result | `91f8e196cf87699a21e0ef0d023137ff5c6930a4d89fdab94e8be734023194ef` |
| inner-scroll helper | `03557f4adaa16e5e825d36d34f1dedb72990f01ce18c80d346cd08f0964c85b6` |
| inner-scroll result | `85880432f63f5f4885a22073ef444473782d265aae75c4df55215183c34ebfe2` |

本記録はlocalの実装・動作と参考実験の再現まで。学生価値、物理端末、実ユーザー、実認証やログ保護を証明しない。実公開へのeditorial適用には、green CI／main反映後の対象・現在値の照合、一件変更と他sample不変、別担当のGET-only確認が別途必要である。Worker rollbackで記事本文が戻るとは扱わない。


## 最終版927c015の再検証

最終sourceは `927c015fe87fa1eabc3bfcaa5b6c5df1ac1722dc`。rootの画像確認で長いtable行説明と数値が近接していたため、本文の2行ラベルを `DuckDB`／`SQLite` へ短縮した。source sampleのbody、forward0003のSET body、逆操作0003のWHERE bodyに同じ変更がある。他metadata・本文・CSS・renderer・測定script/resultsは不変である。

独立worktreeのlocal DBへ、checkout前に旧f8の正確な逆操作を適用し、その後927へdetachして `db:local` を再実行した。新たなmigrationはなく、0003の新本文をsource一致DTOと実画面の2行ラベルで確認した。remote操作は行っていない。

| 最終sourceでの再実行 | 結果 |
| --- | --- |
| build（native config loader）／Worker dry bundle | 成功 |
| local DBの旧逆操作→新0003 | 成功 |
| 既存Worker＋catalog | 2 files／20 tests成功、953ms |
| 同じ手動実D1監査 | 全27 cases再成功。全15列のrollback変更拒否等のassertionを維持 |
| PC／mobile browser | 同じ12群×2＝24群再成功。table先頭列が正確にDuckDB／SQLiteであるassertionも追加 |

native SQL／3行枠コピー4件、注入した拒否時のmanual selection4件、document横overflow18地点、実際の内側code scroll4点を確認した。pageerror・console error・外部要求は各contextとも0、観測したbrowser通信はlocal GETのみ。修正後の12画像をQA担当がすべて開いた。PC/mobileとも、短い行ラベルと対応する0.065秒／0.741秒を読み分けられ、既存の前後文に取込手順の説明も残っている。旧f8の13画像とは別のprivate領域へ保存し、publicには追加していない。

benchmark script・元results・READMEは初回QAの指紋と一致したため、新たな再計測は行っていない。前述の独立再計測結果と限界を継承する。測定の最適化・数値の変更・学生価値の成功判定は追加していない。

最終source指紋：

| source | SHA-256 |
| --- | --- |
| `src/sample.ts` | `9f9366854fbe0249bf36b24edc99d785d6eef86c5b6ffe835301b2fc70f0945e` |
| `content-revisions/0003_learning_notes_decisions.sql` | `9fcb61711c55ca5549fba8044576779c79acc6a9857c875d9afafe775dba27d0` |
| `content-revisions/rollback/0003_learning_notes_decisions.sql` | `116b14129bb2889422a8851c7df2c76a212374b333c6ba8f0cf15e7d08209168` |

最終画像指紋（label先頭の927c015で旧画像と区別）：

| private image label | SHA-256 |
| --- | --- |
| `927c015:desktop-01-top.png` | `ec7edae21bc83d794f2780402351f3c7c465a39fb0a1b404a40f407feb0f672e` |
| `927c015:desktop-02-sql.png` | `7c191d3babbe349184716786ffb2c9f11481e4ac0489a449f7c99522bc1c54ba` |
| `927c015:desktop-03-measurement.png` | `8aba153d90e5d9633c060791d9eb1b09b92996105c67bb4965d7cd2ed9084fb0` |
| `927c015:desktop-04-three-lines-copy.png` | `1df3e533ca7b73ea4f61bf327ea7102fab63b390eaa7c111d8c090bbffc61a21` |
| `927c015:desktop-05-reuse-and-explain.png` | `10f1955ad54e580e6ea21f2dec70046c12eac71149e33c84807cfcb600b1cb01` |
| `927c015:mobile-01-top.png` | `6a1317f563e9c32aa83b7ffa4269979b8afd0a7694893e4f3984889e9c950495` |
| `927c015:mobile-02-sql.png` | `55181392c1d34aca4779e8fe4ed0c53a4101253965c26dfbe7a66f46e7318335` |
| `927c015:mobile-02b-sql-right.png` | `b83f93cc3388201794118eb51031b4a65262dc71d01afd5b644737797290d181` |
| `927c015:mobile-03-measurement.png` | `2526656213912efbc1dec5c724f1675124129852debdc8031563bcfbba27810c` |
| `927c015:mobile-04-three-lines-copy.png` | `c51c889bc4159af755c99e696f88a10ed40ad0a3dc8d1488502bad7f8eaf17b2` |
| `927c015:mobile-04b-three-lines-right.png` | `58189a3e870d8f7b06244f874ff0bcc091c060afcaa77ee42aabd70a89732ef8` |
| `927c015:mobile-05-reuse-and-explain.png` | `d6964f86795161ed54978e36ee50e665d9ecb89e4b0a8865277afbd6c6cf1276` |

最終private browser helper SHA-256：`2a5465e382a0655a98a559ca460e78c30c4fe0638acfdb95beb29cdfa126b50a`、結果：`f1ceb6620ba0b7d1c97683fce2e0e34e29acf8e55f030598527bf51bf6559338`。手動D1 helper：`c5776f288bea6c2b9d2f95570afcb08210e36ae5b4d2810d51b38696bde66324`、結果：`68df8ed1e3cb9abfae9214d41c421c82a8071a0bb5acff78f77573063d44b7bd`。手動helperの変更はcommitと出力名だけで、assertionは維持した。

最終の所有serverは6実行単位を自分のprocess groupへTERMして終了し、残存0・8897／9247のlistenerなし・Chromium root終了を確認した。強制killなし。手動D1の所有workerd子1件も終了。rootや未知のserverは操作していない。

最終提示範囲に阻害所見なし。実公開への適用と別担当GET-only確認、学生の理解・実践、物理端末等の残条件は初回記録と同じである。
