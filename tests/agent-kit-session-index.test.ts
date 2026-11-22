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
// Claude Code turns every non-alphanumeric character of the path into "-".
const encoded = (path: string) => path.replace(/[^A-Za-z0-9]/g, '-');

function run(...args: string[]) {
  return execFileSync('python3', ['-I', SCRIPT, ...args], {
    env: { PATH: process.env.PATH ?? '', HOME: home, PYTHONIOENCODING: 'utf-8' },
    encoding: 'utf-8',
  });
}

beforeAll(() => {
  // A user name with "_" and "-" so a partial mask would leave the surname visible.
  home = join(mkdtempSync(join(tmpdir(), 'ksh-kit-')), 'fictional_taro-yamada');
  const dir = join(home, '.claude', 'projects', '-Users-fictionaluser-docker-notes');
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
  // Sessions without a cwd fall back to Claude Code's folder name, which encodes the full path
  // (including the user name) with "/" turned into "-".
  for (const folder of [encoded(home) + '-private-repo', '-home-fictionaluser-linux-notes']) {
    const other = join(home, '.claude', 'projects', folder);
    mkdirSync(other, { recursive: true });
    writeFileSync(
      join(other, 'fictional-other.jsonl'),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-11-02T10:00:00Z',
        message: { content: 'docker の別件' },
      }) + '\n',
    );
  }
  // index shortens titles; a secret or email that straddles the cut must still be hidden.
  const codexDir = join(home, '.codex', 'sessions', '2026', '11', '03');
  mkdirSync(codexDir, { recursive: true });
  writeFileSync(
    join(codexDir, 'rollout-fictional.jsonl'),
    [
      {
        type: 'session_meta',
        payload: { cwd: '/tmp/cut-notes', timestamp: '2026-11-03T10:00:00Z' },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'docker ' + 'あ'.repeat(76) + ' ' + FAKE_KEY }],
        },
      },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n') + '\n',
  );
  const antigravity = join(home, '.gemini', 'antigravity-cli');
  mkdirSync(antigravity, { recursive: true });
  writeFileSync(
    join(antigravity, 'history.jsonl'),
    JSON.stringify({
      display: 'docker ' + 'い'.repeat(24) + ' ' + FAKE_EMAIL,
      timestamp: '2026-11-04T10:00:00Z',
      workspace: '/tmp/cut-notes',
    }) + '\n',
  );
});

afterAll(() => rmSync(join(home, '..'), { recursive: true, force: true }));

describe('agent kit session_index.py', () => {
  it('lists and shows a fictional session with secrets, emails and user paths masked', () => {
    const index = run('index', '--grep', 'docker');
    expect(index).toContain('claude');
    expect(index).toContain('docker-notes');
    expect(index).toContain('~-private-repo');
    expect(index).toContain('-home-<you>-linux-notes');
    expect(index).toContain('-Users-<you>-docker-notes');
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
      expect(output).not.toContain(FAKE_KEY.slice(0, 8));
      expect(output).not.toContain('fictional.student');
      expect(output).not.toContain('fictionaluser');
      expect(output).not.toContain(home);
      expect(output).not.toContain(encoded(home));
      expect(output).not.toContain('yamada');
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

// #209: an agent started in the home folder itself (a common way to run one) must not print the
// user name as the project. Separate fictional HOME so the cases above stay as they are.
describe('agent kit session_index.py with the home folder as the working place', () => {
  let homeOnly: string;
  const NAME = 'fictional_hanako-suzuki';
  const GLUED_KEY = 'mykey' + 'sk-' + 'gluedFictional0123456789';

  function runIn(...args: string[]) {
    return execFileSync('python3', ['-I', SCRIPT, ...args], {
      env: { PATH: process.env.PATH ?? '', HOME: homeOnly, PYTHONIOENCODING: 'utf-8' },
      encoding: 'utf-8',
    });
  }

  beforeAll(() => {
    homeOnly = join(mkdtempSync(join(tmpdir(), 'ksh-kit-home-')), NAME);
    const claudeDir = join(homeOnly, '.claude', 'projects', encoded(homeOnly));
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, 'fictional-home.jsonl'),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-11-05T10:00:00Z',
        cwd: homeOnly,
        message: { content: `kubernetes をホームで試した ${GLUED_KEY}` },
      }) + '\n',
    );
    // A different absolute path whose last folder has the same name as the home folder.
    const codexDir = join(homeOnly, '.codex', 'sessions', '2026', '11', '06');
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(
      join(codexDir, 'rollout-home.jsonl'),
      [
        { type: 'session_meta', payload: { cwd: homeOnly, timestamp: '2026-11-06T10:00:00Z' } },
        {
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'kubernetes のメモ' }],
          },
        },
      ]
        .map((l) => JSON.stringify(l))
        .join('\n') + '\n',
    );
    writeFileSync(
      join(codexDir, 'rollout-same-name.jsonl'),
      [
        {
          type: 'session_meta',
          payload: { cwd: `/srv/${NAME}`, timestamp: '2026-11-06T11:00:00Z' },
        },
        {
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'kubernetes の別メモ' }],
          },
        },
      ]
        .map((l) => JSON.stringify(l))
        .join('\n') + '\n',
    );
    // Gemini CLI may name its tmp folder after the user name instead of a hash.
    const geminiDir = join(homeOnly, '.gemini', 'tmp', NAME, 'chats');
    mkdirSync(geminiDir, { recursive: true });
    writeFileSync(
      join(geminiDir, 'session-fictional.json'),
      JSON.stringify({
        messages: [
          { type: 'user', timestamp: '2026-11-07T10:00:00Z', content: 'kubernetes を gemini で' },
        ],
      }),
    );
    const antigravity = join(homeOnly, '.gemini', 'antigravity-cli');
    mkdirSync(antigravity, { recursive: true });
    writeFileSync(
      join(antigravity, 'history.jsonl'),
      JSON.stringify({
        display: 'kubernetes を antigravity で',
        timestamp: '2026-11-08T10:00:00Z',
        workspace: homeOnly,
      }) + '\n',
    );
  });

  afterAll(() => rmSync(join(homeOnly, '..'), { recursive: true, force: true }));

  it('shows "~" as the project and never prints the user name or a glued key', () => {
    const index = runIn('index', '--grep', 'kubernetes');
    const rows = index.split('\n').filter((line) => /^\d{4}-\d{2}-\d{2}/.test(line));
    expect(rows).toHaveLength(5);
    for (const tool of ['claude', 'codex', 'gemini', 'antigravity']) {
      const row = rows.find((line) => line.includes(` ${tool} `));
      expect(row, tool).toBeDefined();
      expect(row!.split(/\s+/)[2], tool).toBe('~');
    }
    expect(index).toContain('~/.gemini/tmp/<you>/chats');
    const shown = runIn(
      'show',
      join(homeOnly, '.claude', 'projects', encoded(homeOnly), 'fictional-home.jsonl'),
    );
    expect(shown).toContain('[秘密を伏せました]');
    for (const output of [index, shown]) {
      expect(output).not.toContain(NAME);
      expect(output).not.toContain('suzuki');
      expect(output).not.toContain(GLUED_KEY.slice(5, 16));
    }
  });

  it('opens every session with the masked path that index printed (the SKILL.md flow)', () => {
    const index = runIn('index', '--grep', 'kubernetes');
    const paths = index
      .split('\n')
      .filter((line) => /^\s{12}\S/.test(line))
      .map((line) => line.trim())
      .filter((path) => !path.endsWith('history.jsonl'));
    expect(paths.length).toBe(4);
    expect(paths.some((path) => path.startsWith('~/.claude/projects/~/'))).toBe(true);
    for (const path of paths) {
      const shown = runIn('show', path);
      expect(shown, path).toContain('## あなた');
      expect(shown, path).toContain('kubernetes');
      expect(shown, path).not.toContain(NAME);
    }
  });

  it('hides Stripe-style keys, .env/JSON/URL secrets and the user name in other letter cases or in "-" form', () => {
    const dir = join(homeOnly, '.claude', 'projects', '-tmp-forms');
    mkdirSync(dir, { recursive: true });
    const stripe = 'sk_' + 'live_' + 'Fictional0123456789abcdef';
    writeFileSync(
      join(dir, 'forms.jsonl'),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-11-10T10:00:00Z',
        cwd: '/tmp/forms',
        message: {
          content: `openshift ${stripe} ${NAME.toUpperCase()} /srv/${NAME.replace(/[^A-Za-z0-9]/g, '-')}`,
        },
      }) + '\n',
    );
    // .env lines, JSON and URL credentials, as people paste them into an agent.
    const envSecrets = [
      'dbFictional9pass',
      'awsFictional9Secret',
      'jsonFictional9pw',
      'urlFictional9pw',
    ];
    writeFileSync(
      join(dir, 'env.jsonl'),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-11-11T10:00:00Z',
        cwd: '/tmp/forms',
        message: {
          content: [
            `openshift の .env: DB_PASSWORD=${envSecrets[0]}`,
            `AWS_SECRET_ACCESS_KEY=${envSecrets[1]}`,
            `{"password": "${envSecrets[2]}"}`,
            `postgres://app:${envSecrets[3]}@localhost:5432/db`,
          ].join('\n'),
        },
      }) + '\n',
    );
    const shown = runIn('show', join(dir, 'forms.jsonl'));
    expect(shown).toContain('openshift');
    expect(shown).not.toContain(stripe.slice(0, 12));
    const env = runIn('show', join(dir, 'env.jsonl')) + runIn('index', '--grep', 'openshift');
    expect(env).toContain('DB_PASSWORD=[秘密を伏せました]');
    for (const secret of envSecrets) expect(env).not.toContain(secret);
    expect(shown.toLowerCase()).not.toContain('hanako');
  });

  // #214: a private key must be hidden whole — header, body and END line — in index and show,
  // also when a "NAME=" rule could match first, when it is one line joined by "\n", or when it
  // was cut off before its END line. Fictional key bodies only.
  it('hides whole private keys (PEM) from .env, JSON, YAML, OpenSSH and cut-off forms', () => {
    const body = (n: number) => `MIIEvQIBADANBgkqFictionalPemBody${n}AAAA+/=`;
    // One full PEM line (64 characters) with no BEGIN or END around it.
    const long = (n: number) =>
      `MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7FictionalPemBody${n}AAAA`;
    const esc = '\\n';
    const forms = [
      `pemcheck env FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----${esc}${body(1)}${esc}${body(11)}${esc}-----END PRIVATE KEY-----${esc}" after-env`,
      `pemcheck json {"type": "service_account", "private_key": "-----BEGIN PRIVATE KEY-----${esc}${body(2)}${esc}-----END PRIVATE KEY-----${esc}", "after": "json"}`,
      `pemcheck yaml\nprivate_key: -----BEGIN RSA PRIVATE KEY-----\n${body(3)}\n${body(13)}\n-----END RSA PRIVATE KEY-----\nafter: yaml`,
      `pemcheck ssh\n-----BEGIN OPENSSH PRIVATE KEY-----\n${body(4)}\n-----END OPENSSH PRIVATE KEY-----\nafter-ssh`,
      `pemcheck cut "private_key": "-----BEGIN PRIVATE KEY-----${esc}${body(5)}${esc}${body(15)}`,
      `pemcheck cut-lines\nkey: -----BEGIN EC PRIVATE KEY-----\n${body(6)}\n${body(16)}`,
      // Cut off with headers or escapes the body may carry (#214 verifier 1).
      `pemcheck pgp-cut\n-----BEGIN PGP PRIVATE KEY BLOCK-----\nComment: https://example.invalid/key.html\n\n${body(7)}`,
      `pemcheck abridged -----BEGIN PRIVATE KEY-----\n${body(8)}\n...\n${body(18)}`,
      `pemcheck nested {"inner": "{\\"private_key\\": \\"-----BEGIN PRIVATE KEY-----\\\\n${body(9)}\\\\n${body(19)}`,
      `pemcheck slash "-----BEGIN PRIVATE KEY-----\\n${body(10).replace('+/', '+\\/')}\\n${body(20)}`,
      `pemcheck tab "-----BEGIN RSA PRIVATE KEY-----\\n\\t${body(12)}\\n\\t${body(14)}`,
      `pemcheck ssh2\n---- BEGIN SSH2 ENCRYPTED PRIVATE KEY ----\nComment: "fictional"\n${body(17)}\n---- END SSH2 ENCRYPTED PRIVATE KEY ----\nafter-ssh2`,
      `pemcheck ppk\nPuTTY-User-Key-File-3: ssh-ed25519\nPrivate-Lines: 1\n${body(21)}\nPrivate-MAC: 0123abcdef\nafter-ppk`,
      // The end or the middle of a key pasted without its BEGIN line (#214 verifier 2).
      `pemcheck tail\n${long(22)}\n${body(23)}\n-----END RSA PRIVATE KEY-----\nafter-tail`,
      `pemcheck middle\n${long(24)}\n${long(25)}\nafter-middle`,
      // Headers pasted in non-standard ways (#214 verifier 2).
      `pemcheck four ----BEGIN RSA PRIVATE KEY----\n${body(26)}\n----END RSA PRIVATE KEY----\nafter-four`,
      `pemcheck lower -----begin rsa private key-----\n${body(27)}\n-----end rsa private key-----\nafter-lower`,
      `pemcheck spaced ----- BEGIN RSA PRIVATE KEY -----\n${body(28)}\n----- END RSA PRIVATE KEY -----\nafter-spaced`,
      `pemcheck md \\-----BEGIN RSA PRIVATE KEY\\-----\n${body(29)}\n\\-----END RSA PRIVATE KEY\\-----\nafter-md`,
      `pemcheck nbsp —————BEGIN RSA\u00a0PRIVATE KEY—————\n${body(30)}\n—————END RSA\u00a0PRIVATE KEY—————\nafter-nbsp`,
      `pemcheck broken -----BEGIN OPENSSH PRIVATE\nKEY-----\n${body(31)}\n-----END OPENSSH PRIVATE\nKEY-----\nafter-broken`,
      `pemcheck u002d ${'\\u002d'.repeat(5)}BEGIN PRIVATE KEY${'\\u002d'.repeat(5)}\\n${body(32)}`,
    ];
    const claudeDir = join(homeOnly, '.claude', 'projects', '-tmp-pem');
    const codexDir = join(homeOnly, '.codex', 'sessions', '2026', '11', '12');
    mkdirSync(claudeDir, { recursive: true });
    mkdirSync(codexDir, { recursive: true });
    const files: string[] = [];
    forms.forEach((text, i) => {
      const claude = join(claudeDir, `pem-${i}.jsonl`);
      writeFileSync(
        claude,
        [
          {
            type: 'user',
            timestamp: `2026-11-12T${String(i).padStart(2, '0')}:00:00Z`,
            cwd: '/tmp/pem',
            message: { content: text },
          },
          { type: 'assistant', message: { content: [{ type: 'text', text: `確認: ${text}` }] } },
        ]
          .map((l) => JSON.stringify(l))
          .join('\n') + '\n',
      );
      const codex = join(codexDir, `rollout-pem-${i}.jsonl`);
      writeFileSync(
        codex,
        [
          {
            type: 'session_meta',
            payload: {
              cwd: '/tmp/pem',
              timestamp: `2026-11-12T${String(i).padStart(2, '0')}:30:00Z`,
            },
          },
          {
            type: 'response_item',
            payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
          },
          {
            type: 'response_item',
            payload: {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: `確認: ${text}` }],
            },
          },
        ]
          .map((l) => JSON.stringify(l))
          .join('\n') + '\n',
      );
      files.push(claude, codex);
    });
    // One key pasted in two messages: BEGIN and part of the body, then the rest and END.
    const split = join(claudeDir, 'pem-split.jsonl');
    writeFileSync(
      split,
      [
        {
          type: 'user',
          timestamp: '2026-11-13T10:00:00Z',
          cwd: '/tmp/pem',
          message: { content: `pemcheck split\n-----BEGIN RSA PRIVATE KEY-----\n${body(33)}` },
        },
        { type: 'assistant', message: { content: [{ type: 'text', text: '続きをどうぞ' }] } },
        {
          type: 'user',
          message: {
            content: `${body(34)}\n${body(35)}\n-----END RSA PRIVATE KEY-----\nafter-split`,
          },
        },
      ]
        .map((l) => JSON.stringify(l))
        .join('\n') + '\n',
    );
    files.push(split);
    const index = runIn('index', '--grep', 'pemcheck');
    expect(index.split('\n').filter((line) => /^\d{4}-\d{2}-\d{2}/.test(line))).toHaveLength(45);
    expect(index).toContain('[秘密鍵を伏せました]');
    const outputs = [index, ...files.map((file) => runIn('show', file))];
    for (const output of outputs) {
      for (let n = 1; n <= 35; n++) expect(output).not.toContain(`FictionalPemBody${n}AAAA`);
      expect(output).not.toContain('MIIEvQ');
      expect(output).not.toMatch(
        /PRIVATE KEY|-----END|---- END|BEGIN [A-Z0-9 ]*PRIVATE|Private-(?:Lines|MAC)/,
      );
    }
    const shown = outputs.slice(1).join('\n');
    for (const rest of [
      'after-env',
      '"after": "json"',
      'after: yaml',
      'after-ssh',
      'after-ssh2',
      'after-ppk',
      'after-tail',
      'after-middle',
      'after-four',
      'after-lower',
      'after-spaced',
      'after-md',
      'after-nbsp',
      'after-broken',
      'after-split',
    ]) {
      expect(shown).toContain(rest);
    }
    expect(shown).toContain('## エージェント');
  });

  it('keeps ordinary words that merely contain "sk-"', () => {
    const dir = join(homeOnly, '.claude', 'projects', '-tmp-plain');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'plain.jsonl'),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-11-09T10:00:00Z',
        cwd: '/tmp/plain',
        message: { content: 'kubernetes の task-management-dashboard を作る' },
      }) + '\n',
    );
    expect(runIn('index', '--grep', 'task-management')).toContain('task-management-dashboard');
  });
});
