import { readdirSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MCP_TOOL_NAMES } from '../worker/agent/http';
import { serverInstructions } from '../worker/agent/guide';
import {
  appendEvents,
  eventsFromHook,
  fmtCount,
  issueTitle,
  loadCoverage,
  opForSurface,
  pathTemplate,
  pendingFor,
  planIssue,
  priorFromComments,
  readEvents,
  syncComment,
  tally,
  // @ts-expect-error plain ESM script without type declarations
} from '../scripts/loop/mcp-gap.mjs';

type Op = {
  id: string;
  class: string;
  tool?: string;
  api?: string[];
  pages?: string[];
  d1?: string[];
  basis?: string;
};
const coverage = loadCoverage() as { ops: Op[]; classes: Record<string, string> };
const NOW = new Date('2026-11-25T03:00:00Z');
const hook = (tool_name: string, tool_input: Record<string, unknown>) =>
  eventsFromHook({ session_id: 'abcdef0123456789', tool_name, tool_input }, coverage, NOW);

describe('MCP 対応表（docs/loop/mcp-coverage.json）', () => {
  it('公式 MCP の全ツールが、ちょうど1つの操作の tool に現れる', () => {
    const named = coverage.ops.filter((o) => o.tool).map((o) => o.tool);
    expect([...named].sort()).toEqual([...MCP_TOOL_NAMES].sort());
    for (const o of coverage.ops.filter((o) => o.tool)) expect(o.class).toBe('mcp');
  });

  it('操作 ID は重複せず、class は決めた5つのどれか', () => {
    const ids = coverage.ops.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const o of coverage.ops) expect(Object.keys(coverage.classes)).toContain(o.class);
  });

  it('初めての公開は human-only で、human-only・excluded・operator には tool が無く根拠がある', () => {
    expect(coverage.ops.find((o) => o.id === 'article.first-publish')?.class).toBe('human-only');
    for (const o of coverage.ops.filter((o) => o.class !== 'mcp')) {
      expect(o.tool, o.id).toBeUndefined();
      if (o.class !== 'gap') expect(o.basis, o.id).toBeTruthy();
    }
  });

  it('worker の /api/private/ の口は、どれかの操作の api に入る', () => {
    const prefixes = coverage.ops.flatMap((o) =>
      (o.api || []).map((a) => (a.includes(' ') ? a.split(' ')[1] : a)),
    );
    const files = readdirSync('worker', { recursive: true, encoding: 'utf8' }).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.d.ts'),
    );
    const paths = new Set<string>();
    for (const f of files)
      for (const m of readFileSync(join('worker', f), 'utf8').matchAll(
        /['"`](\/api\/private\/[a-z][a-z-]*)/g,
      ))
        paths.add(m[1]);
    expect(paths.size).toBeGreaterThan(20);
    for (const p of paths)
      expect(
        prefixes.some((x) => p.startsWith(x.replace(/\/$/, '')) || x.startsWith(p)),
        p,
      ).toBe(true);
  });
});

describe('経路の型と操作 ID', () => {
  it('ID・クエリを落として型にする', () => {
    expect(pathTemplate('/articles/0b4f2c1e-1111-4222-8333-444455556666', coverage)).toBe(
      '/articles/:id',
    );
    expect(pathTemplate('/drafts/new', coverage)).toBe('/drafts/new');
    expect(pathTemplate('/api/private/drafts/0b4f2c1e-1111-4222-8333-444455556666', coverage)).toBe(
      '/api/private/drafts/:id',
    );
    expect(pathTemplate('/somewhere/secret-name/deeper', coverage)).toBe('/somewhere/*');
  });

  it('メソッドと最長の前方一致で操作を引き、決まらなければ unknown', () => {
    expect(opForSurface('POST /api/private/drafts', coverage)).toBe('draft.create');
    expect(opForSurface('DELETE /api/private/drafts/:id', coverage)).toBe('draft.delete');
    expect(opForSurface('POST /api/private/project-reports', coverage)).toBe('report');
    expect(opForSurface('GET /api/articles/:id', coverage)).toBe('article.read');
    expect(opForSurface('POST /api/private/my-taste', coverage)).toBe('unknown');
    expect(opForSurface('page /drafts/new', coverage)).toBe('draft.create');
    expect(opForSurface('d1 editorial_draft_marks editorial_reviews', coverage)).toBe(
      'operator.review-read',
    );
  });
});

describe('hook が拾う出来事', () => {
  it('Claude in Chrome が本番 hub を開いたら、列挙した項目だけを残す', () => {
    const [e] = hook('mcp__claude-in-chrome__navigate', {
      url: 'https://hub.junhat6.com/drafts/new?from=mail#x',
      tabId: 1,
    });
    expect(e).toEqual({
      at: '2026-11-25T03:00Z',
      source: 'hook',
      session: 'abcdef012345',
      loop: expect.any(String),
      via: 'chrome',
      surface: 'page /drafts/new',
      op: 'draft.create',
    });
    expect(JSON.stringify(e)).not.toContain('from=mail');
  });

  it('URL を書いただけの git・gh・別のホストは数えない', () => {
    expect(
      hook('Bash', { command: 'git commit -m "https://hub.junhat6.com/drafts 直す"' }),
    ).toEqual([]);
    expect(hook('Bash', { command: 'gh issue comment 1 --body https://hub.junhat6.com/' })).toEqual(
      [],
    );
    expect(hook('mcp__claude-in-chrome__navigate', { url: 'https://example.com/drafts' })).toEqual(
      [],
    );
    expect(hook('Bash', { command: 'curl -s https://hub.junhat6.com/api/mcp -d {}' })).toEqual([]);
  });

  it('curl は API の型とメソッド、リモート D1 は既知の表の名前だけ（SQL の中身は残さない）', () => {
    const [c] = hook('Bash', {
      command:
        "curl -X DELETE 'https://hub.junhat6.com/api/private/drafts/0b4f2c1e-1111-4222-8333-444455556666' -H 'Cookie: x'",
    });
    expect(c).toMatchObject({
      via: 'http',
      surface: 'DELETE /api/private/drafts/:id',
      op: 'draft.delete',
    });
    const [d] = hook('Bash', {
      command:
        'npx wrangler d1 execute DB --remote --command "SELECT note FROM editorial_reviews WHERE note LIKE \'%秘密のひとこと%\'"',
    });
    expect(d).toMatchObject({
      via: 'd1',
      surface: 'd1 editorial_reviews',
      op: 'operator.review-read',
    });
    expect(JSON.stringify(d)).not.toContain('秘密');
  });

  it('記録ファイルには許した鍵だけが書かれ、分類待ちが分かる', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'mcp-gap-')), 'events.jsonl');
    const [e] = hook('mcp__claude-in-chrome__navigate', {
      url: 'https://hub.junhat6.com/drafts/x',
    });
    appendEvents([{ ...e, url: 'https://hub.junhat6.com/drafts/x?q=1', body: '本文' }], file);
    const [back] = readEvents(file);
    expect(Object.keys(back).sort()).toEqual([
      'at',
      'loop',
      'op',
      'session',
      'source',
      'surface',
      'via',
    ]);
    expect(pendingFor('abcdef012345', readEvents(file))).toHaveLength(1);
    appendEvents(
      [{ at: e.at, type: 'classify', session: 'abcdef012345', ops: ['draft.media'] }],
      file,
    );
    expect(pendingFor('abcdef012345', readEvents(file))).toHaveLength(0);
  });
});

describe('集計と Issue の計画', () => {
  const ev = (o: Record<string, unknown>) => ({
    at: '2026-11-25T03:00Z',
    source: 'report',
    via: 'chrome',
    ...o,
  });

  it('分類があるセッションは hook の生の出来事を数えず、分類を数える', () => {
    const rows = tally([
      ev({ source: 'hook', session: 's1', op: 'unknown' }),
      ev({ source: 'hook', session: 's1', op: 'draft.create' }),
      ev({ type: 'classify', session: 's1', ops: ['draft.media'] }),
      ev({ source: 'hook', session: 's2', op: 'article.read' }),
    ]);
    expect(rows.map((r: { op: string; total: number }) => [r.op, r.total]).sort()).toEqual([
      ['article.read', 1],
      ['draft.media', 1],
    ]);
  });

  it('human-only と inspect は Issue にしない', () => {
    for (const op of ['article.first-publish', 'agent.connect', 'inspect']) {
      const [row] = tally([ev({ op })]);
      expect(planIssue(row, null, coverage).action).toBe('log-only');
    }
  });

  it('gap は loop:finish＋R2、mcp は loop:garden、excluded・operator は判断待ち', () => {
    const plan = (op: string) => planIssue(tally([ev({ op })])[0], null, coverage);
    expect(plan('reading-history').labels).toEqual(['mcp-gap', 'loop:finish', 'R2', 'P2']);
    expect(plan('draft.create').labels).toEqual(['mcp-gap', 'loop:garden', 'P2']);
    expect(plan('draft.media').labels).toEqual(['mcp-gap']);
    expect(plan('operator.moderation').labels).toEqual(['mcp-gap']);
    expect(issueTitle(plan('reading-history'))).toContain('公式 MCP でできるようにする');
  });

  it('累計3件か2日で P1 に上がり、累計はコメントの JSON から読み戻す', () => {
    const comments = [
      { body: syncComment(tally([ev({ op: 'project.write' })])[0], { total: 1, days: 1 }) },
      { body: 'ほかの話\n```json\n{"op":"other","n":9,"days":[]}\n```' },
    ];
    const prior = priorFromComments(comments, 'project.write');
    expect(prior).toEqual({ total: 1, days: ['2026-11-25'] });
    const row = tally([ev({ op: 'project.write', at: '2026-11-26T01:00Z' })])[0];
    expect(planIssue(row, prior, coverage)).toMatchObject({ priority: 'P1', total: 2, days: 2 });
  });

  it('利用者の台帳から来た少ない件数は丸める', () => {
    expect(fmtCount(2, 'taste')).toBe('5件未満');
    expect(fmtCount(2, 'report')).toBe('2件');
  });
});

describe('利用者のエージェントへの案内', () => {
  it('台帳のツールがあるときだけ、MCP でしたかった操作をアプリの行に残すよう伝える', () => {
    expect(serverInstructions('https://hub.example', true)).toContain('MCP でしたかった操作');
    expect(serverInstructions('https://hub.example', false)).not.toContain('replace_my_taste');
  });
});
