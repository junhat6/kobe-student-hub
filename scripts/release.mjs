#!/usr/bin/env node
// npm run release -- [--sha <sha>] [--deploy] [--plan]
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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { smoke } from './loop/smoke.mjs';

const REPO = process.env.KSH_REPO || 'junhat6/kobe-student-hub';
const CHECK = 'verify';
const CI_TIMEOUT_MIN = Number(process.env.KSH_RELEASE_CI_TIMEOUT_MIN || 60);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
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
const die = (m, code = 1) => {
  console.error(`[release] 中止: ${m}`);
  process.exit(code);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function verifyState(sha) {
  // CI workflow の verify job の、その SHA に対する最新結果
  const out = sh('gh', [
    'api',
    `repos/${REPO}/commits/${sha}/check-runs?check_name=${CHECK}&per_page=20`,
    '-q',
    '.check_runs | sort_by(.started_at) | last | "\\(.status) \\(.conclusion) \\(.html_url)"',
  ]);
  if (!out || out === 'null null null') return { status: 'none' };
  const [status, conclusion, url] = out.split(' ');
  return { status, conclusion, url };
}

async function waitForCi(sha) {
  const deadline = Date.now() + CI_TIMEOUT_MIN * 60_000;
  let last = '';
  while (Date.now() < deadline) {
    const s = verifyState(sha);
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

  if (!isAncestor(sha, 'origin/main'))
    die(`${short} は origin/main の履歴にありません。hotfix も main で直してから昇格させます。`);
  if (release && !isAncestor(release, sha))
    die(`release(${release.slice(0, 7)}) から ${short} へ fast-forward できません。`);
  const pending = release
    ? sh('git', ['log', '--oneline', `${release}..${sha}`])
    : sh('git', ['log', '--oneline', '-20', sha]);
  if (release === sha) log(`release は既に ${short} です。昇格は不要です。`);
  else
    log(
      `昇格候補 ${short}（release ${release ? release.slice(0, 7) : '(なし)'} から）:\n${pending}`,
    );
  if (flag('--plan')) return;

  if (release !== sha) {
    let s = verifyState(sha);
    if (!(s.status === 'completed' && s.conclusion === 'success')) {
      const rc = `rc/${short}`;
      log(`full CI を ${rc} で走らせます`);
      sh('git', ['push', '--quiet', 'origin', `${sha}:refs/heads/${rc}`]);
      s = await waitForCi(sha);
      tryGit('push', '--quiet', 'origin', '--delete', rc);
      if (s.conclusion !== 'success')
        die(
          `CI が通りませんでした（${s.status}/${s.conclusion ?? '-'}）。main で直してから再実行してください。${s.url ?? ''}`,
        );
    } else log(`${short} は CI ${CHECK} 成功済みです`);
    const pushed = spawnSync('git', ['push', 'origin', `${sha}:refs/heads/release`], {
      encoding: 'utf8',
    });
    if (pushed.status !== 0)
      die(
        `release への push が拒否されました（CI は成功済み）。ruleset・fast-forward・同名の release/* ブランチを確認してください。\n${pushed.stderr}`,
      );
    log(`release を ${short} へ昇格しました。タグと GitHub Release は release.yml が作ります。`);
  }

  if (flag('--deploy')) await deploy(sha, release !== sha);
  else log('本番 deploy はしていません（--deploy で実行）。');
}

// 本番 deploy の担い手を決める。GitHub の environment `production` に CLOUDFLARE_API_TOKEN があれば
// GitHub Actions（release.yml の deploy job）、無ければ手元の wrangler。どちらも scripts/deploy-production.mjs を実行する。
function actionsDeployEnabled() {
  if (process.env.KSH_DEPLOY_VIA === 'local') return false;
  if (process.env.KSH_DEPLOY_VIA === 'actions') return true;
  try {
    const names = sh('gh', [
      'api',
      `repos/${REPO}/environments/production/secrets`,
      '-q',
      '.secrets[].name',
    ]);
    return names.split('\n').includes('CLOUDFLARE_API_TOKEN');
  } catch {
    return false;
  }
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
  if (watched.status !== 0)
    die(
      `release.yml が失敗しました。gh run view ${run.databaseId} --repo ${REPO} --log-failed で原因を確かめてください（deploy の終了コードの意味は scripts/deploy-production.mjs の先頭）。`,
      2,
    );
  const after = await smoke(process.env.KSH_PRODUCTION_ORIGIN || 'https://hub.junhat6.com');
  if (!after.ok)
    die(`Actions は成功しましたが本番 smoke が失敗しています: ${after.failures.join(', ')}`, 2);
  log(`本番 deploy 成功（GitHub Actions）: ${run.url}`);
}

function deployLocally(sha) {
  const dir = mkdtempSync(join(tmpdir(), `ksh-release-${sha.slice(0, 7)}-`));
  try {
    sh('git', ['worktree', 'add', '--detach', dir, sha], { stdio: 'inherit' });
    const inDir = { cwd: dir, stdio: 'inherit', env: { ...process.env, HUSKY: '0' } };
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
      { stdio: 'inherit' },
    );
    if (r.status !== 0) process.exitCode = r.status ?? 1;
  } finally {
    tryGit('worktree', 'remove', '--force', dir);
    rmSync(dir, { recursive: true, force: true });
  }
}

async function deploy(sha, promotedNow) {
  if (actionsDeployEnabled()) return deployViaActions(sha, promotedNow);
  log('CI 用 token が無いので、手元の wrangler で本番 deploy します。');
  deployLocally(sha);
}

await main();
