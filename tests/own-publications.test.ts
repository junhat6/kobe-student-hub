import { beforeAll, afterAll, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import type { OwnPublications } from '../src/own-publication-types';
const O = 'https://app.example.invalid',
  NOW = 1800000000000,
  PATH = '/api/private/own-publications';
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
async function list(n = 0) {
  return (await (await req(n)).json()) as OwnPublications;
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
      scriptPath: '.worker/own-publications-test.js',
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
    }),
  );
  const db = await mf.getD1Database('DB');
  for (const file of readdirSync('migrations')
    .filter((f) => /^00(?:0[1-9]|10)_/.test(f))
    .sort())
    for (const sql of readFileSync('migrations/' + file, 'utf8')
      .replace(/^--.*$/gm, '')
      .split(/;\s*(?:\n|$)/)
      .filter((s) => s.trim()))
      await db.prepare(sql).run();
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
it('returns authorized genuine empty and no other owner records or private fields', async () => {
  expect(await list()).toEqual({ publications: [], moreExists: false });
  const id = await publish('article', 'Other owner article', 1);
  expect(await list()).toEqual({ publications: [], moreExists: false });
  const r = await list(1);
  expect(r.publications).toEqual([
    {
      kind: 'article',
      publicId: id,
      title: 'Other owner article',
      status: 'published',
      publishedAt: NOW,
      sourceVersion: 1,
    },
  ]);
  for (const x of [
    'account-1',
    'subject-1',
    'draft',
    'profile',
    'reason',
    'count',
    'outbox',
    'email',
    'reporter',
  ])
    expect(JSON.stringify(r)).not.toContain(x);
});
it('reads actual article three-report hiding and project multiple-report non-hiding as stored states', async () => {
  const article = await publish('article', 'Article report state'),
    project = await publish('project', 'Project report state');
  for (let n = 1; n < 4; n++)
    expect(await action('article-report', { reason: 'Plain report' }, article, n)).toEqual({
      received: true,
    });
  for (let n = 1; n < 5; n++)
    expect(await action('project-report', { reason: 'Plain project report' }, project, n)).toEqual({
      received: true,
    });
  expect((await list()).publications).toEqual([
    {
      kind: 'article',
      publicId: article,
      title: 'Article report state',
      status: 'hidden',
      publishedAt: NOW,
      sourceVersion: 1,
    },
    {
      kind: 'project',
      publicId: project,
      title: 'Project report state',
      status: 'published',
      publishedAt: NOW,
      sourceVersion: 1,
    },
  ]);
  const db = await mf.getD1Database('DB');
  await db
    .prepare("UPDATE project_publications SET status='deleted' WHERE id=?")
    .bind(project)
    .run();
  expect((await list()).publications.find((r) => r.publicId === project)?.status).toBe('deleted');
  await db.prepare("DELETE FROM project_drafts WHERE owner_account_id='account-0'").run();
  expect((await list()).publications.find((r) => r.publicId === project)?.status).toBe('deleted');
});
it('combines newest20 with deterministic cross-kind ties and validates explicit moreExists', async () => {
  const ids: { id: string; kind: 'article' | 'project'; time: number }[] = [];
  const db = await mf.getD1Database('DB');
  for (let n = 0; n < 21; n++) {
    const kind = n % 2 ? 'project' : 'article',
      id = await publish(kind, 'Bounded ' + n, 2),
      time = NOW - Math.floor(n / 2);
    await db
      .prepare(
        `UPDATE ${kind === 'article' ? 'article_publications' : 'project_publications'} SET published_at_ms=? WHERE ${kind === 'article' ? 'content_id' : 'id'}=?`,
      )
      .bind(time, id)
      .run();
    ids.push({ id, kind, time });
  }
  const expected = ids.sort(
    (a, b) => b.time - a.time || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
  );
  const r = await list(2);
  expect(r.moreExists).toBe(true);
  expect(r.publications.map((p) => p.publicId)).toEqual(expected.slice(0, 20).map((p) => p.id));
  expect(new TextEncoder().encode(JSON.stringify(r)).length).toBeLessThan(65536);
  const last = expected[20];
  await db
    .prepare(
      `UPDATE ${last.kind === 'article' ? 'content' : 'project_publications'} SET title=? WHERE id=?`,
    )
    .bind('bad\0title', last.id)
    .run();
  expect((await req(2)).status).toBe(503);
  await db
    .prepare(
      `UPDATE ${last.kind === 'article' ? 'content' : 'project_publications'} SET title=? WHERE id=?`,
    )
    .bind('Restored', last.id)
    .run();
  const project = expected.find((r) => r.kind === 'project')!;
  await db
    .prepare('UPDATE project_publications SET id=? WHERE id=?')
    .bind(project.id.toUpperCase(), project.id)
    .run();
  expect((await req(2)).status).toBe(503);
  await db
    .prepare('UPDATE project_publications SET id=? WHERE id=?')
    .bind(project.id, project.id.toUpperCase())
    .run();
});
it('fails closed on malformed linkage, titles and storage, without hiding own records because profile changes', async () => {
  const db = await mf.getD1Database('DB'),
    id = await publish('article', 'Legacy validation', 3);
  for (const mutation of [
    "kind='project'",
    'is_sample=1',
    "title='   '",
    "title='" + 'x'.repeat(201) + "'",
  ]) {
    await db
      .prepare('UPDATE content SET ' + mutation + ' WHERE id=?')
      .bind(id)
      .run();
    expect((await req(3)).status).toBe(503);
    await db
      .prepare("UPDATE content SET kind='article',is_sample=0,title='Legacy validation' WHERE id=?")
      .bind(id)
      .run();
  }
  await db.prepare("DELETE FROM account_public_profiles WHERE owner_account_id='account-3'").run();
  expect((await list(3)).publications).toHaveLength(1);
  expect((await req(3, { 'X-Test-Fault': '1' })).status).toBe(503);
});
it('requires current real session and final live authorization after initial proof', async () => {
  expect((await req(0, { Cookie: '' })).status).toBe(401);
  expect((await req(0, { 'X-Test-Now': String(NOW + 1800000) })).status).toBe(401);
  expect((await req(4, { 'X-Test-Final-Race': '1' })).status).toBe(503);
  for (let n = 0; n < 5; n++) users[n] = await login(n);
  for (const race of ['revoke', 'status', 'epoch', 'context']) {
    expect(
      (
        await req(4, {
          'X-Test-Race': race,
          ...(race === 'context' ? { 'X-Test-Race-At': '2' } : {}),
        })
      ).status,
    ).toBe(503);
    const db = await mf.getD1Database('DB');
    await db.prepare("UPDATE private_accounts SET status='active'").run();
    for (let n = 0; n < 5; n++) users[n] = await login(n);
  }
});
it('rejects nonexact paths, queries, methods and invalid origins with private errors', async () => {
  for (const p of [PATH + '/', PATH + '?PRIVATE=1', PATH + '/bad'])
    expect((await req(0, {}, p)).status).toBe(404);
  const r = await req(0, {}, PATH, 'POST');
  expect(r.status).toBe(405);
  expect(r.headers.get('Allow')).toBe('GET');
  expect((await req(0, { 'X-Test-Origin': 'http://invalid.example' })).status).toBe(503);
  expect((await req(0, {}, '/other')).status).toBe(418);
});
