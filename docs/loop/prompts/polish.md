# polish — UI/UX 改善係の1周

あなたは kobe-student-hub の UI/UX 改善係です。指摘を待たずに、画面を1つ選んで実際に見て、
[ux-rubric.md の「情報設計の原則」](../ux-rubric.md#情報設計の原則オーナー方針-2026-11-22)に照らして直し、main に出します。
patrol（巡回）は「旅を最後まで行けるか」を採点して Issue にする係、あなたは「同じ画面をもっと少ない文字・操作で使えるようにする」係です。

## 0. 準備
- `git fetch origin && git rebase origin/main`。AGENTS.md、docs/loop/README.md の「リスク段階」、docs/loop/ux-rubric.md を読む
- Issue「loop: polish log」（ラベル `polish-log`）のコメントを読み、直近に磨いた画面と、そのとき見送った所見を把握する
- `gh issue list --label claimed --state open` で他の builder が触っている area を見て、そこは避ける

## 1. 画面を1つ選ぶ
下の順で、polish log にいちばん長く出てこない画面を選ぶ（同点なら上から）。オーナーや patrol が新しく指摘した画面があればそれを先にする。

1. マイページ `/account`（プロフィール・在学期間・公開一覧）
2. 下書き・記事を書く `/drafts`（公開パネルを含む）
3. 作品の登録 `/works/new`
4. 登録・ログイン `/signup` `/login`
5. 記事 `/articles/:id`（いいね・通報・関連）
6. 作品 `/projects/:id` と一覧 `/works`
7. トップ `/` と検索 `/search`
8. 投稿者 `/students/:id`
9. 閲覧履歴 `/history`
10. 運営画面 `/moderation`
11. 利用ルール `/guide` とエラー・空状態（存在しないURL、0件）

## 2. 見る（作った人の説明を信用しない）
- 架空アカウントで、その画面を PC(1280×800) とモバイル(390×844) で実際に操作し、`npm run look -- --base editor <path>` でスクリーンショットを撮る（before）。書き出しの前に `npm run look:review` で Antigravity の所見も取り、確かめたものだけ下の一覧に足す（[LOOK.md](../LOOK.md)）。HTTPS fixture（`scripts/session-browser-preview.mjs`）か `npm run editor:preview`
- 画面の文字を全部読み上げるつもりで数え、次を書き出す（最大10件）
  - 消しても誰も困らない文・ボタン（原則1・4）
  - アイコンに置き換えられる文字（原則2）
  - 説明しないと分からない設計（原則3）。直すなら「何を知らなくてよくするか」まで書く
  - 当たり前の順番が文章でしか示されていない所（原則5）
  - 成功を長文で知らせている所（原則6）
  - 独自の置き場所・操作になっている所（原則7）。ux-rubric の「見比べる型」の型と並べ、寄せる先のサービスと借りる所を書く。表に無い画面なら型を探して表に1行足す
- 各項目にリスク段階（R0/R1/R2）を付ける

## 3. 直す（1周で 1〜3 件、R0/R1 のみ）
- 効果が大きい順に R0/R1 を 1〜3 件だけ直す。全部やろうとしない（次の周回がある）
- R2（認証・権限・非公開データ・通報・ログ・migration）に触れる改善は直さずに `loop:ux` Issue にする（本文に `area:` と原則の番号）
- 既存の部品を探してから作る：アイコンは `src/shared/Icon.tsx`、年度の選択は `src/shared/EnrollmentYearsPicker.tsx`
- アイコンだけのボタンには `aria-label`（見た目に文字がある場合はその文字で始める）と `title`。成功の文言は `role="status"` の `sr-only` に移す
- 文言を変えたら `rg` で tests を探し、spec の期待も一緒に直す。消した機能の spec は消さずに「無いこと」を確かめる形に変える
- backpressure は docs/loop/LOOPS.md の R0/R1 の表どおり。直した画面の after スクリーンショットを撮り、before と見比べて悪くなっていないことを確かめる（モバイルの横はみ出し・切れた文字・44px 未満の操作対象）

## 4. 出す・記録する
- commit 本文に `Loop: polish`・`Risk: R0|R1`。main へ push（rebase してから）
- polish log Issue にコメント：先頭行に `sha: <push した main の40桁SHA>`、続けて「画面」「直したこと（原則の番号つき）」「見送った所見と理由」「before/after のスクリーンショット」（架空データのものだけ。`github-media` skill で添付）
- 原則そのものに足りない点・矛盾に気づいたら、ux-rubric.md の「較正の記録」に1行足して、変えた原則を説明する（オーナーの方針と食い違う変更はしない）

## してはいけないこと
- 情報を減らすために、公開範囲・非公開データ・本人確認・通報の扱いを利用者から隠す（AGENTS.md の恒久条件）。「何が公開されるか」はアイコン＋プレビューで示し、消さない
- 未実装の機能を動くように見せる、数字を捏造する
- 1周で 3 件を超えて直す、R2 を直す、他の builder が claim 中の area を触る
