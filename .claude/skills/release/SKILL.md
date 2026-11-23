---
name: release
description: kobe-student-hub の本番リリースを1周回す。main の SHA を release へ昇格させ（full CI を見届ける）、本番 D1 migration と Worker deploy、smoke、失敗時の rollback までを agent が自分で判断して進める。「リリースして」「本番に出して」「deploy して」「release 列車」「本番を戻して」、ksh release automation で使う。
---

# release（本番へ出す）

本番に出す道は `npm run release` の1本。手順の正本は [docs/RELEASE.md](../../../docs/RELEASE.md)。この skill は、その手順を agent が1人で回し切るための判断表。

本番の運用（D1 migration・deploy・rollback・secret）は agent が自分で判断して進めてよい（2026-11-21 オーナー決定）。資格情報の発行も条件つきで agent が行う（2026-11-23、[LOOPS.md](../../../docs/loop/LOOPS.md#資格情報の発行)）。人に戻すのは、課金・契約だけ（実利用者に関わる運営も 2026-11-23 から agent が行う）。

## 便（いつ出すか）

- 定時便は毎日 **08:00（朝便）と 20:00（夜便）JST**。窓は発車から 2 時間。`ksh release` automation が起こす（2026-11-22 オーナー決定、docs/DECISIONS.md）。
- 窓の外で「リリースして」と頼まれたら、まず次の便に寄せる（`npm run release -- --plan` が次の便を出す）。寄せられない理由（本番が壊れている、P0 の修正、利用者に害が出ている）があるときだけ臨時便にし、`--hotfix "<理由>"` を付ける。理由は Issue 番号と症状を短く（例: `"#210 ログインできない"`）。理由の無い臨時便は `npm run release` が exit 5 で止める。
- 臨時便は open な `P0` があっても出せる（P0 を直す便のため）。main-health が赤なら臨時便でも止まる。

## 記録（毎便、自動）

`npm run release`（`--plan` 以外）は、成功・見送り・失敗のどれで終わっても Issue `release-log` に 1 件コメントする。いつ・便・版（tag/SHA）・含む commit と migration・CI・deploy・smoke・理由が入る。agent が手で書く必要はない。

- 自分の判断で見送る便は、黙って終えずに `npm run release -- --skip "<理由>"` で記録する。
- `記録を Issue に残せませんでした` と出たら、表示された `npm run release:log -- --retry <file>` を実行する。
- 集計・報告を頼まれたら `npm run release:report -- --days 7`（`--since YYYY-MM-DD`、`--json`）。「記録なし」の便は、Orca が起こせなかった（Mac が眠っていた等）便。

## 1周の手順

1. 準備: `git fetch -q && npm ci`。`npm run release -- --plan` で昇格候補（release..main の commit）と今の便を見る。
2. 機械で判定できる止める条件（変更なし・open な `P0`・main-health 赤・別の rc の CI 実行中）は `npm run release` が見て、見送りとして記録する。agent が見るのは次の2つ。当たったら `npm run release -- --skip "<理由>"` で終える。止める commit より前の SHA だけを出せるなら `--sha <その SHA>` で一部を出してよい
   - 候補に R2（認証・権限・非公開データ・通報・ログ・migration）の commit があり、その独立検証が Issue 上でまだ済んでいない
   - 候補の migration が expand → contract になっていない（下の「migration の確認」）
3. 実行: `npm run release -- --deploy`（臨時便なら `--hotfix "<理由>"` を足す）
   - full CI（`verify`）を `rc/<sha7>` で走らせて待つ。待っている間は `gh run watch` と同じ情報が `[release] CI verify: ...` で出る
   - green なら release へ fast-forward → `release.yml` がタグと GitHub Release を作る
   - deploy の担い手は自動で決まる。environment `production` に `CLOUDFLARE_API_TOKEN` があれば GitHub Actions（`release.yml` の deploy job）を見届け、無ければ手元で `scripts/deploy-production.mjs` を実行する
4. 結果を残す: 便の記録は自動で Issue `release-log` に入る。本番が変わったときだけ `docs/WORK.md` の本番行（最新 tag と SHA）を更新して main へ push（見送り・失敗では WORK.md を触らない。記録だけの commit で main を進めないため）。Orca の run なら `orca worktree set --worktree active --comment` に1行（記録コメントの URL を添える）。

## 結果ごとの対応

| 出たもの | 意味 | やること |
| --- | --- | --- |
| exit 5 `定時便の窓の外です` | 08:00/20:00 の窓の外で `--hotfix` が無い | 次の便に寄せる。緊急なら理由を書いて `--hotfix` |
| `見送り:`（exit 0、記録は skipped） | 変更なし・P0・main-health 赤・rc 実行中 | そのまま終える。main-health 赤は mend、P0 は finish が受け持つ |
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
5. `npm run release -- --sha <release の SHA> --deploy --skip-migrations` で Worker だけ deploy する（便の窓を過ぎていたら `--hotfix "<元の便> の続き（exit 4）"` を足す）。

## D1 を戻す判断

- 既定は**戻さない**。Time Travel の restore はブックマーク以降の利用者の書き込みも消す。expand の migration は残っていても1つ前の Worker が動く。
- 戻すのは、migration がデータを壊した（読み戻しで欠落・不整合が見つかった）ときだけ。restore した時刻・ブックマーク・失われる範囲を Issue に残す。

## やらないこと

- release への直接 push・force push・main/release の削除（hook が止める）
- 契約・課金の変更（オーナーの作業。必要なら `needs-human` Issue に積んで他を進める）
- 決まりを外れた API token の発行（スコープを絞らない・期限なし・値が出力に出る手段。発行してよい形は [LOOPS.md](../../../docs/loop/LOOPS.md#資格情報の発行)）
- 本番での書き込み操作による確認（smoke は匿名の読み取りと書き込み拒否だけを見る）
- 実 ID・メールアドレス・token を公開リポジトリ・Issue・commit に書く
