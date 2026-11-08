import { beforeAll, afterAll, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { encode } from 'fast-png';
import { workerModules } from './helpers/worker-modules';
const O = 'https://app.example.invalid',
  NOW = 1800000000000;
type Session = { setCookie: string; contextCookie: string; csrfToken: string };
let mf: Miniflare,
  users: Session[] = [],
  legacy: string;
const h = (n = 0) => ({
  Cookie: [users[n].setCookie, users[n].contextCookie].map((v) => v.split(';')[0]).join('; '),
  Origin: O,
  Authorization: 'Bearer csrf.' + users[n].csrfToken,
  'Content-Type': 'application/json',
});
async function req(path: string, method = 'GET', input?: unknown, n = 0, extra = {}) {
  return mf.dispatchFetch(O + path, {
    method,
    headers: { ...h(n), ...extra },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
}
async function login(n: number) {
  users[n] = (await (
    await mf.dispatchFetch(O + '/fixture/session', { headers: { 'X-Test-Who': String(n) } })
  ).json()) as Session;
}
async function seed(image = false) {
  const imageId = crypto.randomUUID();
  let d = (await (
    await req('/api/private/project-drafts', 'POST', {
      title: 'Manual project ' + crypto.randomUUID(),
      description: '## Saved work\n\nPrivate implementation explanation',
      githubUrl: 'https://github.com/example/project',
      demoUrl: '',
    })
  ).json()) as { id: string; version: number };
  if (image) {
    const bytes = encode({
      width: 24,
      height: 16,
      channels: 4,
      data: new Uint8Array(24 * 16 * 4).fill(200),
    });
    const upload = await mf.dispatchFetch(O + `/api/private/media/projects/${d.id}/${imageId}`, {
      method: 'PUT',
      headers: { ...h(), 'Content-Type': 'image/png', 'If-Match': '"1"' },
      body: bytes,
    });
    expect(upload.status).toBe(201);
    d = (await (
      await req('/api/private/project-drafts/' + d.id, 'PUT', {
        expectedVersion: 1,
        title: 'Image project',
        description: '## Saved work\n\n![Operator-only snapshot](/api/media/' + imageId + ')',
        githubUrl: '',
        demoUrl: '',
      })
    ).json()) as typeof d;
  }
  const r = await req('/api/private/project-publications/' + d.id, 'POST', {
    expectedVersion: d.version,
    confirmPublic: true,
    ...(image ? { mediaIds: [imageId] } : {}),
  });
  expect(r.status).toBe(201);
  return {
    id: ((await r.json()) as { projectId: string }).projectId,
    imageId,
    sourceVersion: d.version,
  };
}
const state = (id: string) => '/api/private/project-moderation/review/' + id + '/decision';
const command = (
  version: number,
  action = 'hide',
  reason = 'Operator reason, not reporter content',
) => ({
  decisionId: crypto.randomUUID(),
  expectedRound: 1,
  expectedVersion: version,
  action,
  reason,
});
async function decision(id: string, c: unknown, n = 1, extra = {}) {
  return req(state(id), 'POST', c, n, extra);
}
async function report(id: string, n = 2) {
  expect(
    (
      await req(
        '/api/private/project-reports/' + id,
        'POST',
        { reason: 'Fictional issue', detail: 'Reporter private detail' },
        n,
      )
    ).status,
  ).toBe(201);
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: workerModules('.worker/project-moderation-test.js'),
      compatibilityDate: '2026-11-03',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: ['DB'],
      outboundService() {
        throw Error('unexpected outbound');
      },
    }),
  );
  const db = await mf.getD1Database('DB');
  for (const name of readdirSync('migrations')
    .filter((n) => n.endsWith('.sql') && !n.startsWith('0021'))
    .sort()) {
    const raw = readFileSync('migrations/' + name, 'utf8');
    for (const sql of (raw.includes('-- @statement')
      ? raw.split(/^-- @statement\s*$/m)
      : raw.split(/;\s*(?:\n|$)/)
    )
      .map((s) => s.replace(/^--.*$/gm, '').trim())
      .filter(Boolean))
      await db.prepare(sql).run();
  }
  for (let n = 0; n < 5; n++) {
    await db
      .prepare(
        "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)",
      )
      .bind('account-' + n, 'subject-' + n, n + '@st.kobedenshi.ac.jp', NOW)
      .run();
    await login(n);
  }
  expect(
    (
      await req('/api/private/profile', 'POST', {
        displayName: 'Explicit author',
        department: '',
        yearLabel: '',
        bio: '',
        confirmPublic: true,
      })
    ).status,
  ).toBe(201);
  legacy = (await seed()).id;
  await report(legacy);
  const before = (await db.prepare('SELECT * FROM project_reports ORDER BY id').all()).results;
  for (const sql of readFileSync('migrations/0021_project_moderation.sql', 'utf8')
    .split(/^-- @statement\s*$/m)
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean))
    await db.prepare(sql).run();
  expect((await db.prepare('SELECT * FROM project_reports ORDER BY id').all()).results).toEqual(
    before,
  );
});
afterAll(async () => {
  await mf?.dispose();
});
it('migrates accepted reports, passes trusted operators through ordinary dispatch, defaults deny and never auto-hides', async () => {
  for (const n of [0, 3, 4]) await report(legacy, n);
  const db = await mf.getD1Database('DB');
  expect(
    await db.prepare('SELECT status FROM project_publications WHERE id=?').bind(legacy).first(),
  ).toEqual({ status: 'published' });
  const r = await req(state(legacy), 'GET', undefined, 1);
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({
    round: 1,
    version: 4,
    status: 'published',
    reportCount: 4,
  });
  for (const [n, extra] of [
    [0, {}],
    [1, { 'X-Test-No-Operator': '1' }],
    [1, { 'X-Test-Closed': '1' }],
  ] as const)
    expect((await req(state(legacy), 'GET', undefined, n, extra)).status).toBe(404);
  const review = await req('/api/private/project-moderation/review/' + legacy, 'GET', undefined, 1);
  expect(review.status).toBe(200);
  expect(JSON.stringify(await review.json())).not.toMatch(/account-|subject-|@st.kobedenshi/);
});
it('manual hide/restore/delete use CAS, exact actor-bound receipts and owner-only explanations', async () => {
  const { id } = await seed();
  await report(id);
  const c = command(1);
  const r = await decision(id, c);
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({
    action: 'hide',
    resultStatus: 'hidden',
    resultVersion: 2,
    resultRound: 1,
  });
  expect((await decision(id, c)).status).toBe(200);
  expect((await decision(id, { ...c, reason: 'Different reason' })).status).toBe(404);
  expect((await decision(id, command(1, 'delete'))).status).toBe(404);
  expect((await req('/api/projects/' + id)).status).toBe(404);
  expect(JSON.stringify(await (await req('/api/projects')).json())).not.toContain(id);
  const owner = (await (await req('/api/private/notifications')).json()) as {
    id: string;
    reason: string;
  }[];
  expect(owner).toContainEqual(
    expect.objectContaining({ id: 'project.' + c.decisionId, reason: c.reason }),
  );
  expect(await (await req('/api/private/notifications', 'GET', undefined, 2)).json()).toEqual([]);
  expect(
    (
      await req(
        '/api/private/project-moderation/review/' + id + '/decisions/' + c.decisionId,
        'GET',
        undefined,
        2,
      )
    ).status,
  ).toBe(404);
  expect((await decision(id, command(2, 'restore'))).status).toBe(200);
  expect((await req('/api/projects/' + id)).status).toBe(200);
  expect((await decision(id, command(3, 'delete'))).status).toBe(200);
  expect((await decision(id, command(4, 'restore'))).status).toBe(404);
  expect((await req('/api/projects/' + id)).status).toBe(404);
  const db = await mf.getD1Database('DB');
  expect(
    (await db
      .prepare('SELECT COUNT(*) n FROM project_reports WHERE project_id=?')
      .bind(id)
      .first<{ n: number }>())!.n,
  ).toBe(1);
});
it('owner stop wins over restore and revocation at the final write cannot commit', async () => {
  const { id, sourceVersion } = await seed();
  await report(id);
  expect(
    (
      await req('/api/private/publication-stops/project/' + id, 'POST', {
        expectedSourceVersion: sourceVersion,
        confirmStop: true,
      })
    ).status,
  ).toBe(200);
  expect((await decision(id, command(2, 'restore'))).status).toBe(404);
  const fresh = await seed();
  await report(fresh.id);
  expect((await decision(fresh.id, command(1), 1, { 'X-Test-Revoke': '1' })).status).toBe(404);
  await login(1);
  expect(await (await req(state(fresh.id), 'GET', undefined, 1)).json()).toMatchObject({
    version: 1,
    status: 'published',
  });
});
it('hidden snapshot images are private to the current operator and never grant unrelated images', async () => {
  const { id, imageId } = await seed(true);
  await report(id);
  const path = '/api/private/moderation-media/projects/' + id + '/' + imageId;
  expect((await decision(id, command(1))).status).toBe(200);
  expect((await req('/api/media/' + imageId)).status).toBe(404);
  expect((await req('/api/private/media/' + imageId, 'GET', undefined, 1)).status).toBe(404);
  for (const n of [0, 2]) expect((await req(path, 'GET', undefined, n)).status).toBe(404);
  const image = await req(path, 'GET', undefined, 1);
  expect(image.status).toBe(200);
  expect(image.headers.get('Content-Type')).toBe('image/png');
  expect(image.headers.get('Cache-Control')).toBe('private, no-store');
  expect((await image.arrayBuffer()).byteLength).toBeGreaterThan(0);
  expect((await req(path + '?x=1', 'GET', undefined, 1)).status).toBe(404);
  expect((await req(path, 'POST', {}, 1)).status).toBe(405);
  const other = await seed(true);
  expect(
    (
      await req(
        '/api/private/moderation-media/projects/' + id + '/' + other.imageId,
        'GET',
        undefined,
        1,
      )
    ).status,
  ).toBe(404);
  expect((await decision(id, command(2, 'delete'))).status).toBe(200);
  expect((await req('/api/media/' + imageId)).status).toBe(404);
  expect((await req(path, 'GET', undefined, 1)).status).toBe(200);
});
it('requires CSRF and rejects malformed decisions without changing the case', async () => {
  const { id } = await seed();
  await report(id);
  for (const c of [
    command(1, 'restore'),
    { ...command(1), expectedRound: 2 },
    { ...command(1), reason: ' ' },
    { ...command(1), extra: true },
    { ...command(1), expectedVersion: 0 },
  ])
    expect((await decision(id, c)).status).toBe(404);
  expect((await decision(id, command(1), 1, { Authorization: '' })).status).toBe(401);
  expect((await req(state(id) + '?x=1', 'GET', undefined, 1)).status).toBe(404);
  expect((await req(state(id), 'PUT', {}, 1)).status).toBe(405);
  expect(await (await req(state(id), 'GET', undefined, 1)).json()).toMatchObject({
    version: 1,
    status: 'published',
  });
});

it('article hidden images use the same operator projection without weakening owner or public reads', async () => {
  const db = await mf.getD1Database('DB');
  const image = crypto.randomUUID();
  const draft = (await (
    await req('/api/private/drafts', 'POST', {
      title: 'Reported article with image',
      body: '## Image',
    })
  ).json()) as { id: string };
  const bytes = encode({
    width: 16,
    height: 16,
    channels: 4,
    data: new Uint8Array(16 * 16 * 4).fill(180),
  });
  expect(
    (
      await mf.dispatchFetch(O + '/api/private/media/articles/' + draft.id + '/' + image, {
        method: 'PUT',
        headers: { ...h(), 'Content-Type': 'image/png', 'If-Match': '"1"' },
        body: bytes,
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await req('/api/private/drafts/' + draft.id, 'PUT', {
        expectedVersion: 1,
        title: 'Reported article with image',
        body: '![Operator image](/api/media/' + image + ')',
      })
    ).status,
  ).toBe(200);
  const pub = await req('/api/private/publications/' + draft.id, 'POST', {
    expectedVersion: 2,
    confirmPublic: true,
    summary: 'Image snapshot',
    tags: [],
    minutes: 1,
    mediaIds: [image],
  });
  expect(pub.status).toBe(201);
  const article = ((await pub.json()) as { contentId: string }).contentId;
  for (const n of [2, 3, 4])
    expect(
      (
        await req(
          '/api/private/reports/' + article,
          'POST',
          { reason: 'Check image', detail: '' },
          n,
        )
      ).status,
    ).toBe(200);
  const path = '/api/private/moderation-media/articles/' + article + '/' + image;
  expect((await req('/api/media/' + image)).status).toBe(404);
  expect((await req(path, 'GET', undefined, 1)).status).toBe(200);
  expect((await req(path, 'GET', undefined, 2)).status).toBe(404);
  await db.prepare("UPDATE private_accounts SET status='suspended' WHERE id='account-1'").run();
  expect((await req(path, 'GET', undefined, 1)).status).toBe(401);
  await db.prepare("UPDATE private_accounts SET status='active' WHERE id='account-1'").run();
  await login(1);
});
