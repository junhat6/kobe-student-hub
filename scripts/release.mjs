#!/usr/bin/env node
// npm run release -- [--sha <sha>] [--deploy] [--plan] [--hotfix "<理由>"] [--skip "<理由>"]
//
// 便: 昇格と deploy は 08:00 / 20:00 JST の定時便の窓（発車から 2 時間）でだけ行う。窓の外は
//     --hotfix "<理由>" を付けた臨時便だけ（オーナー方針 2026-11-22。scripts/loop/release-log.mjs）。
// 記録: --plan 以外は、成功・見送り・失敗のどれでも結果を release-log Issue に 1 件残す。
//     --skip "<理由>" は、agent が判断で見送った便（R2 の独立検証待ちなど）を記録だけして終える。
//
// main の 1 つの SHA を「列車」に乗せて release へ昇格させる、唯一の入口。
//   1. SHA が main の履歴にあり、release から fast-forward できることを確かめる
//   2. その SHA に CI(verify) の成功が無ければ rc/<sha7> へ push して full CI を走らせ、結果を待つ
//   3. green なら release へ fast-forward push（ruleset が verify の成功を再確認する）
//      → release.yml がタグと GitHub Release を作る
//   4. --deploy なら本番へ出す。CI 用 token があれば release.yml の deploy job を待って結果を見届け、
//      無ければ手元で scripts/deploy-production.mjs を実行する（migration → deploy → smoke → 失敗時 rollback）
//
// CI は PR や main では必須にせず、ここでだけ必須にする。main を速く回し、本番に入るものだけを厳しく見るため。
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { smoke } from './loop/smoke.mjs';
import { nextTrain, recordRelease, trainAt } from './loop/release-log.mjs';

const REPO = process.env.KSH_REPO || 'junhat6/kobe-student-hub';
const CHECK = 'verify';
const CI_TIMEOUT_MIN = Number(process.env.KSH_RELEASE_CI_TIMEOUT_MIN || 60);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
// 値を取るオプション。値が無い・次が別のオプションなら ''（付いているが空）を返す
const opt = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : '';
};

const sh = (cmd, a, o = {}) =>
  (
    execFileSync(cmd, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...o }) ?? ''
  ).trim();
const tryGit = (...a) => {
  try {
    return sh('git', a, { stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
};
const isAncestor = (a, b) => spawnSync('git', ['merge-base', '--is-ancestor', a, b]).status === 0;
const log = (m) => console.log(`[release] ${m}`);

// この列車の記録。終わり方（成功・見送り・失敗）にかかわらず finish() が 1 回だけ残す。
const now = process.env.KSH_RELEASE_NOW ? new Date(process.env.KSH_RELEASE_NOW) : new Date();
const hotfix = opt('--hotfix');
const rec = {
  v: 1,
  startedAt: now.toISOString(),
  train: hotfix !== undefined ? undefined : trainAt(now),
  hotfix,
  host: process.env.GITHUB_ACTIONS ? 'actions' : 'local',
};
let recording = false; // --plan と便の窓の外での拒否は記録しない（列車が走っていない）
function finish(outcome, reason, code = 0) {
  if (outcome === 'skipped') log(`見送り: ${reason}`);
  if (recording) {
    rec.outcome = outcome;
    if (reason) rec.reason = String(reason).split('\n')[0].slice(0, 300);
    rec.finishedAt = new Date().toISOString();
    recordRelease(rec);
  }
  process.exit(code);
}
const die = (m, code = 1, outcome = 'error') => {
  console.error(`[release] 中止: ${m}`);
  finish(outcome, m, code);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// gh の一時的な失敗（api.github.com に繋がらない等）は数回やり直す。CI を待つ間の 1 回の失敗で列車を
// 落とすと、rc が置き去りになり記録も残らないため（#212）。やり直しても駄目なら GitHubUnreachable を投げ、
// 最後の catch が github_unreachable として記録してから終える。
const GH_RETRIES = Math.max(1, Number(process.env.KSH_RELEASE_GH_RETRIES || 5));
const GH_RETRY_MS = Number(process.env.KSH_RELEASE_GH_RETRY_MS ?? 30_000);
class GitHubUnreachable extends Error {}
async function ghRetry(a, what) {
  for (let i = 1; ; i++) {
    try {
      return sh('gh', a);
    } catch (e) {
      const first = String(e.stderr || e.message || e).split('\n')[0];
      if (i >= GH_RETRIES)
        throw new GitHubUnreachable(`GitHub API に繋がりません（${what}、${i} 回試行）: ${first}`);
      log(
        `gh が失敗しました（${what}、${i}/${GH_RETRIES}）。${GH_RETRY_MS / 1000} 秒後にやり直します`,
      );
      await sleep(GH_RETRY_MS);
    }
  }
}

async function verifyState(sha) {
  // CI workflow の verify job の、その SHA に対する最新結果
  const out = await ghRetry(
    [
      'api',
      `repos/${REPO}/commits/${sha}/check-runs?check_name=${CHECK}&per_page=20`,
      '-q',
      '.check_runs | sort_by(.started_at) | last | "\\(.status) \\(.conclusion) \\(.html_url)"',
    ],
    'CI の結果の確認',
  );
  if (!out || out === 'null null null') return { status: 'none' };
  const [status, conclusion, url] = out.split(' ');
  return { status, conclusion, url };
}

async function waitForCi(sha) {
  const deadline = Date.now() + CI_TIMEOUT_MIN * 60_000;
  let last = '';
  while (Date.now() < deadline) {
    const s = await verifyState(sha);
    const now = `${s.status}/${s.conclusion ?? '-'}`;
    if (now !== last) log(`CI ${CHECK}: ${now}${s.url && s.url !== 'null' ? ` ${s.url}` : ''}`);
    last = now;
    if (s.status === 'completed') return s;
    await sleep(30_000);
  }
  return { status: 'timeout' };
}

async function main() {
  sh('git', ['fetch', '--quiet', 'origin', 'main']);
  tryGit('fetch', '--quiet', 'origin', 'release');
  const sha = sh('git', ['rev-parse', '--verify', `${opt('--sha') || 'origin/main'}^{commit}`]);
  const short = sha.slice(0, 7);
  const release = tryGit('rev-parse', '--verify', '--quiet', 'origin/release');

  const problem = !isAncestor(sha, 'origin/main')
    ? `${short} は origin/main の履歴にありません。hotfix も main で直してから昇格させます。`
    : release && !isAncestor(release, sha)
      ? `release(${release.slice(0, 7)}) から ${short} へ fast-forward できません。`
      : undefined;
  if (problem && flag('--plan')) die(problem);
  const pending = release
    ? sh('git', ['log', '--oneline', `${release}..${sha}`])
    : sh('git', ['log', '--oneline', '-20', sha]);
  if (release === sha) log(`release は既に ${short} です。昇格は不要です。`);
  else
    log(
      `昇格候補 ${short}（release ${release ? release.slice(0, 7) : '(なし)'} から）:\n${pending}`,
    );
  if (flag('--plan')) {
    const t = trainAt(now);
    log(t ? `いまは${t.label}の窓です。` : `いまは定時便の窓の外です（次は${nextTrain(now)}）。`);
    return;
  }

  // 便の窓の外は、理由つきの臨時便だけ
  if (!rec.train && hotfix === undefined) {
    console.error(
      `[release] 中止: いまは定時便（08:00 / 20:00 JST、発車から 2 時間）の窓の外です。次は${nextTrain(now)}。` +
        '緊急の修正なら --hotfix "<理由>" を付けて臨時便にしてください。',
    );
    process.exit(5);
  }
  if (hotfix === '')
    die('--hotfix には理由を書いてください（例: --hotfix "#210 ログインできない"）。', 5);
  if (opt('--skip') === '') die('--skip には見送る理由を書いてください。', 5);
  recording = true;
  if (problem) die(problem);
  Object.assign(rec, { sha, short, from: release || undefined, tag: tagFor(sha) });
  if (release !== sha) {
    const list = pending ? pending.split('\n') : [];
    const migrations = release
      ? sh('git', ['diff', '--name-only', '--diff-filter=A', release, sha, '--', 'migrations/'])
          .split('\n')
          .filter(Boolean)
          .map((f) => f.replace(/^migrations\//, ''))
      : [];
    rec.commits = { total: list.length, list: list.slice(0, 50) };
    rec.migrations = migrations;
  }

  if (opt('--skip')) finish('skipped', opt('--skip'));
  const gate = gates(release === sha);
  if (gate) finish('skipped', gate);

  if (release !== sha) {
    let s = await verifyState(sha);
    rec.ci = { status: s.status, conclusion: s.conclusion, url: s.url, reused: true };
    if (!(s.status === 'completed' && s.conclusion === 'success')) {
      const rc = `rc/${short}`;
      log(`full CI を ${rc} で走らせます`);
      sh('git', ['push', '--quiet', 'origin', `${sha}:refs/heads/${rc}`]);
      try {
        s = await waitForCi(sha);
      } finally {
        // 待つ途中で落ちても rc を置き去りにしない
        tryGit('push', '--quiet', 'origin', '--delete', rc);
      }
      rec.ci = { status: s.status, conclusion: s.conclusion, url: s.url, reused: false };
      if (s.conclusion !== 'success')
        die(
          `CI が通りませんでした（${s.status}/${s.conclusion ?? '-'}${s.status === 'completed' ? `。${failedSteps(s.url)}` : ''}）。main で直してから再実行してください。${s.url ?? ''}`,
          1,
          'ci_failed',
        );
    } else log(`${short} は CI ${CHECK} 成功済みです`);
    const pushed = spawnSync('git', ['push', 'origin', `${sha}:refs/heads/release`], {
      encoding: 'utf8',
    });
    if (pushed.status !== 0)
      die(
        `release への push が拒否されました（CI は成功済み）。ruleset・fast-forward・同名の release/* ブランチを確認してください。\n${pushed.stderr}`,
        1,
        'promote_failed',
      );
    log(`release を ${short} へ昇格しました。タグと GitHub Release は release.yml が作ります。`);
  }

  if (flag('--deploy')) {
    await deploy(sha, release !== sha);
    rec.tag = rec.tag || (await waitForTag(sha));
    finish(release !== sha ? 'released' : 'redeployed');
  }
  log('本番 deploy はしていません（--deploy で実行）。');
  rec.tag = rec.tag || (await waitForTag(sha));
  finish(release !== sha ? 'promoted' : 'skipped', release !== sha ? undefined : '変更なし');
}

// 列車を止める条件のうち、機械で判定できるもの（R2 の独立検証・migration の形は agent が見て --skip で残す）
function gates(nothingToShip) {
  // 出すものが無い便は見送り。--sha で今の release を名指しした --deploy だけは「出し直し」として通す
  if (nothingToShip && !(flag('--deploy') && opt('--sha')))
    return '変更なし（release は main と同じ）';
  const q = (a) => {
    try {
      return sh('gh', a);
    } catch {
      return '';
    }
  };
  const [status, conclusion] = q([
    'run',
    'list',
    '-R',
    REPO,
    '--workflow',
    'main-health.yml',
    '--branch',
    'main',
    '-L',
    '1',
    '--json',
    'status,conclusion',
    '-q',
    '.[0] | "\\(.status) \\(.conclusion)"',
  ]).split(' ');
  if (status === 'completed' && conclusion === 'failure')
    return 'main-health が赤（mend が直してから）';
  const p0 = q([
    'issue',
    'list',
    '-R',
    REPO,
    '--label',
    'P0',
    '--state',
    'open',
    '--json',
    'number',
    '-q',
    'map(.number) | join(",")',
  ]);
  if (p0 && !hotfix) return `open な P0 Issue がある（#${p0.split(',').join(', #')}）`;
  const rcRunning = q([
    'run',
    'list',
    '-R',
    REPO,
    '--workflow',
    'ci.yml',
    '-L',
    '20',
    '--json',
    'status,headBranch',
    '-q',
    '[.[] | select(.status != "completed" and (.headBranch | startswith("rc/")))] | length',
  ]);
  if (rcRunning && rcRunning !== '0') return '別の列車の full CI が実行中';
  return undefined;
}

// release.yml が付けたタグ（rYYYY.MM.DD.N）。付くまで最長 3 分待つ
function tagFor(sha) {
  const out = tryGit('ls-remote', '--tags', 'origin', 'refs/tags/r*');
  return out
    .split('\n')
    .filter((l) => l.startsWith(sha))
    .map((l) => l.split('refs/tags/')[1])
    .sort()
    .pop();
}
async function waitForTag(sha) {
  for (let i = 0; i < 18; i++) {
    const t = tagFor(sha);
    if (t) return t;
    await sleep(10_000);
  }
  return undefined;
}

// CI の失敗した job/step の名前（記録の「理由」用。ログ本文は載せない）
function failedSteps(url) {
  const id = url?.match(/runs\/(\d+)/)?.[1];
  if (!id) return '失敗箇所は不明';
  try {
    const names = sh('gh', [
      'run',
      'view',
      id,
      '-R',
      REPO,
      '--json',
      'jobs',
      '-q',
      '[.jobs[] | . as $j | .steps[] | select(.conclusion == "failure") | "\\($j.name): \\(.name)"] | join(", ")',
    ]);
    return names ? `失敗: ${names}` : '失敗箇所は不明';
  } catch {
    return '失敗箇所は不明';
  }
}

// deploy-production.mjs の終了コード → 記録の結果
const DEPLOY_OUTCOME = { 2: 'smoke_failed', 3: 'config_missing', 4: 'd1_unreachable' };
function applyDeployResult(result, via, url) {
  rec.deploy = {
    via,
    url,
    result: result ? (result.code === 0 ? 'success' : `exit ${result.code}`) : 'unknown',
  };
  if (result?.smoke) rec.smoke = result.smoke;
  if (result?.bookmark) rec.bookmark = result.bookmark;
  if (result?.migrations?.length) rec.migrationsApplied = result.migrations;
  if (!result || result.code === 0) return;
  const outcome = /rollback が失敗/.test(result.message)
    ? 'rollback_failed'
    : (DEPLOY_OUTCOME[result.code] ?? 'deploy_failed');
  die(result.message, via === 'actions' ? 1 : result.code, outcome);
}

// 本番 deploy の担い手を決める。GitHub に CLOUDFLARE_API_TOKEN があれば GitHub Actions（release.yml の deploy job）、
// 無ければ手元の wrangler。どちらも scripts/deploy-production.mjs を実行する。
// token は environment `production`（release ブランチ限定）に置くのが正だが、repo の secret でも deploy job からは
// 同じ `secrets.CLOUDFLARE_API_TOKEN` で読めるので、両方を見る（2026-11-22 オーナーが repo 側に登録したため）。
function secretNames(path) {
  try {
    return sh('gh', ['api', path, '-q', '.secrets[].name']).split('\n');
  } catch {
    return [];
  }
}

function actionsDeployEnabled() {
  if (process.env.KSH_DEPLOY_VIA === 'local') return false;
  if (process.env.KSH_DEPLOY_VIA === 'actions') return true;
  return [`repos/${REPO}/environments/production/secrets`, `repos/${REPO}/actions/secrets`].some(
    (path) => secretNames(path).includes('CLOUDFLARE_API_TOKEN'),
  );
}

function releaseRun(sha) {
  try {
    const runs = JSON.parse(
      sh('gh', [
        'run',
        'list',
        '--repo',
        REPO,
        '--workflow',
        'release.yml',
        '--commit',
        sha,
        '--limit',
        '1',
        '--json',
        'databaseId,status,conclusion,url,createdAt',
      ]),
    );
    return runs[0];
  } catch {
    return undefined;
  }
}

async function deployViaActions(sha, promotedNow) {
  // release への push で release.yml が動く。push していない（既に release が sha）なら、手動で起こし直す。
  let run = releaseRun(sha);
  let since = 0;
  if (!promotedNow && run?.status !== 'in_progress' && run?.status !== 'queued') {
    // release は既にこの SHA。前回の run は token 追加前に deploy を飛ばしたか失敗したので、手動で起こし直す
    log('release は既にこの SHA です。release.yml を手動で起こして本番 deploy をやり直します。');
    since = Date.now() - 60_000;
    sh('gh', ['workflow', 'run', 'release.yml', '--repo', REPO, '--ref', 'release']);
    run = undefined;
  }
  // push / dispatch から run が見えるまで少し待つ（最長 10 分）
  for (let i = 0; i < 40 && (!run || Date.parse(run.createdAt) < since); i++) {
    await sleep(15_000);
    run = releaseRun(sha);
  }
  if (!run)
    die(
      'release.yml の run が見つかりません。gh run list --workflow release.yml で確かめてください。',
    );
  log(`GitHub Actions で本番 deploy 中: ${run.url}`);
  const watched = spawnSync(
    'gh',
    ['run', 'watch', String(run.databaseId), '--repo', REPO, '--exit-status', '--interval', '30'],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  const result = actionsDeployResult(run.databaseId);
  if (watched.status !== 0) {
    if (result) applyDeployResult(result, 'actions', run.url);
    rec.deploy = { via: 'actions', url: run.url, result: 'failure' };
    die(
      `release.yml が失敗しました。gh run view ${run.databaseId} --repo ${REPO} --log-failed で原因を確かめてください（deploy の終了コードの意味は scripts/deploy-production.mjs の先頭。rollback 済みとは限らない）。`,
      1,
      'deploy_failed',
    );
  }
  applyDeployResult(result ?? { code: 0, message: '' }, 'actions', run.url);
  const after = await smoke(process.env.KSH_PRODUCTION_ORIGIN || 'https://hub.junhat6.com');
  rec.smoke = { ok: after.ok, failures: after.failures };
  if (!after.ok)
    die(
      `Actions は成功しましたが本番 smoke が失敗しています: ${after.failures.join(', ')}`,
      2,
      'deploy_failed',
    );
  log(`本番 deploy 成功（GitHub Actions）: ${run.url}`);
}

// Actions のログから deploy-production.mjs の結果行を読む
function actionsDeployResult(id) {
  try {
    const out = sh('gh', ['run', 'view', String(id), '--repo', REPO, '--log'], {
      maxBuffer: 64 * 1024 * 1024,
    });
    const line = out
      .split('\n')
      .map((l) => l.match(/\[deploy\] result (\{.*\})\s*$/)?.[1])
      .filter(Boolean)
      .pop();
    return line ? JSON.parse(line) : undefined;
  } catch {
    return undefined;
  }
}

function deployLocally(sha) {
  const dir = mkdtempSync(join(tmpdir(), `ksh-release-${sha.slice(0, 7)}-`));
  try {
    sh('git', ['worktree', 'add', '--detach', dir, sha], { stdio: 'inherit' });
    const inDir = { cwd: dir, stdio: 'inherit', env: { ...process.env, HUSKY: '0' } };
    const resultFile = join(dir, '.ksh-deploy-result.json');
    sh('npm', ['ci'], inDir);
    sh('npm', ['run', 'build'], inDir);
    // 手順は今の main の deploy-production.mjs を使う（古い SHA にはまだ無いことがあるため）
    const r = spawnSync(
      process.execPath,
      [
        resolve('scripts/deploy-production.mjs'),
        '--root',
        dir,
        '--sha',
        sha,
        ...(flag('--skip-migrations') ? ['--skip-migrations'] : []),
      ],
      { stdio: 'inherit', env: { ...process.env, KSH_DEPLOY_RESULT: resultFile } },
    );
    let result;
    try {
      result = JSON.parse(readFileSync(resultFile, 'utf8'));
    } catch {
      result =
        r.status === 0
          ? undefined
          : { code: r.status ?? 1, message: 'deploy が結果を残さずに終わりました' };
    }
    return result;
  } finally {
    tryGit('worktree', 'remove', '--force', dir);
    rmSync(dir, { recursive: true, force: true });
  }
}

async function deploy(sha, promotedNow) {
  if (actionsDeployEnabled()) return deployViaActions(sha, promotedNow);
  log('CI 用 token が無いので、手元の wrangler で本番 deploy します。');
  let result;
  try {
    result = deployLocally(sha);
  } catch (e) {
    die(`手元での build か deploy の準備に失敗しました: ${e.message}`, 1, 'deploy_failed');
  }
  applyDeployResult(result, 'local');
}

try {
  await main();
} catch (e) {
  // どの例外でも、列車が走っていたなら（--plan でなく、便の窓か臨時便なら）記録を 1 件残してから終える
  if (!flag('--plan') && (rec.train || hotfix)) recording = true;
  die(e.message ?? String(e), 1, e instanceof GitHubUnreachable ? 'github_unreachable' : 'error');
}
