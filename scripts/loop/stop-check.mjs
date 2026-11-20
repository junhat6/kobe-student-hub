#!/usr/bin/env node
// Stop hook: ターンを終える前に「手元にだけ残った成果」がないかを 1 度だけ確認する。
// ループでは push されていない commit は他のセッションにも release にも届かず、無かったのと同じになる。
// 止めるのは 1 回だけ（stop_hook_active なら素通り）。理由を書いて終えることも許す。
import { execFileSync } from 'node:child_process';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
let input = {};
try {
  input = JSON.parse(raw || '{}');
} catch {}
if (input.stop_hook_active || process.env.KSH_LOOP_STOP_CHECK === 'off') process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const git = (...args) => {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
};

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const upstream = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}');
// 追跡先がない作業ブランチは main と比べる（main へ入っていない commit を数える）
const base = upstream || 'origin/main';
const unpushed = Number(git('rev-list', '--count', `${base}..HEAD`) || 0);
const dirty = git('status', '--porcelain', '--untracked-files=no');

const problems = [];
if (unpushed > 0)
  problems.push(`${branch} に ${base} へ届いていない commit が ${unpushed} 件あります`);
if (dirty) problems.push('commit されていない変更があります');
if (!problems.length) process.exit(0);

process.stdout.write(
  JSON.stringify({
    decision: 'block',
    reason: `[loop-stop-check] ${problems.join('。')}。作業の区切りなら git pull --rebase origin main → git push origin HEAD:main で main に届けてください。意図的に残す場合（作業途中・他ブランチで並行など）は、その理由を一言書いて終えて構いません。`,
  }),
);
