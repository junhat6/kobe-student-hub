---
name: release
description: kobe-student-hub の本番リリースを1周回す。main の SHA を release へ昇格させ（full CI を見届ける）、本番 D1 migration と Worker deploy、smoke、失敗時の rollback までを agent が自分で判断して進める。「リリースして」「本番に出して」「deploy して」「release 列車」「本番を戻して」、ksh release automation で使う。
---

# release（本番へ出す）

本番に出す道は `npm run release` の1本。手順の正本は [docs/RELEASE.md](../../../docs/RELEASE.md)。この skill は、その手順を agent が1人で回し切るための判断表。

本番の運用（D1 migration・deploy・rollback・secret）は agent が自分で判断して進めてよい（2026-11-21 オーナー決定）。人に戻すのは、課金・契約、新しい資格情報の発行、実利用者への連絡だけ。

## 1周の手順

1. 準備: `git fetch -q && npm ci`。`npm run release -- --plan` で昇格候補（release..main の commit）を見る。
2. 列車を止める条件を確かめる（どれかに当たれば昇格しない。理由を残して終える）
   - open な `P0` Issue がある
   - main-health の最新が赤（`gh run list --workflow main-health.yml -L 1`）
   - 候補に R2（認証・権限・非公開データ・通報・ログ・migration）の commit があり、その独立検証が Issue 上でまだ済んでいない
   - 候補の migration が expand → contract になっていない（下の「migration の確認」）
3. 実行: `npm run release -- --deploy`
   - full CI（`verify`）を `rc/<sha7>` で走らせて待つ。待っている間は `gh run watch` と同じ情報が `[release] CI verify: ...` で出る
   - green なら release へ fast-forward → `release.yml` がタグと GitHub Release を作る
   - deploy の担い手は自動で決まる。environment `production` に `CLOUDFLARE_API_TOKEN` があれば GitHub Actions（`release.yml` の deploy job）を見届け、無ければ手元で `scripts/deploy-production.mjs` を実行する
4. 結果を残す: `docs/WORK.md` の本番行（最新 tag と SHA）を更新して main へ push。Orca の run なら `orca worktree set --worktree active --comment` に1行。

## 結果ごとの対応

| 出たもの | 意味 | やること |
| --- | --- | --- |
| `CI が通りませんでした` | rc の full CI が赤 | `gh run view <id> --log-failed` で原因を特定し、最小の修正を main に push。昇格は次の列車 |
| `release への push が拒否されました` | ruleset か fast-forward の問題 | `git log origin/release..origin/main` と ruleset を確かめる。force push はしない |
| exit 3 | 本番設定の入力が無い | `~/.config/kobe-student-hub/production.json`（0600）か環境変数を用意する（docs/RELEASE.md「本番の設定」）。値は Cloudflare（`wrangler deployments list` / `versions view`）から読める |
| exit 4 | 手元の wrangler が本番 D1 に届かない | 手元の wrangler OAuth は D1 に使えない。下の「手元で D1 に届かないとき」 |
| exit 2 | smoke 失敗で Worker を rollback 済み | 原因を調べて main で直す。D1 を戻すかは下の「D1 を戻す判断」 |
| exit 1 で `wrangler rollback が失敗しました` | smoke 失敗後の rollback も失敗。本番は壊れた版のままかもしれない | `npx wrangler deployments list` で今の版を確かめ、`wrangler rollback <version-id>` で手で戻す。smoke で確認 |
| Actions の run が赤（release.mjs は exit 1） | CI 側の deploy が失敗 | `gh run view <id> --log-failed`。終了コードの意味は上と同じ（`scripts/deploy-production.mjs` の先頭） |

## migration の確認（昇格前）

- 新しい migration は、**今本番で動いている Worker（1つ前の版）がそのまま動く**形か。列や表の追加・trigger の追加は可。列の削除・改名・NOT NULL 化・既存データの書き換えは、使わなくなった版を出した後の別の列車（contract）に分ける。
- 理由: deploy は「migration → Worker 切り替え」の順で、Worker の rollback では schema は戻らない。expand だけなら、どこで失敗しても Worker の rollback だけで復旧できる。
- 適用前の Time Travel ブックマークは deploy スクリプトが必ずログ（Actions なら job summary）に残す。

## 手元で D1 に届かないとき（exit 4）

CI 用 token が入るまでの手順。

1. Cloudflare MCP（`mcp__claude_ai_cloudflare__execute`）で本番 D1（`kobe-student-hub-production`）の `d1_migrations` を読み、`migrations/` との差（未適用）を出す。
2. 未適用があれば、先に Time Travel のブックマークを取る（`GET /accounts/{account}/d1/database/{id}/time_travel/bookmark`）。結果を記録する。
3. 未適用の SQL を番号順に、1ファイルずつ `POST .../query` で適用し、同じ呼び出しで `INSERT INTO d1_migrations (name) VALUES ('<file>')` を記録する。1つでも失敗したら止め、読み戻して状態を確かめる。
4. readback: 期待する表・列・trigger があること（`sqlite_master`）、`PRAGMA foreign_key_check` が空、`d1_migrations` の件数。
5. `npm run release -- --sha <release の SHA> --deploy --skip-migrations` で Worker だけ deploy する。

## D1 を戻す判断

- 既定は**戻さない**。Time Travel の restore はブックマーク以降の利用者の書き込みも消す。expand の migration は残っていても1つ前の Worker が動く。
- 戻すのは、migration がデータを壊した（読み戻しで欠落・不整合が見つかった）ときだけ。restore した時刻・ブックマーク・失われる範囲を Issue に残す。

## やらないこと

- release への直接 push・force push・main/release の削除（hook が止める）
- 契約・課金の変更、API token の発行（オーナーの作業。必要なら `needs-human` Issue に積んで他を進める）
- 本番での書き込み操作による確認（smoke は匿名の読み取りと書き込み拒否だけを見る）
- 実 ID・メールアドレス・token を公開リポジトリ・Issue・commit に書く
