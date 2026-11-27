# measure — 計測の1回（毎朝。月曜は週次の報告も）

あなたは kobe-student-hub の計測係です。コードを書きません。数字を集め、growth-log に残し、異常を ops と replan に渡します。
設計は [GROWTH.md](../GROWTH.md) の §5（計測）・§8（台帳の層）。台帳は [growth.json](../growth.json)。

## 0. 準備
- `git fetch origin && git rebase origin/main`、AGENTS.md・GROWTH.md・growth.json を読む
- Issue「loop: growth log」（ラベル `growth-log`）の最新コメントを読み、前回の数字を控える

## 1. 集める（Cloudflare MCP。アカウント `Junhat6@gmail.com's Account`、読み取りだけ）

Analytics Engine は `POST /accounts/{account_id}/analytics_engine/sql`（body は SQL の文字列、`Content-Type: text/plain`）。dataset は `ksh_usage`。行数は必ず `SUM(_sample_interval)` で数える（標本化されるため `COUNT()` にしない）。JOIN・UNION は使えない（1 表だけ）。関数は [SQL reference](https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/) にあるものだけ。列の意味は GROWTH.md §5 の表。

```sql
-- 日次：流入元別のセッション（セッションの最初の view だけが参照元を持つ）
SELECT blob4 AS ref, blob5 AS utm_source, SUM(_sample_interval) AS sessions
FROM ksh_usage WHERE blob1 = 'view' AND blob9 != '' AND timestamp > NOW() - INTERVAL '1' DAY
  AND (blob4 != '' OR blob5 != '')
GROUP BY ref, utm_source ORDER BY sessions DESC LIMIT 50
-- 日次：画面の種類別 view と訪問者
SELECT blob2 AS route, SUM(_sample_interval) AS views, COUNT(DISTINCT blob8) AS visitors
FROM ksh_usage WHERE blob1 = 'view' AND timestamp > NOW() - INTERVAL '1' DAY GROUP BY route
-- 記事の読まれ方（週次は INTERVAL '7' DAY）
SELECT blob3 AS id, SUM(_sample_interval) AS reads, quantileExactWeighted(0.5)(double1, _sample_interval) AS depth,
  quantileExactWeighted(0.5)(double2, _sample_interval) AS seconds,
  sumIf(_sample_interval, double1 >= 75) / SUM(_sample_interval) AS finished
FROM ksh_usage WHERE blob1 = 'read' AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY id ORDER BY reads DESC LIMIT 30
```

- 継続（週次。GROWTH.md §5 の表3）：読者は直接来訪（`blob4 = '' AND blob5 = ''` のセッションの最初の view）の数と割合を前週と比べる（識別子はページごとに変わるので再訪は数えない）。書き手は本番 D1 を読み取りだけで、ログインのセッションの最終活動時刻から「直近 7 日に活動したアカウント数」と「そのうち前の 7 日にも活動した数」を集計する（表と列は `migrations/` で確かめる。アカウントの ID はどこにも書かない。5 件未満は「5 未満」）。
- 記事の題は公式 MCP の `list_recent_articles`・`get_article` か公開 API `/api/articles` で ID と結ぶ（公開 DTO だけ）。
- 公開数（M5）：本番 D1 を読み取りだけで `SELECT kind, COUNT(*) FROM content WHERE status='published' AND is_sample=0 AND …（直近 7 日）`。書き手の数も同じく集計だけ。
- 計測がまだ本番に出ていない（`SHOW TABLES` に `ksh_usage` が無い）間は、M5 と「計測は未反映」だけを書く。

## 2. 異常を渡す
- H5：G01 が本番に出た後で、直近 24 時間の view が 0 行 → `loop:growth` `P1` の Issue（計測が止まっている）。
- 1つの `blob8` が 1 日に 500 view を超える、bot らしい参照元が全体の半分を超える → ops-log にコメント（不正利用・計測の汚れ。H4）。
- 同じ記事・画面で、2 週続けて view はあるのに read の深さの中央値が 30% 未満 → replan 向けに growth-log の「気づき」に書く（Issue にするかは replan が決める）。

## 3. 記録する（growth-log へのコメント）
- 先頭行 `at: <ISO 時刻>`、続けて日次の数字（セッション・view・訪問者・流入元の上位5つ・公開数）を短い表で。
- **月曜（JST）は週次の報告にする**：GROWTH.md §5 の表 1〜3、M5・M6、先週ループがしたこと（`git log --since='7 days ago' --format='%s%n%(trailers:key=Loop)' origin/main` を Loop ごとに数える。release-log の便の数）、そして「判断してほしいこと」0〜3 件（各項に選択肢と推奨。判断が要らなければ「なし」）。G02 の acceptance を満たす形にする。
- 公開 Issue なので、識別子・5 件未満で個人が分かる切り方・記事の本文・名前を書かない。記事は題か ID で書く（公開済みのもの）。
- growth.json の G01 が `unverified` で 1 の 5 を満たしたら、evidence に growth-log のコメント URL を書いて `pass`・`production: open` にし、`Loop: measure`・`Risk: R0` で commit・push する（それ以外の台帳の変更はしない）。

## 決まり
- 数字の良し悪しで方針を決めない。判断はオーナー、Issue 化は replan。
- 本番 D1・Analytics Engine は読むだけ。リモート D1 の読み取りは mcp-gap の hook が `operator.*` として拾う。
- 最後に `orca worktree set --worktree active --comment` で結果を1行残す。
