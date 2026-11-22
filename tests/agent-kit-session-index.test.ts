import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// C21: the writing kit reads the student's own agent history locally, never sends it to the
// site, and masks secrets, emails and user-name paths in what it prints. Only fictional history
// in a throwaway HOME is used here; a real history must never be read by tests.
const SCRIPT = join(process.cwd(), 'public/agent-kit/ksh-article/scripts/session_index.py');

const FAKE_KEY = 'sk-' + 'fictionalFICTIONAL0123456789';
const FAKE_GH = 'ghp_' + 'Fictional0123456789abcdefXYZ';
const FAKE_EMAIL = 'fictional.student@st.example.ac.jp';

let home: string;
let sessionPath: string;

function run(...args: string[]) {
  return execFileSync('python3', ['-I', SCRIPT, ...args], {
    env: { PATH: process.env.PATH ?? '', HOME: home, PYTHONIOENCODING: 'utf-8' },
    encoding: 'utf-8',
  });
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'ksh-kit-'));
  const dir = join(home, '.claude', 'projects', '-Users-fictional-docker-notes');
  mkdirSync(dir, { recursive: true });
  sessionPath = join(dir, 'fictional-session.jsonl');
  const lines = [
    {
      type: 'user',
      timestamp: '2026-11-01T10:00:00Z',
      cwd: '/Users/fictionaluser/docker-notes',
      message: {
        content: `docker の compose で詰まった。token=${FAKE_KEY} を使って ${FAKE_EMAIL} に送る設定`,
      },
    },
    {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'text',
            text: `ログは /Users/fictionaluser/docker-notes/log.txt と ${home}/secret.txt にあります。${FAKE_GH}`,
          },
        ],
      },
    },
  ];
  writeFileSync(sessionPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
});

afterAll(() => rmSync(home, { recursive: true, force: true }));

describe('agent kit session_index.py', () => {
  it('lists and shows a fictional session with secrets, emails and user paths masked', () => {
    const index = run('index', '--grep', 'docker');
    expect(index).toContain('claude');
    expect(index).toContain('docker-notes');
    const shown = run('show', sessionPath);
    expect(shown).toContain('## あなた');
    expect(shown).toContain('## エージェント');
    expect(shown).toContain('[秘密を伏せました]');
    expect(shown).toContain('[メールを伏せました]');
    expect(shown).toContain('/Users/<you>/docker-notes/log.txt');
    expect(shown).toContain('~/secret.txt');
    for (const output of [index, shown]) {
      expect(output).not.toContain(FAKE_KEY);
      expect(output).not.toContain(FAKE_GH);
      expect(output).not.toContain(FAKE_EMAIL);
      expect(output).not.toContain('fictionaluser');
      expect(output).not.toContain(home);
    }
  });

  it('has no way to send history anywhere: only local standard-library modules', () => {
    const source = readFileSync(SCRIPT, 'utf-8');
    const imports = [...source.matchAll(/^(?:from\s+(\S+)\s+import|import\s+(\S+))/gm)].map(
      (m) => (m[1] ?? m[2]).split('.')[0],
    );
    expect(new Set(imports)).toEqual(
      new Set([
        '__future__',
        'argparse',
        'json',
        'os',
        're',
        'sys',
        'dataclasses',
        'datetime',
        'pathlib',
      ]),
    );
    expect(source).not.toMatch(/urllib|http\.client|\bsocket\b|subprocess|https?:\/\//);
  });
});
