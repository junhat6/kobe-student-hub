#!/usr/bin/env node
// Orca automation の precheck。exit 0 のときだけ agent を起こす（無駄な起動と課金を避けるため）。
// ループ名は docs/loop/LOOPS.md に揃える。
//   release … main に未リリースの commit があり、main-health が赤でなく、open な P0 Issue が無く、リリース CI が実行中でない
//   mend    … main の最新 main-health が失敗している（アンドン：最優先で直す）
//   patrol  … 前回巡回の SHA 以降に src / worker / public の変更がある、または前回巡回の後に release タグが出た
import { execFileSync } from 'node:child_process';

const REPO = process.env.KSH_REPO || 'junhat6/kobe-student-hub';
const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30_000,
    }).trim();
  } catch {
    return '';
  }
};
const gh = (...args) => sh('gh', args);
const head = (ref) => gh('api', `repos/${REPO}/commits/${ref}`, '-q', '.sha');
const health = () =>
  gh(
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
    'conclusion,status',
    '-q',
    '.[0] | "\\(.status) \\(.conclusion)"',
  ).split(' ');
const skip = (why) => {
  console.log(`skip: ${why}`);
  process.exit(1);
};

const mode = process.argv[2];

if (mode === 'release') {
  const main = head('main');
  if (!main) skip('main を取得できない');
  if (head('release') === main) skip('release は main と同じ');
  const [status, conclusion] = health();
  if (status === 'completed' && conclusion === 'failure')
    skip('main-health が赤。先に mend が直す');
  const p0 = gh(
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
    'length',
  );
  if (p0 && p0 !== '0') skip(`open な P0 Issue が ${p0} 件。列車を止める`);
  const rcRunning = gh(
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
  );
  if (rcRunning && rcRunning !== '0') skip('リリース CI が実行中');
  process.exit(0);
}

if (mode === 'mend') {
  const [status, conclusion] = health();
  process.exit(status === 'completed' && conclusion === 'failure' ? 0 : 1);
}

if (mode === 'patrol') {
  // 前回巡回の記録：label patrol-log の Issue の最新コメントに書かれた 40 桁 SHA と、その時刻
  const last = gh(
    'issue',
    'list',
    '-R',
    REPO,
    '--label',
    'patrol-log',
    '--state',
    'all',
    '-L',
    '1',
    '--json',
    'number',
    '-q',
    '.[0].number',
  );
  if (!last) process.exit(0); // 記録がまだ無ければ巡回する
  const comment = gh(
    'api',
    `repos/${REPO}/issues/${last}/comments?per_page=100`,
    '-q',
    'last | "\\(.created_at) \\(.body)"',
  );
  const sha = comment.match(/\b[0-9a-f]{40}\b/)?.[0];
  const at = comment.split(' ')[0];
  if (!sha) process.exit(0);
  const changed = gh(
    'api',
    `repos/${REPO}/compare/${sha}...main`,
    '-q',
    '[.files[]?.filename | select(test("^(src|worker|public)/"))] | length',
  );
  if (changed && changed !== '0') process.exit(0);
  const tagAt = gh(
    'release',
    'list',
    '-R',
    REPO,
    '-L',
    '1',
    '--json',
    'createdAt',
    '-q',
    '.[0].createdAt',
  );
  if (tagAt && at && tagAt > at) process.exit(0); // release 後の本番巡回
  skip('前回巡回以降、利用者に見える変更もリリースも無い');
}

console.error('usage: precheck.mjs release|mend|patrol');
process.exit(2);
