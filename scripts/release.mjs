#!/usr/bin/env node
// npm run release -- [--sha <sha>] [--deploy] [--plan]
//
// main の 1 つの SHA を「列車」に乗せて release へ昇格させる、唯一の入口。
//   1. SHA が main の履歴にあり、release から fast-forward できることを確かめる
//   2. その SHA に CI(verify) の成功が無ければ rc/<sha7> へ push して full CI を走らせ、結果を待つ
//   3. green なら release へ fast-forward push（ruleset が verify の成功を再確認する）
//      → release.yml がタグと GitHub Release を作る
//   4. --deploy なら、その SHA を隔離した worktree で build して本番へ deploy し、smoke が落ちたら直前版へ rollback
//
// CI は PR や main では必須にせず、ここでだけ必須にする。main を速く回し、本番に入るものだけを厳しく見るため。
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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

  if (flag('--deploy')) await deploy(sha);
  else log('本番 deploy はしていません（--deploy で実行）。');
}

async function deploy(sha) {
  const config = process.env.KSH_PRODUCTION_CONFIG && resolve(process.env.KSH_PRODUCTION_CONFIG);
  const origin = process.env.KSH_PRODUCTION_ORIGIN || 'https://hub.junhat6.com';
  if (!config || !existsSync(config))
    die(
      'KSH_PRODUCTION_CONFIG（非公開の本番 wrangler 設定）がありません。昇格までは完了しています。設定の用意は docs/RELEASE.md「本番 deploy の前提」を参照。',
      3,
    );

  const before = await smoke(origin);
  if (!before.ok) log(`deploy 前の本番 smoke が既に失敗しています: ${before.failures.join(', ')}`);

  const dir = mkdtempSync(join(tmpdir(), `ksh-release-${sha.slice(0, 7)}-`));
  try {
    sh('git', ['worktree', 'add', '--detach', dir, sha], { stdio: 'inherit' });
    const inDir = { cwd: dir, stdio: 'inherit', env: { ...process.env, HUSKY: '0' } };
    sh('npm', ['ci'], inDir);
    sh('npm', ['run', 'build'], inDir);
    sh(
      'npx',
      ['wrangler', 'deploy', '--config', config, '--message', `release ${sha.slice(0, 7)}`],
      inDir,
    );
    log('deploy 完了。smoke を実行します。');
    await sleep(5_000);
    const after = await smoke(origin);
    if (after.ok) {
      log(`本番 smoke 成功: ${origin}`);
      tryGit('fetch', '--tags', '--quiet', 'origin');
      return;
    }
    log(`本番 smoke 失敗: ${after.failures.join(', ')}。直前の版へ rollback します。`);
    sh(
      'npx',
      [
        'wrangler',
        'rollback',
        '--config',
        config,
        '--message',
        `smoke failed for ${sha.slice(0, 7)}`,
        '--yes',
      ],
      inDir,
    );
    const back = await smoke(origin);
    die(
      `rollback しました（rollback 後の smoke: ${back.ok ? '成功' : back.failures.join(', ')}）。release ブランチは ${sha.slice(0, 7)} のままなので、main で直して次の列車に乗せてください。`,
      2,
    );
  } finally {
    tryGit('worktree', 'remove', '--force', dir);
    rmSync(dir, { recursive: true, force: true });
  }
}

await main();
