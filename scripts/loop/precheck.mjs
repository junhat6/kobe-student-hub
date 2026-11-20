#!/usr/bin/env node
// Orca automation の precheck。exit 0 のときだけ agent を起こす（無駄な起動と課金を避けるため）。
//   node scripts/loop/precheck.mjs release  … main に未リリースの commit があり、main-health が赤でない
//   node scripts/loop/precheck.mjs patrol   … main の最新 main-health が失敗している
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
const head = (ref) => sh('gh', ['api', `repos/${REPO}/commits/${ref}`, '-q', '.sha']);
const health = () =>
  sh('gh', [
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
    'conclusion,status,headSha',
    '-q',
    '.[0] | "\\(.status) \\(.conclusion) \\(.headSha)"',
  ]).split(' ');

const mode = process.argv[2];
if (mode === 'release') {
  const main = head('main');
  if (!main) process.exit(1);
  const release = head('release');
  if (release === main) {
    console.log('release は main と同じ。昇格不要');
    process.exit(1);
  }
  const [status, conclusion] = health();
  if (status === 'completed' && conclusion === 'failure') {
    console.log('main-health が赤。先に patrol が直す');
    process.exit(1);
  }
  const running = sh('gh', [
    'run',
    'list',
    '-R',
    REPO,
    '--workflow',
    'ci.yml',
    '--status',
    'in_progress',
    '-L',
    '1',
    '--json',
    'databaseId',
    '-q',
    'length',
  ]);
  if (running && running !== '0') {
    console.log('リリース CI が実行中');
    process.exit(1);
  }
  process.exit(0);
}
if (mode === 'patrol') {
  const [status, conclusion] = health();
  process.exit(status === 'completed' && conclusion === 'failure' ? 0 : 1);
}
console.error('usage: precheck.mjs release|patrol');
process.exit(2);
