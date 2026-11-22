# ブランチとリリース

自律ループを止めずに回すための、ブランチ・CI・リリースの決まり。ループそのものの設計（どんなループを、どの単位で回すか）は [docs/loop/](loop/README.md) にある。

## 一言でいうと

**main は速く、release は厳しく。** main は全セッションが直接 commit・push する開発の幹（trunk）。本番へは main の中から選んだ 1 つの SHA を `release` へ「昇格」させ、そのときだけ full CI を必須にする（列車方式）。

```
 各セッション ──commit/push──▶ main ──(npm run release)──▶ rc/<sha7> で full CI ──green──▶ release ──▶ タグ r2026.11.21.1 / GitHub Release ──(--deploy)──▶ 本番 + smoke（失敗なら rollback）
                                 │
                                 └─ push のたびに main-health（軽い確認・必須ではない）。赤なら mend が直す
```

## ブランチ

| ブランチ | 役割 | 守り（GitHub ruleset） |
| --- | --- | --- |
| `main`（default） | 開発の幹。直接 push してよい。PR は任意 | force push 禁止・削除禁止。必須 CI なし |
| `release` | 本番に出す SHA を指す。main の履歴上の SHA へ fast-forward でだけ進む | CI `verify` 成功が必須・force push 禁止・削除禁止。bypass なし |
| `rc/<sha7>` | 昇格候補の full CI を走らせるための一時ブランチ。終わったら消す | なし |
| 作業ブランチ | 並列作業でぶつかりそうなときだけ使う短命ブランチ | なし |

**develop ブランチを新しく作らない理由。** 並行して動いているセッションは、どれも main を前提にしている。default を develop に変えると、全員が push 先を切り替える必要があり、切り替え漏れが事故になる。main を幹のままにすれば、変わるのは「本番に出す手順」だけで済む。

**release へ PR でなく fast-forward push で入れる理由。** PR で merge すると、release 上に main には無い merge commit ができる。fast-forward なら、release の SHA は必ず main の履歴にあり、「本番で動いているもの = main のある時点」が常に成り立つ。CI の必須化は PR ではなく ruleset の required status check で担う（該当 SHA に `verify` の成功がない push は GitHub が拒否する）。

## CI

| workflow | いつ | 必須か | 中身 |
| --- | --- | --- | --- |
| `ci.yml`（job `verify`） | `rc/**`・`release` への push、release 向け PR、手動 | **release で必須** | format・types・build・unit・全 E2E・auth/editor ブラウザー・deploy:check |
| `main-health.yml`（job `health`） | main への push | 必須ではない | format・types・build・unit（E2E なし） |
| `release.yml`（job `tag` → `deploy`） | release への push、手動 | — | タグ `rYYYY.MM.DD.N` と GitHub Release（前回タグからの commit 一覧）を作り、environment `production` に `CLOUDFLARE_API_TOKEN` があれば本番へ deploy する（無ければ deploy job は notice を出して飛ばす） |
| `deploy.yml` | main への push（`CLOUDFLARE_DEPLOY_ENABLED` が無いので今は動かない） | — | 旧プレビュー（`kobe-student-hub-preview`）用。本番とは無関係 |

PR に CI を付けない理由。いまはセッションの数だけ並行して変更が入り、PR ごとに 15〜25 分の E2E を待つと、ループの速度が CI の待ち時間で決まってしまう。壊れたものが本番に入らないことは昇格時の `verify` で守れる。main が壊れたことは `main-health` が数分で知らせる。

## 便と記録（2026-11-22 オーナー決定）

- **定時便**：毎日 **08:00（朝便）と 20:00（夜便）JST**。Orca automation `ksh release` が起こす。便の窓は発車から 2 時間（08:00〜09:59、20:00〜21:59）。
- **臨時便**：窓の外の昇格・deploy は、`--hotfix "<理由>"` を付けたときだけ通る（緊急の修正、壊れた本番の復旧など）。付けなければ `npm run release` が exit 5 で止め、次の便を案内する。臨時便は open な `P0` があっても出せる。
- **見送り**：変更なし・main-health 赤・open な `P0`・別の rc の CI 実行中は、`npm run release` が自分で見送る。R2 の独立検証待ちのような判断は agent が `npm run release -- --skip "<理由>"` で見送りとして残す。
- **記録**：`npm run release`（`--plan` を除く）は、成功・見送り・失敗のどの終わり方でも、GitHub Issue（label `release-log`、タイトル「Release log（リリース列車の記録）」）へ 1 便 1 コメントを書く。中身は、開始・終了時刻、便（朝便／夜便／臨時便とその理由）、版（tag と SHA）、前の release、含む commit と新しい migration、CI verify の結果と URL（失敗した job・step 名）、deploy の担い手と結果、smoke の結果、D1 ブックマーク、結果の種類と理由。人が読む表と、集計用の 1 行 JSON を同じコメントに入れる（`scripts/loop/release-log.mjs`）。
- **集計**：`npm run release:report -- --days 7`（または `--since 2026-11-22`、`--json`）。結果の内訳、失敗とその理由、記録の無い定時便を出す。Issue へ書けなかったときは、手元に残した JSON を `npm run release:log -- --retry <file>` で送り直す。

記録をリポジトリのファイルでなく Issue に置く理由：記録の commit が main に入ると、main が常に「未リリース」になり、次の便が記録だけを出荷しに行く。GitHub Release は昇格した便にしかできず、見送りや CI 赤の理由を残せない。

## リリースの手順（人でも agent でも同じ）

```bash
npm run release -- --plan            # 何が昇格するかを見るだけ
npm run release                      # origin/main の先頭を昇格（CI を待つ）
npm run release -- --sha <sha>       # main の特定の SHA を昇格
npm run release -- --deploy          # 昇格 + 本番 deploy（migration → deploy → smoke、失敗時は自動 rollback）。定時便の窓の中だけ
npm run release -- --deploy --hotfix "#210 ログインできない"   # 窓の外の臨時便（理由は記録に残る）
npm run release -- --skip "R2 #205 の独立検証待ち"             # 判断で見送った便を記録する
npm run release:report -- --days 7   # 便ごとの記録を集計する
npm run release -- --sha <release の SHA> --deploy --skip-migrations   # 昇格済みの版を Worker だけ出し直す
npm run smoke -- https://hub.junhat6.com
```

`scripts/release.mjs` は次の順で動く。

1. その SHA が `origin/main` の履歴にあり、今の `release` から fast-forward できることを確かめる。
2. その SHA に `verify` の成功がまだ無ければ、`rc/<sha7>` へ push して full CI を待つ（最長 60 分）。
3. green なら `release` へ push する。ruleset が `verify` の成功をもう一度確かめる。その後 `release.yml` がタグと Release を作る。
4. `--deploy` を付けたときは本番へ出す。environment `production` に `CLOUDFLARE_API_TOKEN` があれば、`release.yml` の deploy job を `gh run watch` で最後まで見届ける（release が既にその SHA なら workflow を手動で起こし直す）。無ければ、その SHA を一時的な worktree に取り出して build し、手元で同じ `scripts/deploy-production.mjs` を実行する。

`scripts/deploy-production.mjs`（手元と Actions で共通）は次の順で動く。

1. 本番の wrangler 設定を生成する（`scripts/production-wrangler.mjs`、下の「本番の設定」）。
2. preflight：`wrangler versions upload` で、トラフィックを切り替えずに設定と bundle を Cloudflare に検証させる。
3. 本番 D1 の `d1_migrations` と `migrations/` を比べ、未適用があれば **Time Travel のブックマークを記録してから** `wrangler d1 migrations apply --remote` で適用する。
4. `wrangler deploy` で切り替える（独自ドメイン `hub.junhat6.com`・cron `*/15`・CPU 上限も設定どおりに揃う）。
5. 本番 smoke（トップ・`/api/health`・`/api/catalog`・書き込み拒否・security header）。失敗したら `wrangler rollback` で直前の版に戻す。

終了コード：0 成功（見送りを含む）／2 smoke 失敗で rollback 済み／3 設定の入力が無い／4 D1 に届かない／5 定時便の窓の外（`--hotfix` が無い）・引数の不足／1 その他（rollback の失敗を含む）。`npm run release` は Actions の deploy が失敗したとき、理由を問わず 1 を返す（ログで確かめる）。

**hotfix も main で直す。** release へ直接 commit したり cherry-pick したりしない。直した commit を main に push し、その SHA を昇格させる。

**D1 migration は deploy に含め、agent が判断して適用する**（2026-11-21 オーナー決定。それまでは人の承認を得た別操作だった）。安全は次の3つで担う。

- migration は expand → contract で書く。1つ前の Worker でも動く形（追加だけ）にし、削除・改名・既存データの書き換えは別の列車に分ける。deploy は「migration → Worker 切り替え」の順なので、どこで失敗しても Worker の rollback だけで復旧できる。
- 適用前のブックマークを必ずログ（Actions は job summary）に残す。
- D1 は自動では戻さない。Time Travel の restore はブックマーク以降の利用者の書き込みも消すため、戻すかは agent が個別に判断する（判断表は `.claude/skills/release/SKILL.md`）。

## 本番の設定

本番 Worker は `kobe-student-hub-production`（独自ドメイン `hub.junhat6.com`、D1 `kobe-student-hub-production`、Workers Paid）。wrangler 設定はリポジトリに置かず、deploy のたびに `scripts/production-wrangler.mjs` が組み立てる（`npm run production:config` で `.wrangler/production.deploy.json` に書き出せる）。

- **リポジトリに書くもの**：Worker 名・独自ドメイン・cron・CPU 上限（1 リクエスト 1 秒）・assets・observability・通報メールの送信元。
- **リポジトリに書かないもの**（公開リポジトリのため）：account ID、D1 ID、Google client ID、通報メールの宛先。環境変数（`CLOUDFLARE_ACCOUNT_ID`・`KSH_PROD_D1_DATABASE_ID`・`KSH_PROD_GOOGLE_CLIENT_ID`・`KSH_PROD_MODERATION_EMAIL_TO`）か、手元の `~/.config/kobe-student-hub/production.json`（mode 0600）から読む。GitHub Actions では environment `production` の secrets に同じ名前で入っている。
- **secret**（Google client secret、cookie 鍵、運営者 ID、通報メールの宛先・送信元、公開窓口）は Cloudflare 上にあり、`wrangler deploy` は既存の secret を引き継ぐ。値はどこにも書かない。変えるときは `wrangler secret put`（agent が判断してよい）。

以前の設定は worktree 内の `/tmp` にあって消えた（#166）。正本を worktree の外（`~/.config`）と GitHub の environment に分けて置くのはそのため。値は Cloudflare（`wrangler versions view` の bindings）から読み直せる。

**GitHub Actions への移行（2026-11-22 完了）。** オーナーが Workers Paid に加入し、CI 用 token（`kobe-student-hub-github-actions`）を **repo の secret** `CLOUDFLARE_API_TOKEN` に入れた。account ID などは environment `production` の secrets にある。deploy job は environment `production` で動くので両方を読める。`scripts/release.mjs` は environment と repo のどちらかに token があれば Actions の deploy を見届ける形に切り替わる。token の権限は本番の account だけに限定し、`Workers Scripts: Edit`・`D1: Edit`・`Account Settings: Read` と、zone `junhat6.com` の `Workers Routes: Edit`。repo の secret は release 以外のブランチの workflow からも読めるため、environment `production`（release 限定）へ移すのが望ましい（値を知るのはオーナーだけなので、移すならオーナーが `gh secret set CLOUDFLARE_API_TOKEN --env production` → `gh secret delete CLOUDFLARE_API_TOKEN`）。手元の wrangler OAuth は D1 に使えない（認証エラー）ため、手元で deploy するときの D1 migration は skill の「手元で D1 に届かないとき」に従う。

## agent の hooks（`.claude/settings.json`）

Claude Code でこのリポジトリを開いたセッションには、次の hook が自動でかかる。Codex 用の hook はまだ置いていないので、Codex には同じ決まりを AGENTS.md で伝える。

| hook | スクリプト | やること |
| --- | --- | --- |
| SessionStart | `scripts/loop/session-start.mjs` | 現在地（未リリースの commit 数、main-health の結果、並行中の worktree、WORK.md の現在地）を文脈に入れる |
| PreToolUse(Bash) | `scripts/loop/guard.mjs` | force push、release への直接 push、main/release の削除、素の `git stash`、ruleset の変更を拒否し、正しい入口を返す。本番の運用（`wrangler deploy` / `rollback` / `secret put`、リモート D1）は止めない（2026-11-21 から） |
| Stop | `scripts/loop/stop-check.mjs` | main に届いていない commit や、commit していない変更があれば 1 回だけ止めて、push を促す（理由を書けばそのまま終えられる） |

`npm run release` の中で行う push は hook の対象外なので、止められない（入口を 1 つにするため）。ruleset を変えるときは、担当がコマンドの先頭に `KSH_LOOP_INFRA=1` を付けて、意図した変更であることを明示する。止めたい hook があれば、`KSH_LOOP_STOP_CHECK=off` を設定して起動する。

## Orca automations

ループの名前と中身は [docs/loop/LOOPS.md](loop/LOOPS.md) の定義に揃える。precheck が exit 0 を返したときだけ agent を起こすので、仕事が無い時間帯には費用がかからない。

| 名前 | 起動 | precheck（`node scripts/loop/precheck.mjs <mode>`） | 仕事 |
| --- | --- | --- | --- |
| `ksh release` | 毎日 08:00・20:00（`0 8,20 * * *`、missed-run grace 100 分） | `release`：常に通す（止める条件は `npm run release` が判定し、見送りとして記録する） | release skill（`.claude/skills/release/SKILL.md`）に従って `npm run release -- --deploy` を回し、結果ごとに対応する。結果は Issue `release-log` に自動で残る |
| `ksh mend` | 毎時 | `mend`：main-health の最新が失敗 | 失敗の原因を直して main に push する（アンドン） |
| `ksh patrol` | 3 時間ごと（`docs/loop/prompts/patrol.md`） | `patrol`：`patrol-log` Issue に記録した前回 SHA 以降に `src/`・`worker/`・`public/` の変更がある、または前回巡回の後に release が出た | 別 context で PC / モバイルの利用者の旅を歩き、UX の所見を Issue にする |
| `ksh finish` | 30 分ごと | `finish`：未 claim の `P0`/`P1`（`loop:finish`/`loop:ux`）があり、claim 中が 3 件未満 | `docs/loop/prompts/finish.md` に従って Issue を 1 件閉じる |
| `ksh garden` | 毎日 5:00 | `garden`：`garden-log` の前回 SHA 以降に main への commit がある | `docs/loop/prompts/garden.md` |
| `ksh replan` | 4 時間ごと | `replan`：前回 `Loop: replan` 以降に Issue か completion.json の変化、待ち行列が空、または blocked が 3 件以上 | `docs/loop/prompts/replan.md` |

ラベル：`P0`（open の間は列車を止める）、`patrol-log`（巡回記録）、`needs-human`（課金・契約、新しい資格情報の発行、実利用者への連絡など、人の判断が必要なもの）。

いずれも 1 回の起動ごとに新しい worktree を作り、指示書（`docs/loop/prompts/<名前>.md`）を読んで 1 周だけ回す。指示書を書き換えれば、automation を登録し直さなくても次の周回から反映される。GitHub のイベント（CI 失敗・Issue）で起動する Orca bot は、作成に owner の承認が必要なため未作成。
