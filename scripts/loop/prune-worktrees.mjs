#!/usr/bin/env node
// automation の run が作った worktree のうち、もう要らないものを片付ける。
// 理由と、Orca 標準の掃除ルールを使わない理由は docs/loop/ORCA.md。
//
//   node scripts/loop/prune-worktrees.mjs            … 何を消すかを表示するだけ（既定）
//   node scripts/loop/prune-worktrees.mjs --apply    … 実際に消す
//   node scripts/loop/prune-worktrees.mjs --apply --precheck
//        … Orca automation `ksh tidy` の precheck 用。片付けたあと必ず exit 1 で終わり、agent を起こさない。
//
// 消すのは次の全部を満たす worktree だけ。1つでも確かめられなければ残す（分からない＝残す）。
//   1. kobe-student-hub の、Orca automation が作った worktree（main worktree・常駐レーン・人の worktree は対象外）
//   2. ピン留めされていない、いま画面で開かれていない
//   3. 作った run が終わっている（run が履歴に無いときは 24 時間以上動きが無い）
//   4. 最後の活動とターミナル出力から 60 分以上たっている（Orca 標準ルールの猶予と同じ）
//   5. 未 commit の変更が無い（untracked も含む。.gitignore 済みのものは数えない）
//   6. HEAD の commit がすべて origin/main に入っている（git cherry で patch 単位に確かめる。squash・rebase 後も可）
// 1回に消すのは KSH_PRUNE_MAX 個（既定 20）まで、持ち時間 KSH_PRUNE_BUDGET_SECONDS（既定 420 秒）まで。
// 消すときは、残っている idle のターミナルを閉じてから `orca worktree rm --delete-branch` する。
// ブランチの削除は Orca が「main に入っていると証明できたもの」だけに行い、それ以外は残る。
// このファイルは precheck と同じく origin/main から一時ファイルへ書き出して実行されるので、相対 import をしない。
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const REPO_NAME = process.env.KSH_REPO_NAME || 'kobe-student-hub';
const QUIET_MS = 60 * 60 * 1000;
const NO_RUN_QUIET_MS = 24 * 60 * 60 * 1000;
const MAX_REMOVALS = Number(process.env.KSH_PRUNE_MAX || 20);
// precheck の上限は 600 秒（Orca の MAX_AUTOMATION_PRECHECK_TIMEOUT_SECONDS）。1個消すのに 20〜30 秒かかるので、持ち時間を超えたら次回に回す
const BUDGET_MS = Number(process.env.KSH_PRUNE_BUDGET_SECONDS || 420) * 1000;
const startedAt = Date.now();
const FINAL = new Set([
  'completed',
  'dispatch_failed',
  'skipped_precheck',
  'skipped_missed',
  'skipped_unavailable',
  'skipped_needs_interactive_auth',
]);

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const asPrecheck = args.has('--precheck');

const ORCA =
  process.env.ORCA_CLI ||
  (existsSync('/Applications/Orca.app/Contents/Resources/bin/orca')
    ? '/Applications/Orca.app/Contents/Resources/bin/orca'
    : 'orca');

const run = (cmd, argv, timeout = 60_000) =>
  execFileSync(cmd, argv, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
const tryRun = (cmd, argv, timeout) => {
  try {
    return { ok: true, out: run(cmd, argv, timeout) };
  } catch (error) {
    return { ok: false, out: String(error.stderr || error.message || '').trim() };
  }
};
const orcaJson = (...argv) => JSON.parse(run(ORCA, [...argv, '--json'], 120_000)).result;
const git = (dir, ...argv) => tryRun('git', ['-C', dir, ...argv], 60_000);

const finish = (code) => process.exit(asPrecheck ? 1 : code);

let worktrees;
let runs;
try {
  worktrees = orcaJson('worktree', 'ps').worktrees;
  runs = orcaJson('automations', 'runs', '--limit', '100').runs ?? [];
} catch (error) {
  console.log(`prune: Orca に繋がらないので何もしない (${String(error.message).split('\n')[0]})`);
  finish(0);
}
const runByWorkspace = new Map();
for (const r of runs) if (r.workspaceId) runByWorkspace.set(r.workspaceId, r);

const now = Date.now();
const kept = [];
const removable = [];

for (const w of worktrees) {
  if (w.repo !== REPO_NAME || w.workspaceKind !== 'git' || w.isMainWorktree) continue;
  if (!w.automationCreated) continue; // 常駐レーンと人の worktree には触らない
  const name = w.displayName;
  const keep = (why) => kept.push({ name, why });

  if (w.isPinned) {
    keep('ピン留め');
    continue;
  }
  if (w.isActive) {
    keep('いま画面で開いている');
    continue;
  }
  const r = runByWorkspace.get(w.worktreeId);
  const lastSeen = Math.max(w.lastActivityAt || 0, w.lastOutputAt || 0, w.createdAt || 0);
  if (r) {
    if (!FINAL.has(r.status)) {
      keep(`run が終わっていない (${r.status})`);
      continue;
    }
    if (now - lastSeen < QUIET_MS) {
      keep('最後の動きから 60 分たっていない');
      continue;
    }
  } else if (now - lastSeen < NO_RUN_QUIET_MS) {
    keep('run が履歴に無く、24 時間たっていない');
    continue;
  }
  if (!existsSync(w.path)) {
    removable.push({ w, name, note: 'フォルダが既に無い' });
    continue;
  }
  if (!git(w.path, 'fetch', '-q', 'origin', 'main').ok) {
    keep('origin/main を取得できない');
    continue;
  }
  const status = git(w.path, 'status', '--porcelain');
  if (!status.ok) {
    keep('git status を読めない');
    continue;
  }
  if (status.out) {
    keep(`未 commit の変更 ${status.out.split('\n').length} 件`);
    continue;
  }
  // .gitignore 済みでも、その worktree にしか無いかもしれない設定ファイルは消さない（Orca の ignored-files と同じ考え）
  const ignored = git(
    w.path,
    'ls-files',
    '--others',
    '--ignored',
    '--exclude-standard',
    '--directory',
  );
  if (!ignored.ok) {
    keep('ignore 済みのファイルを読めない');
    continue;
  }
  const localConfig = ignored.out
    .split('\n')
    .filter((p) => /(^|\/)(\.env[^/]*|\.dev\.vars[^/]*)$/.test(p) && !p.includes('node_modules/'));
  if (localConfig.length > 0) {
    keep(`ローカル設定ファイルがある (${localConfig.slice(0, 3).join(', ')})`);
    continue;
  }
  const cherry = git(w.path, 'cherry', 'origin/main', 'HEAD');
  if (!cherry.ok) {
    keep('commit が main に入ったか確かめられない');
    continue;
  }
  const unlanded = cherry.out.split('\n').filter((line) => line.startsWith('+')).length;
  if (unlanded > 0) {
    keep(`main に入っていない commit ${unlanded} 件`);
    continue;
  }
  removable.push({ w, name, note: r ? `run ${r.status}` : 'run 履歴なし・24h 以上静か' });
}

const removed = [];
const failed = [];
let deferred = 0;
for (const item of removable.slice(0, apply ? MAX_REMOVALS : removable.length)) {
  if (!apply) continue;
  if (Date.now() - startedAt > BUDGET_MS) {
    deferred += 1;
    continue;
  }
  const selector = `id:${item.w.worktreeId}`;
  if ((item.w.liveTerminalCount || 0) > 0 || item.w.hasAttachedPty) {
    const closed = tryRun(
      ORCA,
      ['terminal', 'close', '--worktree', selector, '--all', '--json'],
      60_000,
    );
    if (!closed.ok) {
      failed.push({
        name: item.name,
        why: `ターミナルを閉じられない: ${closed.out.split('\n')[0]}`,
      });
      continue;
    }
  }
  const rm = tryRun(
    ORCA,
    ['worktree', 'rm', '--worktree', selector, '--delete-branch', '--json'],
    180_000,
  );
  if (rm.ok) removed.push(item.name);
  else failed.push({ name: item.name, why: rm.out.split('\n')[0] });
}

const summary = apply
  ? `prune: 削除 ${removed.length} / 残す ${kept.length} / 失敗 ${failed.length}` +
    (deferred + Math.max(0, removable.length - MAX_REMOVALS) > 0
      ? ` / 次回に回す ${deferred + Math.max(0, removable.length - MAX_REMOVALS)}`
      : '')
  : `prune (dry-run): 削除候補 ${removable.length} / 残す ${kept.length}`;
console.log(summary);
for (const name of removed) console.log(`  removed  ${name}`);
if (!apply) for (const item of removable) console.log(`  would-rm ${item.name} (${item.note})`);
for (const f of failed) console.log(`  failed   ${f.name}: ${f.why}`);
for (const k of kept) console.log(`  keep     ${k.name}: ${k.why}`);
finish(failed.length > 0 ? 2 : 0);
