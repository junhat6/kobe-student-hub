# Orca の使い方 — automation を残し、bots には移らない

2026-11-22 作成。自律ループを Orca のどの機能に任せ、どこを自作のまま持つかの判断と根拠です。
思想の違い（何を自動化し何を人に残すか）は [ORCA-BOTS-PHILOSOPHY.md](ORCA-BOTS-PHILOSOPHY.md)、ループの仕様は [LOOPS.md](LOOPS.md) にあります。

根拠は、手元で動いている Orca 1.4.269 のソース（stablyai/orca、タグ `v1.4.269`）と、`orca` CLI で読んだ実際の automation 定義・run 履歴です。ドキュメントや画面の見た目からの推測ではありません。

## 結論

1. **起動は今のまま Orca automation（プロジェクト向け、`new_per_run`）に任せる。** finish / patrol / garden / replan / release / mend の6本（2026-11-22 時点。その後 polish・editor と、agent を起こさない tidy を足した。一覧は [RELEASE.md](../RELEASE.md#orca-automations)）は変えない。
2. **Orca bots には移らない。** bot はリポジトリの worktree ではなく bot 自身のフォルダで動き、マージなどの最終判断を owner に戻す指示が、上書きできない形で入っているため（§2）。
3. **足りなかったのは後片付けだけ。** run ごとに作られる worktree が消されず、2日で 66 個たまっていた。`ksh tidy`（precheck だけで動き、agent を起こさない automation）と `scripts/loop/prune-worktrees.mjs` を足して、毎時片付ける（§3）。
4. **Orca 標準の掃除ルール（Settings の Workspace cleanup → automation runs）は使わない。** 安全確認の中身はこのルールに合わせたが、ルールそのものは使わない理由が3つある（§3.2）。
5. **automation の agent を Antigravity に替えない（2026-11-23）。** 画像・動画を見る所だけを `npm run look:review`（`agy` を CLI で1回）に渡す。理由と見直す条件は [LOOK.md](LOOK.md#antigravity-を係にしない理由)。

## 1. 現状の仕組みと、実際に起きていたこと

| 項目 | 実際の値（2026-11-22 時点） |
| --- | --- |
| automation | 6本。すべて `agentId=claude`、`workspaceMode=new_per_run`、`baseBranch=main`、precheck つき |
| run 履歴（直近129件） | completed 63 / skipped_precheck 63 / dispatch_failed 3 |
| 溜まった worktree | kobe-student-hub だけで 71（うち automation が作ったもの 66） |
| 失われた作業 | 0。66個とも未 commit なし、main に入っていない commit なし（1個だけ tsc のキャッシュ `tsconfig.tsbuildinfo` が残っていた） |

ソースで確かめた振る舞い：

- **precheck は worktree を作る前に走る**（`src/main/automations/dispatch/automation-launch-runner.ts`：`run.trigger === 'scheduled' && automation.precheck` のとき先に `runPrecheck()`）。skip された 63 件は worktree を作っていない。precheck で「やることが無いなら起こさない」設計は、そのまま正しく効いている。
- **`new_per_run` の worktree は、run が終わっても Orca は消さない。** 消すのは掃除ルール（`src/shared/workspace-cleanup/`）だけで、その既定値はすべて off（`getDefaultWorkspaceCleanupRules()`）。`orca workspace cleanup preview` も「No cleanup rule is on」を返していた。これが worktree が溜まる原因。
- **run が終わってもターミナルが残る。** Claude が入力待ちのまま止まるため。66個のうち 27個でターミナルが生きていた。Orca には古い run のターミナルを閉じる処理（`terminal-retention/run-terminal-retention.ts`、automation ごとに新しい3つを残す）があるが、人が一度でも見たターミナルは閉じないので、実際には残り続けていた。
- **dispatch_failed の3件**は「6時間たっても終了の合図が来ないので見るのをやめた」（finish run 34）などで、worktree 自体は空だった。

## 2. Orca bots を使わない理由（ソースで確かめたこと）

bots は「1人の owner に仕える、名前と記憶を持つ代理人」です。中身は次のとおりです。

| bots の仕組み | ソース | このプロジェクトに合うか |
| --- | --- | --- |
| bot の automation は **bot 自身のフォルダで動く**。プロジェクトの worktree は作らない | `src/main/automations/bot-run-target.ts`（`cwd: folder.folderPath`） | 合わない。finish・release はリポジトリの worktree で build・test・push する。bot からコードを触るには、さらに orchestration worker を起こして子 worktree に渡す二段構えになり、起動が1段増える |
| 全セッションに差し込まれる固定の指示に「merge only when your owner asks」がある。`SOUL.md` で変えられるのは書き方と worker の使い方だけ | `src/main/bots/bot-preamble.ts` | 合わない。このプロジェクトは main への commit と本番反映を agent に任せている（[AGENTS.md](../../AGENTS.md)） |
| 記憶は bot のフォルダの `MEMORY.md` と Home Chat に置く。毎晩 tidy-up で整理する | `src/shared/bots/bot-tidy-up.ts` | 合わない。状態はリポジトリと Issues に置き、1周ごとに context を捨てる方針（[SESSIONS.md](SESSIONS.md)）。bot の記憶は Codex や GitHub Actions からは見えない |
| テンプレートは「SOUL.md の種・skill・connector・定期実行（作った時点では off）・イベント」の詰め合わせで、作るときに1回だけコピーされる | `src/shared/bots/bot-templates.ts`、`bot-template-catalog/*.ts` | 中身はほぼ「一覧にして owner に聞く」型（Workspace cleanup も「消してよさそうなものを毎週並べ、owner が選んだものだけ消す」）。自律ループの代わりにはならない |
| `--on`（GitHub・Slack・Linear のイベントで起動）は **bot の automation だけ**が使える | `orca automations create --help` の Notes | 唯一うらやましい点。ただし Orca Cloud の connector が必要で、run は bot フォルダで動く。いまは mend（main-health が赤）を毎時の precheck で拾えており、困っていない |

**bots から借りたもの**：テンプレート同梱の skill `workspace-hygiene`（`src/main/bots/bot-template-skills/workspace-hygiene.ts`）の「消す前に確かめる3点（未 commit・未 push・動いている agent やターミナル）」を、掃除スクリプトの条件にそのまま入れた。「owner が選んだものだけ消す」は借りず、3点が問題なければ自動で消す。

**見直す条件**：Orca が (a) bot の automation をプロジェクトの worktree で動かせるようにする、(b) 固定の指示の承認規則を bot ごとに変えられるようにする、のどちらかを出したら、イベント起動（`--on`）のために mend だけ bot に移すことを考え直す。Orca を更新したら `bot-run-target.ts` と `bot-preamble.ts` を確かめる。

## 3. 後片付け：`ksh tidy` と prune-worktrees.mjs

### 3.1 仕組み

```text
ksh tidy（毎時 45 分、Orca automation）
  └─ precheck: origin/main の scripts/loop/prune-worktrees.mjs を一時ファイルに書き出して
               `--apply --precheck` で実行 → 片付けたあと必ず exit 1
  └─ agent は起こさない（run 履歴には skipped_precheck として残り、precheck の出力に結果が残る）
```

消すのは、次の**全部**を満たす worktree だけです。1つでも確かめられなければ残します（分からない＝残す）。

1. kobe-student-hub の、automation が作った worktree（`orca worktree ps` の `automationCreated`）。main worktree・常駐レーン（app-dev・loop-design・loop-infra）・人の worktree には触らない
2. ピン留めされていない、いま画面で開かれていない
3. 作った run が終わっている。run が履歴（直近100件）に無いときは、24時間以上動きが無い
4. そこにいる agent（`orca agent list`）がすべて `done` で、最後の活動（workspace と agent の更新時刻）から 60 分以上たっている。ターミナル出力の時刻は使わない：終わった Claude もステータス行を描き直し続けるので、出力の時刻はいつまでも新しく見える（初版はこれを使っていて、終わった run を「60 分たっていない」と残し続けた）
5. 未 commit の変更が無い（untracked も含む）。ignore 済みでも `.env*`・`.dev.vars*` があれば残す
6. HEAD の commit がすべて origin/main に入っている（`git cherry` で patch 単位に確かめるので、rebase 後も判定できる）

**止まった run の例外**（2026-11-22 追加）：3・4 を満たさなくても、最後の活動から 6 時間（`KSH_PRUNE_STALL_HOURS`）たったものは「止まった run」とみなして 5・6 に進み、通れば消します。API エラーやネットワーク切断で止まった Claude は、入力待ちのまま `working` と表示され続け、run も `dispatched` のまま残ります。Orca 自身も 6 時間で run を見るのをやめます（`runtime-terminal-run-observer.ts` の `OBSERVE_DEADLINE_MS`）。この例外が無いと、こうした worktree は永久に残ります（実例：patrol run 13・release run 8 が `API Error: ENOTFOUND` で止まり、15 時台から残っていた）。5・6 で残ったものは `要確認（止まった run）` と表示され、garden が毎日拾います（[garden.md](prompts/garden.md) の 0）。

消すときは、残っている idle のターミナルを閉じてから `orca worktree rm --delete-branch` します。ブランチを消すのは Orca が「main に入っている」と証明できたものだけで、それ以外は残ります。1個消すのに 20〜30 秒かかり、precheck には 600 秒の上限（`MAX_AUTOMATION_PRECHECK_TIMEOUT_SECONDS`）があるため、1回に消すのは 20 個・420 秒まで（`KSH_PRUNE_MAX`・`KSH_PRUNE_BUDGET_SECONDS`）にして、残りは次の回に回します。

手で確かめるとき：`node scripts/loop/prune-worktrees.mjs`（表示だけ）、`--apply`（実際に消す）。

### 3.2 Orca 標準の掃除ルールを使わない理由

Orca には `automationRuns` ルール（「終わった automation run の workspace を消す」）があり、安全確認（未 commit・未 push・ignore 済みのローカルファイル・動いている agent・最近の活動）もしっかりしています（`src/shared/workspace-cleanup/workspace-cleanup-evaluation.ts`）。それでも使わないのは次の理由です。

- **ターミナルが残ると消さない。** ルールは「run がそのターミナルを手放していること」（`!run.terminalPtyId`）を条件にしている。§1 のとおり、実際には 27個でターミナルが残っており、このルールだけでは溜まり続ける。
- **リポジトリから設定できない。** 設定は Orca の Settings 画面（または app の内部 RPC）だけで、`orca` CLI には設定するコマンドが無い。別のマシンや Orca の入れ直しで黙って off に戻り、そのことに誰も気づかない。
- **設定は Orca 全体（または画面でのプロジェクト単位）にかかる。** 他のリポジトリの worktree にも効いてしまう。

**採らない場合の影響**：標準ルールだけに頼ると、ターミナルが残った worktree が溜まり続け、ディスク（1個あたり node_modules 込みで数百 MB）とサイドバーを圧迫する。逆に、スクリプトが安全確認を省けば未 push の作業を消す事故が起きる。そのため条件は標準ルールと同じかそれより厳しくしている。

### 3.3 同時に直したこと

- `.gitignore` に `*.tsbuildinfo` を足した。tsc のキャッシュが untracked として残ると「未 commit の変更あり」と判定され、worktree が消えずに残るため。

## 4. 2026-11-22 の一回目の掃除の結果

automation が作った 66 個のうち 64 個を消しました（失敗 0）。ブランチは Orca が main に入っていると証明できたものだけ消え、途中で別ブランチに切り替えていた finish run 44 の元ブランチ 1 本は、`git cherry` で main に入っていない commit が 0 件と確かめてから手で消しました。残したのは次の7個です。

| 残したもの | 理由 |
| --- | --- |
| main（`~/ghq/.../kobe-student-hub`） | main worktree。automation の precheck もここで動く |
| loop-infra・loop-design・app-dev | 常駐レーン（[SESSIONS.md](SESSIONS.md)） |
| nginx-vuln-check（`fix/security-deps-2026-11`） | 人の作業用。中身は main に入っていてリモートのブランチも消えているので消してよいが、automation 以外の worktree は人が消す |
| auto-ksh-release-run-6・auto-ksh-replan-run-8 | 初版がターミナル出力の時刻で「60 分たっていない」と判定していた（§3.1 の 4）。判定を直したので次の `ksh tidy` で消える |

`~/orca/workspaces/kobe-student-hub/` 直下に release run が書いた `*.log`（e2e の起動ログ）が7個残っています。worktree ではないのでスクリプトの対象外です。

## 5. 掃除の監視役は置かない（2026-11-22）

掃除を見張る役は、専用の bot も automation も足しません。

- **掃除そのもの**は `ksh tidy` が毎時行う。初回の一斉掃除のあとの 7 回（11:45〜17:45）で 10 個を消し、失敗は 0 件だった。
- **掃除が漏れる形**は「止まった run」だけだった。これは tidy の判定（§3.1 の例外）で塞いだ。
- **tidy 自体が止まる・消せないものが残る**ことは、garden が毎日1回点検する（[garden.md](prompts/garden.md) の 0）。tidy の最新の run が 3 時間より前なら、automation が off にされたか Orca が止まっている。`要確認` は、中身を main に入れるか Issue にしてから消す。

**監視役を足さない理由**：見張りの役を増やすと、その役の worktree と run がまた増えるうえ、見張り役が止まったときに見張る役がさらに要る。点検は既にある日次の周にのせるほうが安く、壊れる場所も増えない。
**見直す条件**：garden の点検で、同じ `要確認` や tidy の停止が 2 日続けて見つかったら、tidy の失敗を Issue に書き出す処理を足す。

