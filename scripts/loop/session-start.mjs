#!/usr/bin/env node
// SessionStart hook: 新しいセッションの最初に「ループの現在地」を agent の文脈へ入れる。
// 目的は、各セッションが同じ前提（どの SHA がリリース済みか・main は健康か・誰が何をしているか）から
// 始めること。ネットワークが無くても落ちないよう、各項目は失敗したら黙って省く。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const run = (cmd, args, timeout = 8000) => {
  try {
    return execFileSync(cmd, args, {
      cwd: root,
      encoding: 'utf8',
      timeout,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
};

const lines = ['# kobe-student-hub ループの現在地（SessionStart hook）'];
run('git', ['fetch', '--quiet', 'origin', 'main', 'release'], 15000);

const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
const behind = run('git', ['rev-list', '--count', 'HEAD..origin/main']);
const ahead = run('git', ['rev-list', '--count', 'origin/main..HEAD']);
lines.push(
  `- このworktree: ${branch}（origin/main より ${ahead || '?'} 進み / ${behind || '?'} 遅れ）`,
);

const hasRelease = run('git', ['rev-parse', '--verify', '--quiet', 'origin/release']);
if (hasRelease) {
  const unreleased = run('git', ['rev-list', '--count', 'origin/release..origin/main']);
  const tag = run('git', ['describe', '--tags', '--abbrev=0', 'origin/release']);
  lines.push(
    `- release: ${hasRelease.slice(0, 7)}${tag ? ` (${tag})` : ''}。main の未リリース commit: ${unreleased}`,
  );
} else {
  lines.push('- release ブランチはまだありません（最初の npm run release で作られます）');
}

const smoke = run('gh', [
  'run',
  'list',
  '--workflow',
  'main-health.yml',
  '--branch',
  'main',
  '-L',
  '1',
  '--json',
  'conclusion,headSha,status',
  '-q',
  '.[0] | "\\(.status) \\(.conclusion) \\(.headSha[0:7])"',
]);
if (smoke)
  lines.push(
    `- main の健康チェック（main-health）: ${smoke}${/failure/.test(smoke) ? ' ← 赤。直すのが最優先（patrol）' : ''}`,
  );

const worktrees = run('git', ['worktree', 'list', '--porcelain']);
if (worktrees) {
  const names = [...worktrees.matchAll(/^branch refs\/heads\/(.+)$/gm)].map((m) => m[1]);
  lines.push(`- 並行中の worktree: ${names.join(', ')}`);
}

const work = join(root, 'docs/WORK.md');
if (existsSync(work)) {
  const now = readFileSync(work, 'utf8')
    .split('\n')
    .filter((l) => /^- (現在地|次)/.test(l))
    .slice(0, 3);
  if (now.length) lines.push('- docs/WORK.md:', ...now.map((l) => `  ${l}`));
}

lines.push(
  '- 運用: main へ直接 commit / push（pull --rebase、force 禁止）。PR は任意で CI 不要。本番への昇格は npm run release のみ（docs/RELEASE.md）。',
);
if (existsSync(join(root, 'docs/loop/README.md'))) lines.push('- ループ設計: docs/loop/README.md');
process.stdout.write(lines.join('\n') + '\n');
