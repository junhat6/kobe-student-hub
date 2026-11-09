import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readdirSync } from 'node:fs';
import { applyFixtureMigrations } from './helpers/migrations';
import type { ReadingHistoryPage } from '../src/history/types';
const ORIGIN = 'https://app.example.invalid',
  NOW = 1800000000000,
  PATH = '/api/private/reading-history';
let mf: Miniflare;
let users: { setCookie: string; contextCookie: string; csrfToken: string }[];
const headers = (n = 0) => ({
  Cookie: [users[n].setCookie, users[n].contextCookie].map((x) => x.split(';')[0]).join('; '),
  Origin: ORIGIN,
  Authorization: 'Bearer csrf.' + users[n].csrfToken,
  'Content-Type': 'application/json',
});
const request = (
  method = 'GET',
  value?: unknown,
  n = 0,
  extra: Record<string, string> = {},
  suffix = '',
) =>
  mf.dispatchFetch(ORIGIN + PATH + suffix, {
    method,
    headers: { ...headers(n), ...extra },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
const record = (id = 'learning-notes', kind = 'article', n = 0, extra = {}) =>
  request('PUT', { kind, contentId: id }, n, extra);
const list = async (n = 0, suffix = '') =>
  (await (await request('GET', undefined, n, {}, suffix)).json()) as ReadingHistoryPage;
async function clear(n = 0) {
  expect((await request('DELETE', { all: true }, n)).status).toBe(200);
}
async function count(n = 0) {
  return (await (
    await mf.getD1Database('DB')
  )
    .prepare('SELECT count(*) n FROM private_reading_history WHERE owner_account_id=?')
    .bind('history-account-' + n)
    .first<{ n: number }>())!.n;
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: [
        { type: 'ESModule', path: '.worker/reading-history-test.js' },
        ...readdirSync('.worker')
          .filter((n) => n.endsWith('.wasm'))
          .map((n) => ({ type: 'CompiledWasm' as const, path: '.worker/' + n })),
      ],
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
    }),
  );
  const db = await mf.getD1Database('DB');
  await applyFixtureMigrations(db);
  for (let n = 0; n < 5; n++)
    await db
      .prepare(
        "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)",
      )
      .bind(
        'history-account-' + n,
        'history-subject-' + n,
        'fictional-' + n + '@st.kobedenshi.ac.jp',
        NOW,
      )
      .run();
  users = [];
  for (let n = 0; n < 5; n++)
    users.push(
      (await (
        await mf.dispatchFetch(ORIGIN + '/fixture/session', {
          headers: { 'X-Test-Who': String(n) },
        })
      ).json()) as (typeof users)[number],
    );
});
afterAll(async () => {
  await mf?.dispose();
});
describe('private reading history with native D1 final authority', () => {
  it('requires authentication, CSRF, canonical bounded bodies and ordinary release gate', async () => {
    expect((await request('GET', undefined, 0, { Cookie: '' })).status).toBe(401);
    expect(
      (await record('learning-notes', 'article', 0, { Origin: 'https://evil.invalid' })).status,
    ).toBe(401);
    expect((await record('learning-notes', 'article', 0, { Authorization: '' })).status).toBe(401);
    expect(
      (
        await request('PUT', {
          kind: 'article',
          contentId: 'learning-notes',
          ownerAccountId: 'history-account-1',
        })
      ).status,
    ).toBe(404);
    expect((await request('PUT', { kind: 'article', contentId: 'x'.repeat(1025) })).status).toBe(
      413,
    );
    for (const suffix of [
      '?offset=-1',
      '?offset=501',
      '?offset=01',
      '?offset=1&offset=2',
      '?owner=history-account-1',
    ])
      expect((await request('GET', undefined, 0, {}, suffix)).status).toBe(404);
    expect(
      (await record('learning-notes', 'article', 0, { 'X-Test-Disabled': 'true' })).status,
    ).toBe(418);
    expect(await count()).toBe(0);
  });
  it('records only canonical public targets, deduplicates and returns bounded private explicit DTOs', async () => {
    const missing = await record('not-a-public-target');
    expect(await missing.json()).toEqual({ recorded: false });
    expect(await (await record('learning-notes', 'project')).json()).toEqual({ recorded: false });
    for (let i = 0; i < 3; i++) expect(await (await record()).json()).toEqual({ recorded: true });
    expect(await (await record('tiny-notes', 'project')).json()).toEqual({ recorded: true });
    const result = await list();
    expect(result.entries).toHaveLength(2);
    expect(result.entries.every((entry) => entry.isSample === true)).toBe(true);
    const db = await mf.getD1Database('DB');
    expect(
      (
        await db.prepare('PRAGMA table_info(private_reading_history)').all<{ name: string }>()
      ).results
        .map((r) => r.name)
        .sort(),
    ).toEqual(['content_id', 'kind', 'last_viewed_at_ms', 'owner_account_id']);
    expect(await count()).toBe(2);
    expect((await list(1)).entries).toEqual([]);
    const response = await request();
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Vary')).toBe('Cookie');
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
    expect(Object.keys(result).sort()).toEqual(['capacity', 'enabled', 'entries', 'nextOffset']);
    expect(Object.keys(result.entries[0]).sort()).toEqual([
      'contentId',
      'isSample',
      'kind',
      'lastViewedAt',
      'title',
    ]);
    expect(JSON.stringify(result)).not.toMatch(/fictional@|body|google|history-account/);
  });
  it('handles real ordinary article and project references, then redacts stopped or hidden titles', async () => {
    const db = await mf.getD1Database('DB');
    const publish = async (kind: string) =>
      (await (
        await mf.dispatchFetch(ORIGIN + '/fixture/publish', {
          method: 'POST',
          body: JSON.stringify({ headers: headers(0), kind }),
        })
      ).json()) as { contentId?: string; projectId?: string };
    const a = (await publish('article')).contentId!,
      p = (await publish('project')).projectId!;
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(p).toMatch(/^[0-9a-f-]{36}$/);
    expect(await (await record(a)).json()).toEqual({ recorded: true });
    expect(await (await record(p, 'project')).json()).toEqual({ recorded: true });
    expect(
      (await list()).entries
        .filter((x) => [a, p].includes(x.contentId))
        .every((x) => x.title?.startsWith('Ordinary history') && x.isSample === false),
    ).toBe(true);
    await db.prepare("UPDATE content SET status='hidden' WHERE id=?").bind(a).run();
    await db.prepare("UPDATE project_publications SET status='deleted' WHERE id=?").bind(p).run();
    const result = await list();
    expect(result.entries.filter((x) => [a, p].includes(x.contentId)).map((x) => x.title)).toEqual([
      null,
      null,
    ]);
    expect(
      result.entries.filter((x) => [a, p].includes(x.contentId)).map((x) => x.isSample),
    ).toEqual([null, null]);
    expect(await (await record(a)).json()).toEqual({ recorded: false });
  });
  it('allows own idempotent single/all deletion without deleting another account, including withdrawn references', async () => {
    await record('learning-notes', 'article', 1);
    await clear();
    expect(await count()).toBe(0);
    expect(await count(1)).toBe(1);
    for (let i = 0; i < 2; i++)
      expect(
        await (await request('DELETE', { kind: 'article', contentId: 'learning-notes' }, 1)).json(),
      ).toEqual({ deleted: true });
    expect(await count(1)).toBe(0);
    await clear();
  });
  it('turns future collection off without purging existing entries, then resumes explicitly', async () => {
    await record();
    expect(await (await request('PATCH', { enabled: false })).json()).toEqual({ enabled: false });
    expect(await (await record('git-branches')).json()).toEqual({ recorded: false });
    expect(await count()).toBe(1);
    expect((await list()).enabled).toBe(false);
    await request('PATCH', { enabled: true });
    expect(await (await record('git-branches')).json()).toEqual({ recorded: true });
    await clear();
  });
  it('keeps all 500 existing references, paginates, and refuses a new target at capacity without eviction', async () => {
    const db = await mf.getD1Database('DB');
    await db
      .prepare(
        `WITH RECURSIVE seq(n) AS(VALUES(0) UNION ALL SELECT n+1 FROM seq WHERE n<499)
      INSERT INTO private_reading_history SELECT ?,'article','old-'||n,? FROM seq`,
      )
      .bind('history-account-0', NOW - 1000)
      .run();
    expect(await count()).toBe(500);
    expect(await (await record()).json()).toEqual({ recorded: false });
    expect(await count()).toBe(500);
    const first = await list();
    expect(first.entries).toHaveLength(20);
    expect(first.nextOffset).toBe(20);
    expect(first.entries.every((x) => x.title === null)).toBe(true);
    expect((await list(0, '?offset=480')).nextOffset).toBeNull();
    expect(
      await db.prepare("SELECT 1 FROM private_reading_history WHERE content_id='old-0'").first(),
    ).not.toBeNull();
    await clear();
  });
  it('rechecks visibility and session generation/epoch/status at the final SQL statement', async () => {
    const db = await mf.getD1Database('DB');
    await record();
    const hidden = await request('GET', undefined, 0, { 'X-Test-Race': 'hide' });
    const withdrawn = ((await hidden.json()) as ReadingHistoryPage).entries[0];
    expect(withdrawn.title).toBeNull();
    expect(withdrawn.isSample).toBeNull();
    await db.prepare("UPDATE content SET status='published' WHERE id='learning-notes'").run();
    await clear();
    for (const [n, race] of [
      [2, 'context'],
      [3, 'epoch'],
      [4, 'status'],
    ] as const) {
      expect(
        await (
          await record('learning-notes', 'article', n, {
            'X-Test-Race': race,
            'X-Test-Who': String(n),
          })
        ).json(),
      ).toEqual({ recorded: false });
      expect(await count(n)).toBe(0);
      if (race === 'status') await db.prepare("UPDATE private_accounts SET status='active'").run();
    }
  });
});
