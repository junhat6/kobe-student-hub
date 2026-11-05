# セッション応答順 — 閉じたローカルD1/HTTP検証

2026-11-05。設計ドラフトPR84を基にした検証用fixture。本体実装ではない。`tests/fixtures/session-order-lab.sql`はmigrationではなく、独立したMiniflare DBにだけ読み込む。アプリ、認証ゲート、実Google、鍵、credentials、権限、実データ、Cloudflare runtime設定、remote DB、配信は変更しない。

## 構成と保証する範囲

テストは実際のloopback HTTP listener（127.0.0.1、動的port）へNode fetchを送り、Worker runtimeとローカルD1 bindingを通す。CookieはテストjarがSet-Cookieを適用する。HTTP上のCookieヘッダーと応答順を確認するが、ブラウザによるSecure/SameSite/HttpOnlyの実際の適用を検証したものではない。fixtureの固定Originは架空のHTTPS originで、loopback transportのcanonical host/HTTPS構成を本番に移植してはならない。

外向きfetchはMiniflareのoutboundServiceが架空providerとpauseを捕捉し、その他の宛先を拒否する。架空本人A/Bは一文字のstub応答であり、学校Google署名・PKCE・state/nonce・暗号化Cookie等の認証証明ではない。ephemeral UUID、架空account/recordとSHA256 token hashだけを使い、運用鍵や新しい実credentialは作らない。`X-Lab-*`の時計・pause/fault、架空actor DTO、Origin設定はすべてテスト専用。productionからのimportは禁止。

## モデルから具体化した契約

| 段階 | ローカルSQL/HTTPで検証する処理 | 応答Cookie |
| --- | --- | --- |
| bootstrap | contextのないブラウザに新しい匿名contextだけを作る。既存有効contextには409。不明IDを再使用しない | 新しいcontextのみ、一度だけ |
| command proof | 同一Originの空POSTで、context/action/expected epoch/expiryに結び付いた新しいcommand nonceを保存。actorやsessionを返さない | なし |
| start/logout | 条件付きUPDATEが新しいnonceを一度だけ消費。triggerが同じ操作でepochを進め、startだけattemptを作る | 勝ったstartだけattempt。logoutはなし |
| callback claim | stateとattempt Cookie、request context、最新epoch・期限を確認し、一つのUPDATEでowner ticketを獲得。ownerは応答へ出さない | なし |
| session発行 | provider後に取得したaccount epochを固定。INSERT SELECTがowner/未完了/attempt・context期限/contextとepoch/active/account epochを再確認。UNIQUE attempt＋triggerで一回だけ完了 | INSERT勝者だけ新規session |
| private read/write | preflight後にも、最後のSELECT/UPDATEでcontext一致・最新epoch・account active/epoch・expiryを確認。writeはsession CSRFも必要 | なし |

**再送仕様は旧モデルから変更した。** nonceは発行時のexpected epochに固定し、未完了コマンドが古くなれば409で拒否する。古いlogoutを新しいBのepochへ読み替えない。完了済みnonceは200の`already-completed` acknowledgmentだけを返し、世代を再更新せず、attempt/session/context Cookieも再発行しない。「今もログアウト中」「元のstartを再開できる」という現在状態の証明ではない。nonce期限後は確認できず409になる。結果不明時に古い操作を自動実行し直さず、利用者の明示した新しい操作を必要とする。

## 原子性と失敗の扱い

[D1公式batch仕様](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)は、順次トランザクション実行と後続SQLエラー時の全体rollbackを定義する。SQLの0行更新はエラーではない。したがって単にbatchへ並べるだけではなく、勝ったcommandのUPDATEに[SQLite AFTER trigger](https://www.sqlite.org/lang_createtrigger.html)を結合し、epoch更新とattempt作成を行う。別リクエストが進めた「最新epoch」を後からSELECTして誤ったattemptへ付ける方式は使わない。RETURNINGで勝者を判定し、trigger後の世代はDB照合で確認する。

後続SQLへの意図的なエラーで、nonce消費・epoch更新・attempt作成が全て戻ることを検査する。session INSERT側も後続エラーでsessionと完了markerが共に戻る。ただし、それより前に完了したclaimは戻さない。provider失敗や発行失敗後のcallback再送は再交換せず、新たなstartが必要。

commit成功後に応答が不明になるケースも分離する。command commit後の503は、同じnonceの再送で世代を再更新しない。session commit後の503は、有効な未配達session rowが残り得るが、再送で再発行・再交換しない。古いsession/attempt Cookieだけが残ればsigned-outになる。DBとブラウザCookie適用を一つのトランザクションにすることはできないため、このログイン喪失は安全性と区別した制約である。

直接の`env.DB`を使い、長く共有するD1 Sessions APIや古いbookmarkを認可に使わない。[D1複製の公式説明](https://developers.cloudflare.com/d1/best-practices/read-replication/)ではreplicaが遅延し得る。ローカル試験と公式のbatch契約は、remote primary/replicationの実測、運用設定や全世界の配送順の証明にはならない。手動BEGIN/COMMIT、複数HTTPリクエストに跨るロック、provider待機中のDB transactionは使っていない。

## Cookie遅着と利用者への影響

- A session発行を保留しBを完了した後にAヘッダーを適用すると、A tokenのepochが古いため401。**Aとして受理しないが、Bへ自動復元もしない。** 明示した新しい認証で回復する。
- Aをclaim済みにしてからB start/logoutを確定すると、provider後の最終INSERTが拒否する。既にsession INSERTを終えた応答も、後の世代変更で無効になる。
- 古いstartのattempt Cookieが遅着すれば新しいattemptを失い得る。しかし古いattemptは最新epochに一致せずproviderへ交換しない。新しいstartが必要。
- 遅延した未使用bootstrapはcontext不一致によるsigned-outになる。通常のstart/callback/logout/proof/private経路はcontext Cookieを再発行しない。既存contextのrefresh/rotation、キャッシュしたbootstrap応答の再適用はこの候補では許可しない。
- 別端末contextのstart/logoutは他のcontextの世代を変えない。account epoch更新は同一accountの既発行sessionを端末に関係なく無効にする。context単独のコピーや、別contextとsessionの組合せでは本人として受理しない。

## 重要な未完了・移植前の判断

1. **本体の全認可経路は未変更・未監査。** fixtureの二つの最終SQLでの検証であり、private repositoriesの重複live条件すべてを更新した証拠ではない。fixtureは単一expiryの簡略sessionで、既存のrevoked/idle/absolute/clock条件を移植していない。既存条件を省略したまま本体へ適用してはならない。
2. **account-wide失効の境界。** identity確定後のaccount snapshotと最終INSERT間のepoch/status変更は拒否する。一方、そのsnapshotより前のaccount epoch更新は新しい認証に引き継げる。本人未確定の全pending attemptまで失効する要件なら、別のauth-not-before等の方針・状態が必要。停止accountは最終SQLでも拒否する。この方針を実在籍・回復・運営判断の代わりにしない。
3. **固定化と窃取。** 匿名contextをsessionへ昇格せず、sessionは毎回新規。contextだけでは本人・session回復能力を取得できない。ただしcontext窃取者によるproof取得・世代変更DoS、完全なCookie窃取、XSS、ブラウザbackup復元は防いだとはいえない。実token entropy/形式/secret保管・CSRFのtiming/漏洩対策・レート制限は別レビュー。
4. **保持とcleanup。** 不明contextを同じID・epoch0で再生成しないこと、失効や削除を拒否することは確認するが、FKを含む本体の保持/消去とtombstone cleanup方針は未実装。nonceを消すと結果再確認もできないため、寿命・冪等期間を決める必要がある。
5. **時間・配送・UI。** 最終SQLに渡す時計はpause後に取り直し、期限到達の拒否を試す。実DB配送遅延や時計差の厳密な上限、SQL確定済みのwrite取消、古いprivate responseの配送・画面消去は保証しない。start失敗・Cookie遅着・不明commitからの警告と回復、実ブラウザ/端末、Google、ログ保護は未完了。

現段階の結論は**閉じたfixtureの条件下で、誤った本人の受理を拒否し、ログイン喪失と結果不明を区別できる候補**。重大な未確定条件を本体の小さな修正へ押し込めず、独立QAの結果と共に報告してから実装範囲を決める。認証公開ゲートは引き続きfalse。
