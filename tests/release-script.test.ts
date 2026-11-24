// scripts/release.mjs を、偽の gh（PATH の先頭）と手元の bare repo（origin）で実際に走らせる。
// GitHub にも本番にも触れない。#212: gh が一時的に落ちても、列車は記録を 1 件残して終わること。
import { spawnSync, execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve('scripts/release.mjs');

// 引数を見て答える偽の gh。check-runs は FAIL_API 回だけ「繋がらない」で落ち、その後は API_ANSWER を返す。
const FAKE_GH = `#!/usr/bin/env node
const fs = require('node:fs');
const dir = process.env.FAKE_GH_DIR;
const a = process.argv.slice(2);
fs.appendFileSync(dir + '/calls.log', a.join(' ') + '\\n');
const out = (s) => { process.stdout.write(s + '\\n'); process.exit(0); };
if (a[0] === 'api' && a[1].includes('/check-runs')) {
  const f = dir + '/api-count';
  const n = Number(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : 0) + 1;
  fs.writeFileSync(f, String(n));
  if (n <= Number(process.env.FAKE_FAIL_API || 0)) {
    process.stderr.write('error connecting to api.github.com\\n');
    process.exit(1);
  }
  out(process.env.FAKE_API_ANSWER || 'null null null');
}
if (a[0] === 'api' && a.some((x) => x.includes('issues/211/comments'))) out(process.env.FAKE_LOG_COMMENTS || '');
if (a[0] === 'run' && a[1] === 'list' && a.includes('main-health.yml')) out('completed success');
if (a[0] === 'run' && a[1] === 'list' && a.includes('ci.yml')) out('0');
if (a[0] === 'run' && a[1] === 'view') out('verify: npm test');
if (a[0] === 'issue' && a[1] === 'list' && a.includes('release-log')) out('211');
if (a[0] === 'issue' && a[1] === 'list') out('');
if (a[0] === 'issue' && a[1] === 'comment') {
  fs.appendFileSync(dir + '/records.log', fs.readFileSync(0, 'utf8') + '\\n----\\n');
  out('https://example.test/issues/211#issuecomment-1');
}
process.stderr.write('fake gh: unexpected ' + a.join(' ') + '\\n');
process.exit(1);
`;

const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

let root: string;
let work: string;
let bin: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ksh-release-test-'));
  bin = join(root, 'bin');
  work = join(root, 'work');
  const origin = join(root, 'origin.git');
  execFileSync('mkdir', ['-p', bin, work]);
  writeFileSync(join(bin, 'gh'), FAKE_GH);
  chmodSync(join(bin, 'gh'), 0o755);
  execFileSync('git', ['init', '--quiet', '--bare', origin]);
  git(work, 'init', '--quiet', '-b', 'main');
  git(work, 'config', 'user.email', 'test@example.test');
  git(work, 'config', 'user.name', 'test');
  git(work, 'config', 'commit.gpgsign', 'false');
  git(work, 'remote', 'add', 'origin', origin);
  git(work, 'commit', '--quiet', '--allow-empty', '--no-verify', '-m', 'base');
  git(work, 'push', '--quiet', 'origin', 'HEAD:refs/heads/release');
  git(work, 'commit', '--quiet', '--allow-empty', '--no-verify', '-m', 'feat: next');
  git(work, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function release(env: Record<string, string>, args: string[] = []) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: work,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_GH_DIR: root,
      KSH_REPO: 'example/repo',
      KSH_RELEASE_NOW: '2026-11-22T08:30:00+09:00', // 朝便の窓
      KSH_RELEASE_GH_RETRIES: '3',
      KSH_RELEASE_GH_RETRY_MS: '10',
      GITHUB_ACTIONS: '',
      HUSKY: '0',
      ...env,
    },
  });
  const recordsFile = join(root, 'records.log');
  const records = existsSync(recordsFile)
    ? readFileSync(recordsFile, 'utf8').split('\n----\n').filter(Boolean)
    : [];
  const json = records.map((b) => JSON.parse(b.match(/```json\n(\{.*\})\n```/)![1]));
  const branches = git(work, 'ls-remote', '--heads', 'origin');
  return { ...r, records: json, branches };
}

describe('release.mjs when gh cannot reach GitHub (#212)', () => {
  it('records one github_unreachable run, exits non-zero and removes the rc branch', () => {
    const r = release({ FAKE_FAIL_API: '99' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).not.toMatch(/at .*release\.mjs:\d+/); // スタックトレースで落ちていない
    expect(r.records).toHaveLength(1);
    expect(r.records[0]).toMatchObject({ outcome: 'github_unreachable' });
    expect(r.records[0].reason).toMatch(/GitHub API に繋がりません.*3 回試行/);
    expect(r.branches).not.toMatch(/refs\/heads\/rc\//);
  });

  it('retries a transient failure and carries on to the CI result', () => {
    const r = release({
      FAKE_FAIL_API: '2',
      FAKE_API_ANSWER: 'completed failure https://example.test/actions/runs/42',
    });
    expect(r.stdout).toMatch(/gh が失敗しました（CI の結果の確認、1\/3）/);
    expect(r.status).toBe(1);
    expect(r.records).toHaveLength(1);
    expect(r.records[0]).toMatchObject({ outcome: 'ci_failed' });
    expect(r.records[0].reason).toMatch(/失敗: verify: npm test/);
  });
});

// release-log の既存コメント（gh api … -q '.[] | {body, url} | @json' の出力の形）
const logComment = (rec: object) =>
  JSON.stringify({
    body: `<!-- ksh-release-record v1 -->\n### x\n\n\`\`\`json\n${JSON.stringify(rec)}\n\`\`\``,
    url: 'https://example.test/issues/211#issuecomment-0',
  });
const evening = {
  id: 'evening',
  label: '夜便',
  hour: 20,
  day: '2026-11-24',
  slot: '2026-11-24 evening',
};

describe('release.mjs --continue（便は始めたら出しきる、2026-11-24）', () => {
  const late = { KSH_RELEASE_NOW: '2026-11-24T22:40:00+09:00' }; // 夜便の窓（〜21:59）の後

  it('runs a failed train again after its window and records it under the same train', () => {
    const r = release(
      {
        ...late,
        FAKE_LOG_COMMENTS: logComment({
          v: 1,
          startedAt: '2026-11-24T11:00:00.000Z',
          finishedAt: '2026-11-24T11:30:00.000Z',
          train: evening,
          outcome: 'ci_failed',
        }),
        FAKE_API_ANSWER: 'completed failure https://example.test/actions/runs/43',
      },
      ['--continue'],
    );
    expect(r.stdout).toMatch(/2026-11-24 の夜便の続きとして走らせます（前回: ci_failed）/);
    expect(r.records).toHaveLength(1);
    expect(r.records[0]).toMatchObject({
      outcome: 'ci_failed',
      continued: true,
      train: { slot: '2026-11-24 evening' },
    });
    expect(r.records[0].hotfix).toBeUndefined();
    expect(r.records[0].reason).toMatch(/--continue/);
  });

  it('refuses to continue a train that already shipped', () => {
    const r = release(
      {
        ...late,
        FAKE_LOG_COMMENTS: logComment({
          v: 1,
          startedAt: '2026-11-24T11:00:00.000Z',
          finishedAt: '2026-11-24T11:30:00.000Z',
          train: evening,
          outcome: 'released',
        }),
      },
      ['--continue'],
    );
    expect(r.status).toBe(5);
    expect(r.stderr).toMatch(/出しきれています/);
    expect(r.records).toHaveLength(0);
  });

  it('points at --continue when run outside the window without it', () => {
    const r = release(late);
    expect(r.status).toBe(5);
    expect(r.stderr).toMatch(/--continue/);
    expect(r.records).toHaveLength(0);
  });
});
