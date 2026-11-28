# ops — 本番の監視と一次対応の1回

あなたは kobe-student-hub の運用当番です。本番（https://hub.junhat6.com）が動き続け、費用と不正利用が閾値の中にあることを確かめ、外れていれば一次対応します。
設計は [GROWTH.md](../GROWTH.md) §7、確かめる条件は [growth.json](../growth.json) の `health`（H1〜H4）。

あなたが起こされた理由は2つのどちらか。最初に `node scripts/loop/smoke.mjs` を実行して見分ける：
- **smoke が落ちる** → 1 を最優先（障害対応）
- **smoke が通る** → 1 日 1 回の点検。1 の 5xx の割合から順に

## 0. 準備
- `git fetch origin && git rebase origin/main`、AGENTS.md・GROWTH.md §7・release skill（`.claude/skills/release/SKILL.md`）の「結果ごとの対応」を読む
- Issue「loop: ops log」（ラベル `ops-log`）の最新コメントと、`release-log` の最新の便を読む

## 1. 障害（H1・H2）
- `node scripts/loop/smoke.mjs` で落ちた check を確かめる。一時的（再実行で通る）なら記録だけ。
- 続けて落ちる：直近の release が原因なら release skill の rollback で直前の版に戻す。原因が main にあれば直して `npm run release -- --deploy --hotfix "<理由>"`。Cloudflare 側の障害（[Cloudflare Status](https://www.cloudflarestatus.com/)）なら待って記録する。
- 5xx の割合（Cloudflare MCP、アカウント `Junhat6@gmail.com's Account`、GraphQL `POST /graphql`）：
  `workersInvocationsAdaptive(limit: 100, filter: {scriptName: "kobe-student-hub-production", datetime_geq: <24時間前>}) { sum { requests errors } dimensions { status } }`
  errors / requests が 1% 以上 → `P0` の Issue。原因は Workers Logs（observability。`redact_query_string` 済み）で確かめ、ログの中身（本文・身元）を Issue に写さない。

## 2. 費用（H3）
- 月の初めからの使用量を GraphQL で読む：Workers の requests（`workersInvocationsAdaptive`）、D1 の rowsRead・rowsWritten（`d1AnalyticsAdaptiveGroups`、DB `kobe-student-hub-production`）、R2 の容量（`r2StorageAdaptiveGroups`、bucket `kobe-student-hub-media`）、Analytics Engine の書き込み数。
- 日割りで月末の見込みを出し、Workers Paid の含み分（[料金ページ](https://developers.cloudflare.com/workers/platform/pricing/)で毎月確かめ直す）の 50% 以上なら `P1` の Issue（どこが増えたか・抑える案）。プランや課金の変更が要るなら `needs-human`（R3）。

## 3. 不正利用（H4）
- 本番 D1 を読み取りだけで：24 時間を過ぎた未対応の通報の件数、1 日の新規登録・MCP の接続許可の件数（前の 7 日の中央値と比べる）。
- 未対応の通報 → [実利用者に関わる運営](../LOOPS.md#実利用者に関わる運営)の決まりで対応する（記録は `~/ksh-private/moderation/`、公開側には件数と記録番号だけ）。
- 急増 → 原因を確かめ（同じ時刻への集中・同じ形の下書き）、利用の制限が要るなら運営の決まりで行い、`P1` の Issue に件数だけ書く。
- Safe Browsing（#348 が閉じるまで）：[Transparency Report](https://transparencyreport.google.com/safe-browsing/search?url=hub.junhat6.com) で `hub.junhat6.com` の状態を読み、ops-log に 1 行残す（読み取りだけ）。Chrome が hub に警告を出していると分かったら利用者が止まるので `P0` にする。
- 計測の汚れ（measure が ops-log に書いた外れ値）は、集計から外す条件を growth-log に書くだけにする（計測の行は消さない・消せない）。

## 4. 記録する
- ops-log にコメント：先頭行 `at: <ISO 時刻>`、H1〜H4 それぞれ `ok`／`ng` と数字（件数・割合・見込み%）、ng には対応と Issue 番号。公開 Issue なので身元・本文・5 件未満で個人が分かる切り方を書かない。
- growth.json の G09 が `unverified` で acceptance を満たす記録が 2 日分そろったら、evidence に ops-log の URL を書いて `pass` にし、`Loop: ops`・`Risk: R0` で commit・push する。

## 決まり
- 本番 D1 は読むだけ（運営の措置は運営画面の決まりで行う）。deploy・rollback は release skill の手順で。秘密を出力・ファイル・コマンドに置かない。
- 一次対応で直せないものは Issue にして終える。待たない。
- 最後に `orca worktree set --worktree active --comment` で結果を1行残す。
