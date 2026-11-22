#!/usr/bin/env node
// Orca automation の precheck。exit 0 のときだけ agent を起こす（無駄な起動と課金を避けるため）。
// ループ名は docs/loop/LOOPS.md に揃える。
//   release … 常に起こす（定時便は見送りも含めて必ず記録する。止める条件は scripts/release.mjs が判定する）
//   mend    … main の最新 main-health が失敗している（アンドン：最優先で直す）
//   patrol  … 前回巡回の SHA 以降に src / worker / public の変更がある、または前回巡回の後に release が出た
//   polish  … main-health が赤でなく、open な P0 が無く、polish-log の最新コメントから 2 時間以上たっている
//   garden  … garden-log の前回 SHA 以降に main への commit がある
//   finish  … 未 claim の P0/P1（loop:finish / loop:ux）があり、claim 中の builder が上限未満
//   replan  … 前回 replan 以降に Issue か completion.json が変わった、待ち行列が空、blocked が 3 件以上
//   editor  … 材料の inbox に未処理のファイルがある、または editor-log の最新コメントから 20 時間以上たっている
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

if (mode === 'editor') {
  // 材料が届いていれば下書きにする。届いていなくても1日1回はレビューを読んで好みを更新する。
  const { readdirSync } = await import('node:fs');
  const { homedir } = await import('node:os');
  let pending = 0;
  try {
    pending = readdirSync(`${homedir()}/.config/kobe-student-hub/materials/inbox`).filter((n) =>
      n.endsWith('.md'),
    ).length;
  } catch {}
  if (pending > 0) process.exit(0);
  const last = gh(
    'issue',
    'list',
    '-R',
    REPO,
    '--label',
    'editor-log',
    '--state',
    'all',
    '-L',
    '1',
    '--json',
    'updatedAt',
    '-q',
    '.[0].updatedAt',
  );
  if (!last || Date.now() - Date.parse(last) > 20 * 3_600_000) process.exit(0);
  skip('材料なし・editor log は 20 時間以内');
}

if (mode === 'release') {
  // 定時便（08:00 / 20:00 JST）は必ず起こす。止める条件（変更なし・main-health 赤・open な P0・
  // rc の CI 実行中）は scripts/release.mjs が判定し、「見送り」として release-log に記録する。
  // ここで skip すると agent が起きず、その便の記録が残らないため（オーナー方針 2026-11-22）。
  process.exit(0);
}

if (mode === 'mend') {
  const [status, conclusion] = health();
  process.exit(status === 'completed' && conclusion === 'failure' ? 0 : 1);
}

// label の付いたログ Issue の最新コメントから、記録された 40 桁 SHA と時刻を取る
function lastLog(label) {
  const n = gh(
    'issue',
    'list',
    '-R',
    REPO,
    '--label',
    label,
    '--state',
    'all',
    '-L',
    '1',
    '--json',
    'number',
    '-q',
    '.[0].number',
  );
  if (!n) return {};
  const c = gh(
    'issue',
    'view',
    n,
    '-R',
    REPO,
    '--json',
    'comments',
    '-q',
    '.comments[-1] | "\\(.createdAt) \\(.body)"',
  );
  return { sha: c.match(/\b[0-9a-f]{40}\b/)?.[0], at: c.split(' ')[0] };
}
const compareCount = (sha, filter) =>
  gh('api', `repos/${REPO}/compare/${sha}...main`, '-q', filter);

if (mode === 'patrol') {
  // 前回巡回の SHA 以降に利用者に見える変更がある、または前回巡回の後に release が出た
  const { sha, at } = lastLog('patrol-log');
  if (!sha) process.exit(0); // 記録がまだ無ければ巡回する
  const changed = compareCount(
    sha,
    '[.files[]?.filename | select(test("^(src|worker|public)/"))] | length',
  );
  if (changed && changed !== '0') process.exit(0);
  const relAt = gh(
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
  if (relAt && at && relAt > at) process.exit(0); // release 後の本番巡回
  skip('前回巡回以降、利用者に見える変更もリリースも無い');
}

if (mode === 'polish') {
  // UI/UX 改善係。壊れた main や止まった列車の上には積まない。続けて起きすぎないように間を空ける
  const [status, conclusion] = health();
  if (status === 'completed' && conclusion === 'failure') skip('main-health が赤。先に mend');
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
  if (p0 && p0 !== '0') skip(`open な P0 Issue が ${p0} 件`);
  const { at } = lastLog('polish-log');
  if (at && Date.now() - Date.parse(at) < 2 * 60 * 60 * 1000)
    skip('前回の polish から 2 時間たっていない');
  process.exit(0);
}

if (mode === 'garden') {
  const { sha } = lastLog('garden-log');
  if (!sha) process.exit(0);
  const ahead = compareCount(sha, '.ahead_by');
  if (ahead && ahead !== '0') process.exit(0);
  skip('前回の手入れ以降、main に commit が無い');
}

const MAX_BUILDERS = Number(process.env.KSH_MAX_BUILDERS || 3);
const openIssues = (q) =>
  JSON.parse(
    gh(
      'issue',
      'list',
      '-R',
      REPO,
      '--state',
      'open',
      '-L',
      '200',
      '--json',
      'number,labels',
      ...q,
    ) || '[]',
  ).map((i) => ({ n: i.number, labels: i.labels.map((l) => l.name) }));

if (mode === 'finish') {
  // 未 claim の P0/P1 で loop:finish か loop:ux が 1 件以上あり、claim 中の builder が上限未満
  const all = openIssues([]);
  const claimed = all.filter((i) => i.labels.includes('claimed')).length;
  if (claimed >= MAX_BUILDERS) skip(`builder が上限（${claimed}/${MAX_BUILDERS}）`);
  const ready = all.filter(
    (i) =>
      !i.labels.includes('claimed') &&
      !i.labels.includes('blocked') &&
      (i.labels.includes('P0') || i.labels.includes('P1')) &&
      (i.labels.includes('loop:finish') || i.labels.includes('loop:ux')),
  );
  if (!ready.length) skip('着手できる P0/P1 の Issue が無い');
  process.exit(0);
}

if (mode === 'replan') {
  // 前回 replan（trailer "Loop: replan" の commit）以降に Issue か completion.json が変わった、
  // または finish の待ち行列が空、または blocked が 3 件以上
  const last = sh('git', [
    'log',
    'origin/main',
    '-1',
    '--format=%H %cI',
    '--grep=^Loop: replan',
  ]).split(' ');
  if (!last[0]) process.exit(0);
  const [sha, at] = last;
  if (sh('git', ['diff', '--name-only', `${sha}..origin/main`, '--', 'docs/loop/completion.json']))
    process.exit(0);
  const updated = gh(
    'issue',
    'list',
    '-R',
    REPO,
    '--state',
    'all',
    '--search',
    `updated:>${at}`,
    '-L',
    '1',
    '--json',
    'number',
    '-q',
    'length',
  );
  if (updated && updated !== '0') process.exit(0);
  const all = openIssues([]);
  if (all.filter((i) => i.labels.includes('blocked')).length >= 3) process.exit(0);
  const queue = all.filter(
    (i) =>
      !i.labels.includes('claimed') &&
      (i.labels.includes('loop:finish') || i.labels.includes('loop:ux')),
  );
  if (!queue.length) process.exit(0);
  skip('前回 replan 以降に変化が無い');
}

console.error('usage: precheck.mjs release|mend|patrol|polish|garden|finish|replan');
process.exit(2);
