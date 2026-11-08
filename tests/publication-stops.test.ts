import { beforeAll, afterAll, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import type { PublicationStopState } from '../src/publication-stop-types';
const O = 'https://app.example.invalid',
  NOW = 1800000000000,
  PATH = '/api/private/publication-stops';
let mf: Miniflare;
type Session = { setCookie: string; contextCookie: string; csrfToken: string };
let users: Session[];
const h = (n = 0) => ({
  Cookie: [users[n].setCookie, users[n].contextCookie].map((v) => v.split(';')[0]).join('; '),
  Origin: O,
  Authorization: 'Bearer csrf.' + users[n].csrfToken,
  'Content-Type': 'application/json',
});
async function login(n: number) {
  return (await (
    await mf.dispatchFetch(O + '/fixture/session', { headers: { 'X-Test-Who': String(n) } })
  ).json()) as Session;
}
async function action<T>(action: string, input: unknown = {}, id?: string, n = 0): Promise<T> {
  return (await (
    await mf.dispatchFetch(O + '/fixture/action', {
      method: 'POST',
      headers: h(n),
      body: JSON.stringify({ action, input, id }),
    })
  ).json()) as T;
}
async function req(n = 0, extra: Record<string, string> = {}, path = PATH, method = 'GET') {
  const r = await mf.dispatchFetch(O + path, { method, headers: { ...h(n), ...extra } });
  if (path.startsWith(PATH)) {
    for (const [k, v] of Object.entries({
      'Cache-Control': 'private, no-store',
      Vary: 'Cookie',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
      'Content-Type': 'application/json; charset=utf-8',
    }))
      expect(r.headers.get(k)).toBe(v);
    for (const k of ['Set-Cookie', 'Location', 'Access-Control-Allow-Origin'])
      expect(r.headers.has(k)).toBe(false);
  }
  return r;
}
async function publish(kind: 'article' | 'project', title: string, n = 0) {
  const d = await action<{ id: string }>(
    kind + '-draft',
    kind === 'article'
      ? { title, body: 'Saved article body' }
      : { title, description: 'Saved project description', githubUrl: '', demoUrl: '' },
    undefined,
    n,
  );
  const p = await action<{ contentId?: string; projectId?: string }>(
    kind + '-publish',
    kind === 'article'
      ? { expectedVersion: 1, confirmPublic: true, summary: 'Summary', tags: [], minutes: 1 }
      : { expectedVersion: 1, confirmPublic: true },
    d.id,
    n,
  );
  return (p.contentId ?? p.projectId)!;
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: '.worker/publication-stops-test.js',
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
    }),
  );
  const db = await mf.getD1Database('DB');
  for (const file of readdirSync('migrations')
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const raw = readFileSync('migrations/' + file, 'utf8');
    const statements = (
      raw.includes('-- @statement') ? raw.split(/^-- @statement\s*$/m) : raw.split(/;\s*(?:\n|$)/)
    )
      .map((sql) => sql.replace(/^--.*$/gm, '').trim())
      .filter(Boolean);
    await db.batch(statements.map((sql) => db.prepare(sql)));
  }
  users = [];
  for (let n = 0; n < 5; n++) {
    await db
      .prepare(
        "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)",
      )
      .bind('account-' + n, 'subject-' + n, n + '@st.kobedenshi.ac.jp', NOW)
      .run();
    users.push(await login(n));
    await action(
      'profile',
      {
        displayName: 'Explicit author ' + n,
        department: 'Manual',
        yearLabel: 'Manual',
        bio: 'Public bio',
        confirmPublic: true,
      },
      undefined,
      n,
    );
  }
});
afterAll(async () => {
  await mf?.dispose();
});

const path = (kind: string, id: string) => PATH + '/' + kind + '/' + id;
async function state(kind: string, id: string, n = 0) {
  return (await (await req(n, {}, path(kind, id))).json()) as PublicationStopState;
}
async function stop(
  kind: string,
  id: string,
  n = 0,
  input: unknown = { expectedSourceVersion: 1, confirmStop: true },
  extra: Record<string, string> = {},
) {
  const r = await mf.dispatchFetch(O + path(kind, id), {
    method: 'POST',
    headers: { ...h(n), ...extra },
    body: JSON.stringify(input),
  });
  expect(r.headers.get('Cache-Control')).toBe('private, no-store');
  expect(r.headers.has('Set-Cookie')).toBe(false);
  return r;
}
it('atomically stops articles and projects once, keeping immutable snapshots and private receipts', async () => {
  for (const kind of ['article', 'project'] as const) {
    const id = await publish(kind, 'Owner stop ' + kind);
    expect(await state(kind, id)).toEqual({
      kind,
      publicId: id,
      sourceVersion: 1,
      status: 'published',
      stopped: false,
    });
    expect(await action('read-' + kind, {}, id)).not.toBeNull();
    const responses = await Promise.all(Array.from({ length: 12 }, () => stop(kind, id)));
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(await state(kind, id)).toEqual({
      kind,
      publicId: id,
      sourceVersion: 1,
      status: 'hidden',
      stopped: true,
    });
    expect(await action('read-' + kind, {}, id)).toBeNull();
    const db = await mf.getD1Database('DB');
    expect(
      (await db.prepare(`SELECT count(*) n FROM ${kind}_publication_stops`).first<{ n: number }>())!
        .n,
    ).toBe(1);
    expect((await stop(kind, id, 1)).status).toBe(404);
    expect((await stop(kind, id, 0, { expectedSourceVersion: 2, confirmStop: true })).status).toBe(
      404,
    );
    const table = kind === 'article' ? 'content' : 'project_publications';
    expect(
      (await db
        .prepare('SELECT title FROM ' + table + ' WHERE id=?')
        .bind(id)
        .first<{ title: string }>())!.title,
    ).toBe('Owner stop ' + kind);
  }
});
it('prevents status republish including INSERT OR REPLACE and rolls back failed hidden updates', async () => {
  const db = await mf.getD1Database('DB');
  for (const kind of ['article', 'project'] as const) {
    const id = await publish(kind, 'Rollback ' + kind),
      table = kind === 'article' ? 'content' : 'project_publications';
    await db
      .prepare(
        `CREATE TRIGGER fixture_ignore_stop BEFORE UPDATE OF status ON ${table} WHEN NEW.id='${id}' BEGIN SELECT RAISE(IGNORE); END`,
      )
      .run();
    try {
      expect((await stop(kind, id)).status).toBe(404);
      expect((await state(kind, id)).stopped).toBe(false);
      expect((await state(kind, id)).status).toBe('published');
    } finally {
      await db.prepare('DROP TRIGGER fixture_ignore_stop').run();
    }
    expect((await stop(kind, id)).status).toBe(200);
    await expect(
      db
        .prepare('UPDATE ' + table + " SET status='published' WHERE id=?")
        .bind(id)
        .run(),
    ).rejects.toThrow();
    await expect(
      db
        .prepare(
          `INSERT OR REPLACE INTO ${table} SELECT ${kind === 'article' ? "id,kind,title,summary,body,tags_json,author_id,audience,prerequisite,outcome,updated_at,minutes,related_ids_json,'published',is_sample" : "id,owner_account_id,draft_id,public_profile_id,source_version,title,description,github_url,demo_url,published_at_ms,'published'"} FROM ${table} WHERE id=?`,
        )
        .bind(id)
        .run(),
    ).rejects.toThrow();
    expect((await state(kind, id)).status).toBe('hidden');
  }
});
it('does not claim report-hidden articles as owner stops and preserves accepted reports/outbox when stopped', async () => {
  const hidden = await publish('article', 'Report hidden');
  for (let n = 1; n < 4; n++)
    expect(await action('article-report', { reason: 'report' }, hidden, n)).toEqual({
      received: true,
    });
  expect(await state('article', hidden)).toMatchObject({ status: 'hidden', stopped: false });
  expect((await stop('article', hidden)).status).toBe(404);
  const id = await publish('article', 'Stop after two');
  for (let n = 1; n < 3; n++) await action('article-report', { reason: 'existing report' }, id, n);
  const db = await mf.getD1Database('DB');
  const before = await db.prepare('SELECT count(*) n FROM article_report_outbox').first();
  expect((await stop('article', id)).status).toBe(200);
  expect(await action('article-report', { reason: 'third' }, id, 3)).toBeNull();
  expect(await db.prepare('SELECT count(*) n FROM article_report_outbox').first()).toEqual(before);
  expect(
    (await db
      .prepare('SELECT count(*) n FROM article_reports WHERE content_id=?')
      .bind(id)
      .first<{ n: number }>())!.n,
  ).toBe(2);
});
it('rejects malformed commands, missing/otherowner references, CSRF and unsupported transport', async () => {
  const id = await publish('project', 'Command validation');
  for (const input of [
    null,
    {},
    { expectedSourceVersion: 1, confirmStop: false },
    { expectedSourceVersion: 1, confirmStop: true, owner: 'account-1' },
    { expectedSourceVersion: 1.5, confirmStop: true },
  ])
    expect((await stop('project', id, 0, input)).status).toBe(404);
  expect((await stop('project', id, 1)).status).toBe(404);
  expect((await stop('project', crypto.randomUUID())).status).toBe(404);
  expect(
    (
      await stop('project', id, 0, undefined, {
        Authorization: 'Bearer csrf.' + users[1].csrfToken,
      })
    ).status,
  ).toBe(401);
  expect((await stop('project', id, 0, undefined, { 'Content-Type': 'text/plain' })).status).toBe(
    415,
  );
  expect((await req(0, {}, path('project', id) + '?PRIVATE=1')).status).toBe(404);
  expect((await req(0, {}, path('project', id), 'PUT')).headers.get('Allow')).toBe('GET, POST');
  expect(
    (await req(0, { 'X-Test-Origin': 'http://invalid.example' }, path('project', id))).status,
  ).toBe(503);
});
it('rejects changed browser generation before private publication stop state read', async () => {
  const id = await publish('project', 'Context guarded state');
  expect(
    (await req(0, { 'X-Test-Race': 'context', 'X-Test-Race-At': '2' }, path('project', id))).status,
  ).toBe(404);
  users[0] = await login(0);
  expect((await state('project', id)).stopped).toBe(false);
});
it('fails closed on storage and final authorization changes without stopping content', async () => {
  const id = await publish('project', 'Authorization race');
  expect((await req(0, { 'X-Test-Fault': '1' }, path('project', id))).status).toBe(404);
  expect((await stop('project', id, 0, undefined, { 'X-Test-Final-Race': '1' })).status).toBe(404);
  for (let n = 0; n < 5; n++) users[n] = await login(n);
  expect((await state('project', id)).status).toBe('published');
  for (const race of ['revoke', 'status', 'epoch', 'context']) {
    expect(
      (
        await stop('project', id, 0, undefined, {
          'X-Test-Race': race,
          ...(race === 'context' ? { 'X-Test-Race-At': '2' } : {}),
        })
      ).status,
    ).toBe(race === 'context' ? 404 : 401);
    const db = await mf.getD1Database('DB');
    await db.prepare("UPDATE private_accounts SET status='active'").run();
    for (let n = 0; n < 5; n++) users[n] = await login(n);
    expect((await state('project', id)).status).toBe('published');
  }
});
it('bounds stalled commands without a late stop', async () => {
  const id = await publish('project', 'Deadline');
  expect((await stop('project', id, 0, undefined, { 'X-Test-Body': 'empty' })).status).toBe(413);
  const start = Date.now();
  expect((await stop('project', id, 0, undefined, { 'X-Test-Body': 'late' })).status).toBe(408);
  expect(Date.now() - start).toBeLessThan(6500);
  await new Promise((r) => setTimeout(r, 700));
  expect((await state('project', id)).stopped).toBe(false);
}, 8000);
