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
| `release.yml` | release への push | — | タグ `rYYYY.MM.DD.N` と GitHub Release（前回タグからの commit 一覧）を作る |
| `deploy.yml` | main への push（`CLOUDFLARE_DEPLOY_ENABLED` が無いので今は動かない） | — | 旧プレビュー用。現状のまま残している |

PR に CI を付けない理由。いまはセッションの数だけ並行して変更が入り、PR ごとに 15〜25 分の E2E を待つと、ループの速度が CI の待ち時間で決まってしまう。壊れたものが本番に入らないことは昇格時の `verify` で守れる。main が壊れたことは `main-health` が数分で知らせる。

## リリースの手順（人でも agent でも同じ）

```bash
npm run release -- --plan            # 何が昇格するかを見るだけ
npm run release                      # origin/main の先頭を昇格（CI を待つ）
npm run release -- --sha <sha>       # main の特定の SHA を昇格
npm run release -- --deploy          # 昇格 + 本番 deploy + smoke（失敗時は自動 rollback）
npm run smoke -- https://hub.junhat6.com
```

`scripts/release.mjs` は次の順で動く。

1. その SHA が `origin/main` の履歴にあり、今の `release` から fast-forward できることを確かめる。
2. その SHA に `verify` の成功がまだ無ければ、`rc/<sha7>` へ push して full CI を待つ（最長 60 分）。
3. green なら `release` へ push する。ruleset が `verify` の成功をもう一度確かめる。その後 `release.yml` がタグと Release を作る。
4. `--deploy` を付けたときは、その SHA を一時的な worktree に取り出して build し、`KSH_PRODUCTION_CONFIG` の設定で deploy する。本番 smoke（トップ・`/api/health`・`/api/catalog`・書き込み拒否・security header）が失敗したら `wrangler rollback` で直前の版に戻す。

**hotfix も main で直す。** release へ直接 commit したり cherry-pick したりしない。直した commit を main に push し、その SHA を昇格させる。緊急時だけ人の判断で例外にする。

**DB schema は deploy に含めない。** リモート D1 への migration は、これまでどおり別の操作として人の承認を得てから行う（[DEPLOYMENT.md](DEPLOYMENT.md)）。Worker の rollback では schema は戻らない。

## 本番 deploy の前提（2026-11-21 時点で未完）

- 本番の wrangler 設定は秘密なので、リポジトリの外に置く。`KSH_PRODUCTION_CONFIG` にそのパスを、`KSH_PRODUCTION_ORIGIN` に本番 URL（既定は `https://hub.junhat6.com`）を指定する。以前の設定は `/tmp` 配下にあって既に消えたため、`npm run production:prepare` などで作り直す必要がある。
- 本番が最後に反映されたのは account-only 版。その後の main（通常投稿など）は、Workers Paid（CPU 上限）の契約判断を待って止まっている（#119）。**契約の変更は人の判断が必要なので、ループからは行わない。**
- GitHub Actions から deploy するための Cloudflare token は作っていない。token ができたら、`release.yml` に deploy job を足して、手元からの deploy をやめる。

## agent の hooks（`.claude/settings.json`）

Claude Code でこのリポジトリを開いたセッションには、次の hook が自動でかかる。Codex 用の hook はまだ置いていないので、Codex には同じ決まりを AGENTS.md で伝える。

| hook | スクリプト | やること |
| --- | --- | --- |
| SessionStart | `scripts/loop/session-start.mjs` | 現在地（未リリースの commit 数、main-health の結果、並行中の worktree、WORK.md の現在地）を文脈に入れる |
| PreToolUse(Bash) | `scripts/loop/guard.mjs` | force push、release への直接 push、main/release の削除、`wrangler deploy` / `rollback` / `secret put`、リモート D1、素の `git stash`、ruleset の変更を拒否し、正しい入口を返す |
| Stop | `scripts/loop/stop-check.mjs` | main に届いていない commit や、commit していない変更があれば 1 回だけ止めて、push を促す（理由を書けばそのまま終えられる） |

`npm run release` の中で行う push や deploy は hook の対象外なので、止められない（入口を 1 つにするため）。ruleset を変えるときは、担当がコマンドの先頭に `KSH_LOOP_INFRA=1` を付けて、意図した変更であることを明示する。止めたい hook があれば、`KSH_LOOP_STOP_CHECK=off` を設定して起動する。

## Orca automations

ループの名前と中身は [docs/loop/LOOPS.md](loop/LOOPS.md) の定義に揃える。precheck が exit 0 を返したときだけ agent を起こすので、仕事が無い時間帯には費用がかからない。

| 名前 | 起動 | precheck（`node scripts/loop/precheck.mjs <mode>`） | 仕事 |
| --- | --- | --- | --- |
| `ksh release` | 3 時間ごと（9〜24 時） | `release`：未リリースの commit がある・main-health が赤でない・open な `P0` Issue が無い・rc の CI が実行中でない | `npm run release -- --deploy` を実行し、結果ごとに対応する |
| `ksh mend` | 毎時 | `mend`：main-health の最新が失敗 | 失敗の原因を直して main に push する（アンドン） |
| `ksh patrol` | 3 時間ごと（`docs/loop/prompts/patrol.md`） | `patrol`：`patrol-log` Issue に記録した前回 SHA 以降に `src/`・`worker/`・`public/` の変更がある、または前回巡回の後に release が出た | 別 context で PC / モバイルの利用者の旅を歩き、UX の所見を Issue にする |
| `ksh finish` | 30 分ごと | `finish`：未 claim の `P0`/`P1`（`loop:finish`/`loop:ux`）があり、claim 中が 3 件未満 | `docs/loop/prompts/finish.md` に従って Issue を 1 件閉じる |
| `ksh garden` | 毎日 5:00 | `garden`：`garden-log` の前回 SHA 以降に main への commit がある | `docs/loop/prompts/garden.md` |
| `ksh replan` | 4 時間ごと | `replan`：前回 `Loop: replan` 以降に Issue か completion.json の変化、待ち行列が空、または blocked が 3 件以上 | `docs/loop/prompts/replan.md` |

ラベル：`P0`（open の間は列車を止める）、`patrol-log`（巡回記録）、`needs-human`（契約・secret・リモート D1 など、人の判断が必要なもの）。

いずれも 1 回の起動ごとに新しい worktree を作り、指示書（`docs/loop/prompts/<名前>.md`）を読んで 1 周だけ回す。指示書を書き換えれば、automation を登録し直さなくても次の周回から反映される。GitHub のイベント（CI 失敗・Issue）で起動する Orca bot は、作成に owner の承認が必要なため未作成。
