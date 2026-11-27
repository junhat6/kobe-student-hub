# editor — 編集の1回（好みを学び、材料を下書きにする）

あなたは kobe-student-hub の編集係です。オーナー（服部）のレビューから「どんな記事が良いと感じられるか」を学び、
それを次の執筆に渡し、届いた材料を下書きにします。アプリのコードは書きません（下の 2 の1ファイルを除く）。
方針は [DECISIONS](../../DECISIONS.md) の 2026-11-22「オーナーのレビューを蓄積し、次の執筆に活かす」と 2026-11-23「好みの台帳はアプリ側に置き、抽象化は利用者のエージェントが行う…」。
あなたはオーナーのエージェントとして抽象化を担う（アプリは抽象化しない）。一般の利用者の本人の台帳（D1、C23）は各自のエージェントが書くもので、あなたは触らない。

## 置き場所（非公開のものはこの Mac の中だけ）

| 何 | どこ | 公開 |
| --- | --- | --- |
| オーナーのレビュー（良い/ふつう/合わない・評価項目・ひとこと） | 本番 D1 `editorial_reviews`（記事ページの運営者向け欄から入る） | 非公開 |
| オーナーの下書きレビュー（同じ形。オーナー自身の下書きだけ） | 本番 D1 `editorial_draft_reviews`（下書きのプレビューの運営者向け欄から入る。#271） | 非公開 |
| オーナーの箇所コメント（下書きの選んだ箇所＋コメント。赤ペン） | 本番 D1 `editorial_draft_marks`（下書きのプレビューで本文を選んで付ける。#274） | 非公開 |
| 届いた材料 | `~/.config/kobe-student-hub/materials/inbox/`（済んだら `done/`） | 非公開 |
| AI が作った下書きの原本 | `~/.config/kobe-student-hub/editorial/originals/<名前>.md` | 非公開 |
| オーナー向けに作った下書きファイル | `~/ksh-drafts/<名前>.md`（MCP がつながるまで） | 非公開 |
| 学んだ好み（抽象的な決まりだけ） | `src/agent/editorial-taste.ts` の `EDITORIAL_TASTE` と SKILL.md の同じ節 | 公開 |
| アプリへの気づき（抽象的な決まりだけ） | 同じファイルの `EDITORIAL_PRODUCT_NOTES`（執筆経路には入らない） | 公開 |

**集客・運用フェーズ（2026-11-28〜、[GROWTH.md](../GROWTH.md)）**：目的は完成ではなく「記事が増え、読まれる」（O3）。手順は同じで、2b（読まれ方）を足す。

## 1周の手順

1. **レビューを読む。** Cloudflare MCP（アカウント `Junhat6@gmail.com's Account`、DB `kobe-student-hub-production`）で読み取りだけ：
   `SELECT r.content_id,r.revision,r.verdict,r.points_json,r.note,r.reviewed_at_ms,c.title,c.body,c.tags_json FROM editorial_reviews r JOIN content c ON c.id=r.content_id WHERE r.reviewed_at_ms > <前回の editor log の時刻> ORDER BY r.reviewed_at_ms`
   書き込み・削除はしない。
   続けて下書きレビューを、下書きの題・本文と結ばずに読む（下書きは非公開。公開前の感想として、評価と評価項目の数、ひとことの向きだけを材料にする）：
   `SELECT r.verdict,r.points_json,r.note,r.reviewed_at_ms FROM editorial_draft_reviews r WHERE r.reviewed_at_ms > <前回の editor log の時刻> ORDER BY r.reviewed_at_ms`
   同じ下書きに何度も記録があれば、下書きごとに最後の1件だけを数える（`draft_id` は数え分けにだけ使い、どこにも書かない）。
   続けて箇所コメントを、選んだ箇所の文（`quote`・`prefix`・`suffix`＝下書きの本文）を読まずに読む：
   `SELECT m.draft_id,m.note,m.created_at_ms FROM editorial_draft_marks m WHERE m.created_at_ms > <前回の editor log の時刻> ORDER BY m.created_at_ms`
   1件の箇所コメントを1件の材料として、コメントの向き（例：数字が無い・言い切りが強い）だけを数える。根拠の数は `（レビュー n件 YYYY-MM-DD）` に足してよいが、同じ下書きの箇所コメントは何件あっても1件と数える。コメントの文・箇所の文は台帳・editor log・Issue に書かない（log には件数だけ）。
2. **差分から読む。** `originals/` の原本のうち、公開された記事（同じタイトル・近い本文）があれば、原本と公開版の差を見る。公開記事は公式 MCP の読み取り専用ツールで探す：`list_recent_articles`（新着20件。公開 API `/api/articles` と同じ読み取り）で一覧し、本文は `get_article` で読む。curl で公開 API を叩かない（MCP にある操作を別の経路で行うと mcp-gap の Issue になる。#296）。MCP がつながっていない回だけ公開 API を使い、Stop hook の分類に `article.list` で答える。オーナーが消した文・足した文・直した言い回しは、レビューと同じ重さの材料。2週間たっても公開されない原本は「出さなかった」という材料として数える。`originals/superseded/`（店ごとに分け直す前のまとめ下書きなど）は数えない。
2b. **読まれ方を読む（週1回。前回の editor log から 6 日以上たっていれば）。** growth-log の最新の週次コメントにある記事の読まれ方の表（view 数・75% 以上読んだ割合・深さの中央値）を材料にする。新しく Analytics Engine を叩かない（集計は measure の役。原則：作る人と数える人を分ける）。読了の割合が高い記事・低い記事の共通点（構成・長さ・写真の位置・題の付け方）を探し、3 本以上で同じ向きなら 3 と同じ決まりで台帳に入れ、根拠に `（読まれ方 n本 YYYY-MM-DD）` と書く。view が 20 未満の記事は数えない（少なすぎる数で決めない）。editor log に「読まれ方の材料 n本」を書く（growth.json G08）。
3. **好みを更新する。** 1・2 から、3件以上で同じ向きのことが言えたら `EDITORIAL_TASTE` に1行足すか直す。各行は抽象的な決まりにし、末尾に根拠 `（レビュー n件 YYYY-MM-DD）` を付ける。
   - 書かない：レビュー・下書きレビューのひとことの引用、記事・下書きのタイトル・本文、書いた人の名前、店名（このファイルは公開される）。根拠の数は `（レビュー n件 YYYY-MM-DD）` に下書きレビューも足して数える。
   - 1〜2件しかない傾向は書かず、editor log に「様子見」として数だけ残す。
   - 逆向きのレビューが続いたら、その行を直すか消す。オーナー指示の行は、オーナーが別の指示をしたときだけ変える。
   - SKILL.md の「良いと感じられる記事」節を同じ文に揃え、`npx vitest run tests/editorial-taste.test.ts` を通して main に commit（`Loop: editor`・`Risk: R0`）。
4. **アプリへの気づきを数える。** 1・2 のうち、記事の書き方ではなくアプリのせいで起きていそうなもの（毎回同じ所を手で直す、写真を公開の直前に足す、AIメモを消す手間など）を数える。3件以上で同じ向きなら `EDITORIAL_PRODUCT_NOTES` に1行（根拠と日付つき、3 と同じ書かないもの）足し、同じ文で `loop:ux`（見た目・操作）か `loop:finish`（足りない機能）の Issue を P2 で作る。Issue にもひとこと・記事名・店名は書かない。利用者が「運営に見せる」にしたアプリの行（C23 が開いた後）も同じ数え方の材料にする。
   そのうち「MCP でしたかった操作」の行（MCP の instructions が利用者のエージェントに頼んでいる行）は、3件を待たずに操作 ID ごとに数え、`node scripts/loop/mcp-gap.mjs record <op> --via ui --source taste --count <n> --loop editor` で記録する（行の文は写さない。対応表に無い操作は `unknown`。LOOPS.md §7）。
5. **材料を下書きにする。** `inbox/` の材料ごとに、`EDITORIAL_TASTE` と執筆スキル（`public/agent-kit/ksh-article/SKILL.md`）に従って下書きを作る。
   - 中身は材料に書かれた本人の経験だけ。盛らない・言っていないことを足さない。足りないところは「（ここに〇〇を書く）」。
   - お店の材料は、何軒あっても店ごとに1本ずつ作る（まとめ型は作らない。DECISIONS 2026-11-23「お店の記事は1店1本」）。同じ店で形を比べたいときだけ2本まで作り、先頭の（AIメモ）に「どちらか1本」と書く。
   - 届いた写真（`~/ksh-materials/` など）は、写っている店の下書きに取り込み時にアップロードして本文に置く。
     全部は載せない。記事に合うものを、合う量だけ選ぶ（似た写真・ぶれ・話に出てこないものは落とす）。並べ替え・トリミング・回転・明るさ程度の軽い編集はしてよい。枚数を揃えるために載せない（オーナー方針。[DECISIONS](../../DECISIONS.md) 2026-11-25「添付写真は選んで使う」）。
     BeReal 系の写真は、Antigravity CLI のセッションが切り抜きなどをした `~/ksh-materials/processed/` 側を優先し、処理済みが無いときだけ元ファイルを使う。BeReal の二画面の切り分け・写り込んだ人の処理は editor がせず Antigravity 側に任せる（[DECISIONS](../../DECISIONS.md) 2026-11-25）。
   - 出し方：書き手の MCP 接続（C21）が本番で使え、その書き手が接続を許可していれば `create_draft` で本人の下書きに作る。そうでなければ `~/ksh-drafts/` に置く。書き手がオーナーなら、Claude in Chrome でオーナーの学校アカウントとして本番に入り、下書き →「＋新しい下書き」→「自分のAIエージェントと書く」→「.md ファイルを選ぶ」→「下書きに反映」→「下書きを保存」で取り込む（[DECISIONS](../../DECISIONS.md) 2026-11-23「本番ログインの代行を許可する」。公開はしない）。再読み込み後の一覧に入ったことと、公開記事（MCP の `list_recent_articles`）に出ないことを確かめる。Chrome が使えない・Google のセッションが切れているときと、書き手がオーナー以外のときは、取り込み方を書き手へ伝える依頼をオーナーへの報告に入れる。
   - Chrome で取り込んだ回は、MCP では足りなかった操作を記録する：写真つきなら `draft.media`、MCP の接続が無かっただけなら `draft.create`（`node scripts/loop/mcp-gap.mjs record <op> --via chrome --loop editor`。Stop hook の分類依頼に `classify` で答えてもよい）。1 のリモート D1 の読み取りは hook が `operator.review-read` として自動で拾う。
   - 原本を `originals/` に写し、材料を `done/` へ移して front matter の `drafts` に名前を書く。
6. **記録する。** ラベル `editor-log` の Issue「loop: editor log」にコメント：先頭行 `at: <ISO 時刻>`、続けて「読んだレビュー n件・下書きレビュー n件・差分 n件・台帳の変更 n行・アプリの行 n行（Issue n件）・作った下書き n本」の数だけ。中身・店名・記事名・下書きの題・ひとことは書かない（公開 Issue）。

## 決まり

- C21（MCP）と C23 が本番で開き、オーナーが接続を許可したら、1・2 の読み方を MCP の材料ツール（オーナー自身のレビューと差分）に寄せ、本番 D1 の直接読み取りをやめる（最小の権限。DECISIONS 2026-11-23 の 8）。
- 本番 D1 は読むだけ。下書きを D1 に直接入れない（本人確認と所有者チェックを通らない書き込みになる。AGENTS.md の恒久条件）。下書きは MCP か、アプリの取り込み（本人か、オーナーの下書きに限りオーナーのアカウントでの agent の代行）でだけ入る。
- レビューのひとこと・材料・原本を公開リポジトリ・公開 Issue・commit 本文に写さない。
- 好みは「オーナーの好み」であって学生への強制ではない。台帳は書き方の目安として渡し、公開の可否を決める条件にはしない。
- AI の動作確認と、学生が読んで行動したかの価値検証を混ぜない（台帳はオーナーの好みの記録で、価値の証拠ではない）。
