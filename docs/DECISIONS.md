# Decisions and hypotheses

Recorded 2026-11-03. These records supplement the PRD. From 2026-11-21 agents may also change PRD policy here; a dated entry below takes precedence over the PRD original (which stays unedited).

## 2026-11-22 — 運営者を「Kobe Student Hub 運営委員会」と表記し、免責事項を置く（オーナーの考えを受けた方針）

オーナー（服部）の考え：運営元は実在の個人名・学校名義ではなく「運営委員会」という組織名で示したい。情報の正確性や利用結果について運営が過大な責任を負わないよう、広めにカバーする免責・注意書きを置きたい。これを受けて次のように決める。

1. 運営者の表記は「Kobe Student Hub 運営委員会」。全ページのフッターと `/guide#operator` に出す。実在の個人名・住所・学校名義は出さない（恒久条件の「学校公式ではない」と、個人情報を出さない方針に合わせる）。連絡は既存の問い合わせ窓口（`/guide#contact`）に一本化する。
2. 免責事項は `/guide#disclaimer` に置き、フッターと「このサイトについて」からリンクする。範囲は、投稿内容の正確性・有用性の非保証、参考にした結果は利用者の判断と責任、学校・運営の見解ではないこと、外部リンク・埋め込み、サービスの変更・停止・データの非保証、利用者間のトラブル、損害の免責、改定の扱い。
3. 損害の免責は「法令上責任を負う場合を除き」と限定する。消費者契約法などで全部免責の条項は無効になりうるため、無条件の全面免責より、効力を保てる書き方を選ぶ。法的助言を受けた文面ではなく、一般的な公開サイトの慣行の範囲にとどめる。
4. 検索エンジンへの掲載は引き続きしない（noindex のまま）。`robots.txt` は `/api/` だけを止め、ページのクロールは止めない（止めると noindex が読まれず URL だけ残ることがあるため）。

## 2026-11-22 — 記事は画像を多く入れて出す（オーナーの考えを受けた方針）

オーナー（服部）の考え：記事には画像をたくさん入れて出してほしい。記事の見た目と読み応えのために、画像の量を重視する。これを受けて次のように決める。

1. 記事の画像は「多いほうがよい」を基本にする。書き方の案内と、利用者の AI エージェントに渡す執筆の依頼文に「見出しごとに1枚以上」を目安として入れる。
2. 1下書き8枚・全体64 MiB の上限は、この方針に足りない。上限を上げる（#195、R2 の migration と独立検証を経る）。上がるまでは、8枚の中で写真と図版を組み合わせる。
3. 画像の出どころは2つに限る。(a) 書く本人が撮った写真・作ったもの。(b) 中身を図にした自作の図版（比べ方・選び方・手順など）。店の公式写真、グルメサイト・地図サービスの写真、検索で見つけた画像は使わない。他人の著作物であり、このサイトは公開されているため。
4. AI 生成の写真風の画像で、実在の店・料理を「その店のもの」に見せない。読者が実物と取り違えるため。図版・イラストだと分かるものは使ってよい。図版には「図：記事用に作成」のように出どころを添える。
5. 写真には、店員・ほかの客が特定できる形で写り込まないようにする。撮影禁止の店では撮らない（レビューの決まり4と同じ）。
6. 仮説 H03：画像の多い記事は、少ない記事より最後まで読まれ、次の行動（店に行く・作品を見る）につながる。未検証。最初の確かめ方は、試用（#5）で、同じ内容の画像あり・なしの記事を見せて比べること。

## 2026-11-22 — 食事レビュー記事と「北野川線沿い」を積み上げエリアにする（オーナーの考えを受けた方針）

オーナー（服部）の考え：三宮の北を南北に走る神戸市道北野川線（加納町・生田エリア）沿いには店が多く、その沿線の店のレビューをどんどん出していきたい。これを受けて次のように決める。

1. 学校の近くで食べた店のレビューは、PRD の「経験」の記事として受け入れる。学生がふだんの昼・放課後に行ける店を知り、次に行く店を決める材料になる、という点で目的（次の行動の材料）に合う。グルメサイトや店の宣伝の場にはしない。
2. 仕組みは新しく作らず、記事のタグで表す。種類のタグ `ごはん`、エリアのタグ `北野川線沿い` をつける（検索の `?tag=` と、関連記事の「同じタグ」がそのまま効く）。店名・場所・評価を DB の列にする（構造化）のは、レビューが積み上がって必要が見えてから。採らない場合の影響：先に列や地図を作ると R2 の migration と外部地図の privacy 設計が要り、レビューが1件もないうちに仕組みだけが増える。
3. エリアの入口（トップや検索からの「北野川線沿いのごはん」）は、公開済みのレビューが3件以上になってから出す。0件の入口は空の約束になるため。
4. レビューの決まり（書き方の案内に入れる）：自分が実際に行った店だけを書く。行った時期を書き、値段・メニューは「その時点」と明記する。店からの無料提供・割引・依頼があれば本文に書く（ステルスマーケティングにしない）。店員や他の客を写真・文章で特定しない。悪い体験は事実として書き、店や人への中傷にしない。
5. agent はレビュー本文・サンプルのレビュー・店の候補一覧をリポジトリや本番に作らない。公開情報から拾った店の候補は「行った店」ではないため（このリポジトリは公開）。レビューの中身は書く本人の経験だけ。
6. 仮説 H02：同じ通り沿いの記事が積み上がると、学生が「次にどこへ行くか」を決める材料として、ばらばらの記事より使われる。未検証。最初の確かめ方は、レビューを読んだ学生が実際にその店へ行ったかを試用（#5）で聞くこと。

## 2026-11-21 — 本番運用と PRD 方針を agent に任せる（オーナー決定）

オーナー（服部）が次を決めた。「AI エージェントが大胆に自律的に進める」方針に合わせるため。

1. 本番 D1 の migration を含む本番運用（deploy・rollback・secret）は agent が判断して進める。agent hook でリモート D1 と Cloudflare への反映を拒否する仕組みは撤去した。安全は hook ではなく、release の手順（full CI 必須・expand のみの migration・適用前の Time Travel ブックマーク・smoke と自動 rollback）で担う。
2. 本番 deploy は GitHub Actions（`release.yml`）へ移す。CI 用 Cloudflare token の発行と Workers Paid への加入はオーナー本人の作業。agent は environment `production` と設定の secrets を先に用意し、token が入れば自動で Actions の deploy に切り替わる。release は skill（`.claude/skills/release/SKILL.md`）で agent が担う。
3. PRD 方針は agent が判断して更新してよい。変えた方針はこのファイルに日付と理由つきで記録する。AGENTS.md の恒久条件（本人確認・非公開データ・安全な Markdown など）は PRD 方針ではないので、この権限では緩めない。
4. 人の判断に残すのは、課金・契約、資格情報の発行、実利用者への告知・募集・試用だけ。

採らない場合の影響：本番 migration と PRD 方針を人の承認待ちにしたままだと、main で完成した機能が本番に出るまで人の在席に依存し、ループの速度が人の応答で決まる（#166 で migration 0024〜0026 が止まっていた）。

## 2026-11-08 — 通常の参加条件を自己申告年度へ更新

[採用判断](adr/0001-self-declared-enrollment.md)と[用語](../CONTEXT.md)を追加した。通常の参加はサーバーでの学校Google本人確認と、必須の入学年度・卒業予定年度の本人申告で判定し、手動の在籍審査や証明書提出を必須にしない。登録負担を抑える方針であり、離脱率への効果は未測定。学校による在籍認定を示す表示は使わない。公開学年表示は資格に使わず、私的な申告年度を公開プロフィールへ自動投影しない。

有効アカウントは本人管理の権限、学生参加資格は期間内の新規投稿・参加の権限として区別する。年度訂正に人手承認を挟まず、停止・削除済みのアカウントは年度変更で復帰しない。以前のpending→運営審査という準備は、通常入会の必須工程から外す。実運営権限・通知・問い合わせと実ログ等の公開条件は引き続き別に満たす。

## Source and priority

PRD: user-provided Google Doc. Latest tab: 設計判断・MVP方針｜Q01〜Q40; also read the original draft and 実現したいユーザー体験. The private source document is not republished here. Original v0.1 is a draft; later tab broadens the emphasis to articles × student activities. Adopted experiences are not promises to implement every feature at first release.

Confirmed direction: public reading; school Google verified current-student writing; articles/projects/profiles/search/likes with simple recommendations; independent projects may link to articles. Markdown editing and saved drafts across devices are important. Images and YouTube before direct video upload. Three distinct reporters trigger temporary hiding, not deletion; operator email and protected moderation are required for real publishing. No follow notifications. Avoid unnecessary personal data, protect drafts/history and private media.

## Cycle 01 — narrow discovery hypothesis

Hypothesis H01: seeing an article's topic, intended reader, prerequisites and author/project context helps a student choose something relevant and identify a possible next action. This has not been validated with students.

Scope: sample-only browse/search/detail/profile/related navigation. Real authentication and UGC are excluded from this cycle because identity, moderation, private data and operational conditions must be provided together, not simulated by weak client checks. This is a development artifact, not the agreed full product.

Acceptance: mobile/PC discover → read → author/project; keyword/tag/type and empty states; API outage recovery; explicit sample notice; no private data or writes. AI tests establish operation only. Next student trial must ask whether an experience informed an actual action, not merely whether cards were clicked.

## Architecture

Use TypeScript end to end: React/Vite frontend + Hono Worker + Static Assets + D1. A single Worker origin avoids unnecessary services and cross-origin auth. Tailwind v4 and Base UI follow the PRD. react-markdown/remark-gfm/rehype-highlight avoid custom Markdown parsing, and raw HTML is disabled. No image/iframe renderer in this cycle. Mermaid/YouTube are deferred until their security and privacy conditions are designed.

D1 stores structured public sample content with explicit status. The SQL projection excludes every non-published state and non-sample row, including at final API delivery. No real private fields are added merely to scaffold unused features. Current search loads at most 100 sample entries and filters locally; this is intentionally unsuitable for a production-size catalog. Future indexed search/pagination is a separate task.

No AI inference, embeddings, R2, email or subscriptions are enabled. Related entries use explicit relationships then shared tags; this is not personalized recommendation or popularity ranking. Do not invent likes/counts/history.

Name `kobe-student-hub` is a reversible working name chosen after checking accessible owned repositories. No school logo or official affiliation is claimed. No open-source license for original code has been selected by the owner; public visibility alone is not a license grant. Reference notices are preserved in DESIGN.md.

## Infrastructure constraints

A dedicated sample-only preview was subsequently authorized, provisioned and deployed; see DEPLOYMENT.md and archive/QA-DEPLOYMENT.md for the intended public URL and verified scope. Do not bypass approval rejection. Account-specific operational and billing details remain outside this public repository.

The prepared automated deployment requires a specifically authorized D1 database and an appropriately scoped credential supplied securely through Actions secrets. Do not create persistent access or activate a paid service without the applicable confirmation. Do not reuse or modify unrelated resources.
