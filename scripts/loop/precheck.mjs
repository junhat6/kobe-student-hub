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
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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

// テストは releaseWake を import して使う。そのときは mode の判定を走らせない
const direct = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
const mode = direct ? process.argv[2] : undefined;

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
  // ksh release は毎時起きる（0 * * * *）。起こすのは次の2つだけ。
  //  1. 直近の定時便（08:00 / 20:00 JST）の窓の中で、その便の記録がまだ無い → 発車（Mac が眠っていて
  //     遅れて起きたときも含む）。止める条件は scripts/release.mjs が判定し、見送りとして記録する。
  //     ここで skip すると agent が起きず、その便の記録が残らないため（オーナー方針 2026-11-22）。
  //  2. 直近の便が出しきれていない（最後の記録が失敗か、待てば出せる見送り）のに、最後の記録から
  //     RELEASE_FOLLOWUP_MIN 分たっても誰も続きを走らせていない → 続きの agent を起こす。
  //     便は始めたら本番に出るまで回す（オーナー方針 2026-11-24）。前の agent が途中で止まっても、
  //     次の便を待たずに拾い直すため。
  // どちらでも、rc の full CI か release.yml が動いている間は、誰かが列車を回しているので起こさない。
  // 判定は scripts/loop/release-log.mjs の trainAt / lastDeparted / openTrain と同じ（この precheck は
  // 1ファイルだけ書き出して実行されるので import できない。tests/release-log.test.ts が両者を突き合わせる）。
  const FOLLOWUP_MIN = Number(process.env.KSH_RELEASE_FOLLOWUP_MIN || 90);
  const now = process.env.KSH_RELEASE_NOW ? new Date(process.env.KSH_RELEASE_NOW) : new Date();
  const verdict = releaseWake(now, {
    records: releaseRecords(),
    busy: releaseBusy(),
    followupMin: FOLLOWUP_MIN,
  });
  if (verdict.wake) {
    console.log(`release: ${verdict.why}`);
    process.exit(0);
  }
  skip(verdict.why);
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

if (direct) {
  console.error('usage: precheck.mjs release|mend|patrol|polish|garden|finish|replan|editor');
  process.exit(2);
}

// ---- release（定時便と、出しきれていない便の続き）----

export function releaseSlot(date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  const day = `${p.year}-${p.month}-${p.day}`;
  const minutes = Number(p.hour) * 60 + Number(p.minute);
  if (minutes >= 20 * 60) return { slot: `${day} evening`, elapsed: minutes - 20 * 60 };
  if (minutes >= 8 * 60) return { slot: `${day} morning`, elapsed: minutes - 8 * 60 };
  const y = new Date(date.getTime() - 86_400_000);
  const yp = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(y);
  return { slot: `${yp} evening`, elapsed: minutes + 4 * 60 };
}

export function releaseWake(now, { records, busy, followupMin }) {
  // release-log.mjs の OUTCOMES の ok と RETRYABLE_BLOCKERS（この関数は mode の判定より前に呼ばれるので中に置く）
  const RELEASE_OK = ['released', 'promoted', 'redeployed', 'skipped'];
  const RELEASE_RETRYABLE = ['main_health', 'rc_running'];
  const { slot, elapsed } = releaseSlot(now);
  if (busy) return { wake: false, why: `列車が動いている（${busy}）` };
  const mine = records
    .filter((r) => r.train?.slot === slot)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const last = mine.at(-1);
  if (!last)
    return elapsed < 120
      ? { wake: true, why: `${slot} の発車` }
      : { wake: false, why: `${slot} の窓は過ぎ、記録も無い（次の便を待つ）` };
  const open =
    !RELEASE_OK.includes(last.outcome) ||
    (last.outcome === 'skipped' && RELEASE_RETRYABLE.includes(last.blocker));
  if (!open) return { wake: false, why: `${slot} は ${last.outcome} で終わっている` };
  const since = (now.getTime() - Date.parse(last.finishedAt ?? last.startedAt)) / 60_000;
  if (since < followupMin)
    return {
      wake: false,
      why: `${slot} は ${last.outcome}。続きは前の agent に任せる（${Math.floor(since)} 分前）`,
    };
  return { wake: true, why: `${slot} の続き（${last.outcome} から ${Math.floor(since)} 分）` };
}

function releaseRecords() {
  const n = gh(
    'issue',
    'list',
    '-R',
    REPO,
    '--label',
    'release-log',
    '--state',
    'all',
    '-L',
    '1',
    '--json',
    'number',
    '-q',
    '.[0].number // empty',
  );
  if (!n) return [];
  const since = new Date(Date.now() - 36 * 3_600_000).toISOString();
  const out = gh(
    'api',
    '--paginate',
    `repos/${REPO}/issues/${n}/comments?per_page=100&since=${since}`,
    '-q',
    '.[].body | @json',
  );
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        const m = JSON.parse(line).match(/```json\n(\{.*\})\n```/);
        return m ? JSON.parse(m[1]) : undefined;
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);
}

// rc の full CI か release.yml（昇格後の deploy）が動いていれば、その説明を返す
function releaseBusy() {
  const rc = gh(
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
  if (rc && rc !== '0') return 'rc の full CI が実行中';
  const rel = gh(
    'run',
    'list',
    '-R',
    REPO,
    '--workflow',
    'release.yml',
    '-L',
    '5',
    '--json',
    'status',
    '-q',
    '[.[] | select(.status != "completed")] | length',
  );
  if (rel && rel !== '0') return 'release.yml が実行中';
  return '';
}
