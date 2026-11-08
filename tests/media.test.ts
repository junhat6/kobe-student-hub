import { afterAll, beforeAll, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { encode as pngEncode, decode as pngDecode } from 'fast-png';
import jpeg from 'jpeg-js';
import { workerModules } from './helpers/worker-modules';
import type { PrivateDraft } from '../worker/drafts';
import type { MediaReceipt } from '../src/shared/media';
const O = 'https://app.example.invalid',
  NOW = 1800000000000;
type Session = { setCookie: string; contextCookie: string; csrfToken: string };
let mf: Miniflare,
  users: Session[] = [];
const png = pngEncode({
  width: 32,
  height: 24,
  data: new Uint8Array(32 * 24 * 4).fill(180),
  channels: 4,
});
const jpg = jpeg.encode(
  { width: 32, height: 24, data: new Uint8Array(32 * 24 * 4).fill(180) },
  75,
).data;
const id = () => crypto.randomUUID();
const h = (n = 0) => ({
  Cookie: [users[n].setCookie, users[n].contextCookie].map((s) => s.split(';')[0]).join('; '),
  Origin: O,
  Authorization: 'Bearer csrf.' + users[n].csrfToken,
});
async function call<T>(path: string, input: unknown, n = 0): Promise<T> {
  return (await (
    await mf.dispatchFetch(O + '/fixture/' + path, {
      method: 'POST',
      headers: { ...h(n), 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  ).json()) as T;
}
const draft = (body = '# Saved body') =>
  call<PrivateDraft>('draft', { title: 'Saved image article', body });
async function upload(d: PrivateDraft, image = id(), bytes: Uint8Array = png, n = 0, extra = {}) {
  return mf.dispatchFetch(O + `/api/private/media/articles/${d.id}/${image}`, {
    method: 'PUT',
    headers: { ...h(n), 'If-Match': `"${d.version}"`, 'Content-Type': 'image/png', ...extra },
    body: bytes,
  });
}
const publication = (d: PrivateDraft, ids: string[] = []) =>
  call<{ contentId: string } | null>('article-publish', {
    id: d.id,
    input: {
      expectedVersion: d.version,
      confirmPublic: true,
      summary: 'Image overview',
      tags: [],
      minutes: 1,
      mediaIds: ids,
    },
  });
const publicRead = (image: string, extra = {}) =>
  mf.dispatchFetch(O + '/api/media/' + image, { headers: extra });
const ownRead = (image: string, n = 0) =>
  mf.dispatchFetch(O + '/api/private/media/' + image, { headers: h(n) });
function security(r: { headers: Pick<Headers, 'get' | 'has'> }) {
  expect(r.headers.get('Cache-Control')).toBe('private, no-store');
  expect(r.headers.get('Referrer-Policy')).toBe('no-referrer');
  expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
  for (const key of ['Set-Cookie', 'Location', 'Access-Control-Allow-Origin'])
    expect(r.headers.has(key)).toBe(false);
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: workerModules('.worker/media-test.js'),
      compatibilityDate: '2026-11-03',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: ['DB'],
      outboundService() {
        throw Error('Unexpected outbound');
      },
    }),
  );
  const db = await mf.getD1Database('DB');
  for (const file of readdirSync('migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const raw = readFileSync('migrations/' + file, 'utf8');
    for (const sql of (raw.includes('-- @statement')
      ? raw.split(/^-- @statement\s*$/m)
      : raw.split(/;\s*(?:\n|$)/)
    )
      .map((s) => s.replace(/^--.*$/gm, '').trim())
      .filter(Boolean))
      await db.prepare(sql).run();
  }
  for (let n = 0; n < 4; n++) {
    await db
      .prepare(
        "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)",
      )
      .bind('account-' + n, 'subject-' + n, n + '@st.kobedenshi.ac.jp', NOW)
      .run();
    users.push(
      (await (
        await mf.dispatchFetch(O + '/fixture/session', { headers: { 'X-Test-Who': String(n) } })
      ).json()) as Session,
    );
  }
  await db
    .prepare(
      "INSERT INTO public_profiles(id,display_name,department,year_label,bio,initials,is_sample) VALUES('image-author','公開表示名','','','','画',0)",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO account_public_profiles(owner_account_id,public_profile_id) VALUES('account-0','image-author')",
    )
    .run();
});
afterAll(async () => {
  await mf?.dispose();
});
it('removes old private orphans during bounded cleanup while retaining draft references and immutable snapshot grants', async () => {
  const source = id(),
    seed = await draft();
  expect((await upload(seed, source)).status).toBe(201);
  const orphan = id(),
    referenced = id(),
    published = id(),
    d1 = await draft(),
    d2 = await draft(`/api/media/${referenced}`),
    d3 = await draft(`/api/media/${published}`),
    db = await mf.getD1Database('DB');
  for (const [asset, d] of [
    [orphan, d1],
    [referenced, d2],
    [published, d3],
  ] as const)
    await db
      .prepare(
        'INSERT INTO media_assets(id,owner_account_id,article_draft_id,mime,width,height,payload,sha256,created_at_ms) SELECT ?,owner_account_id,?,mime,width,height,payload,sha256,? FROM media_assets WHERE id=?',
      )
      .bind(asset, d.id, NOW - 2 * 86400000, source)
      .run();
  const p = (await publication(d3, [published]))!;
  expect(p).not.toBeNull();
  await expect(
    db
      .prepare("UPDATE media_assets SET owner_account_id='account-1' WHERE id=?")
      .bind(orphan)
      .run(),
  ).rejects.toThrow();
  await expect(
    db
      .prepare("UPDATE article_publications SET media_ids_json='[]' WHERE content_id=?")
      .bind(p.contentId)
      .run(),
  ).rejects.toThrow();
  await expect(
    db.prepare('DELETE FROM article_publication_media WHERE content_id=?').bind(p.contentId).run(),
  ).rejects.toThrow();
  expect((await upload(seed)).status).toBe(201);
  expect((await ownRead(orphan)).status).toBe(404);
  expect((await ownRead(referenced)).status).toBe(200);
  expect((await publicRead(published)).status).toBe(200);
  expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
});
it('keeps source-closed media paths completely unhandled with zero DB work', async () => {
  for (const path of [
    '/api/media/' + id(),
    '/api/private/media/' + id(),
    '/api/private/media/articles/' + id() + '/' + id(),
  ]) {
    const r = await mf.dispatchFetch(O + path, { headers: { 'X-Test-Closed': '1' } });
    expect(await r.json()).toEqual({ unhandled: true, queries: 0 });
  }
});
it('uploads validated private bytes, emits bounded metadata and never anonymously falls back using owner cookies', async () => {
  const d = await draft(),
    image = id(),
    r = await upload(d, image);
  expect(r.status).toBe(201);
  security(r);
  expect(await r.json()).toEqual({
    id: image,
    mime: 'image/png',
    width: 32,
    height: 24,
    bytes: png.length,
  });
  const own = await ownRead(image);
  expect(own.status).toBe(200);
  expect(new Uint8Array(await own.arrayBuffer())).toEqual(png);
  security(own);
  expect((await ownRead(image, 1)).status).toBe(404);
  expect((await publicRead(image, h())).status).toBe(404);
  expect((await publicRead(image)).status).toBe(404);
  const list = await mf.dispatchFetch(O + '/api/private/media/articles/' + d.id, { headers: h() });
  expect(await list.json()).toEqual({
    images: [{ id: image, mime: 'image/png', width: 32, height: 24, bytes: png.length }],
  });
});
it('requires explicit attachment grant in saved publication; private edits never change snapshot bytes', async () => {
  const image = id(),
    d = await draft(`Saved ![diagram](/api/media/${image})`);
  expect((await upload(d, image)).status).toBe(201);
  expect(await publication(d, [id()])).toBeNull();
  expect((await publicRead(image)).status).toBe(404);
  const p = await publication(d, [image]);
  expect(p).not.toBeNull();
  const r = await publicRead(image);
  expect(r.status).toBe(200);
  security(r);
  expect(r.headers.has('Vary')).toBe(false);
  expect(new Uint8Array(await r.arrayBuffer())).toEqual(png);
  expect(await publication(d, [])).toBeNull();
  expect(await publication(d, [image])).toEqual(p);
  const db = await mf.getD1Database('DB');
  await db
    .prepare('UPDATE private_article_drafts SET body=?,version=version+1 WHERE id=?')
    .bind('private later body', d.id)
    .run();
  expect((await publicRead(image)).status).toBe(200);
  expect(
    (await mf.dispatchFetch(O + '/api/private/media/' + image, { method: 'DELETE', headers: h() }))
      .status,
  ).toBe(404);
  await db.prepare('DELETE FROM private_article_drafts WHERE id=?').bind(d.id).run();
  expect((await publicRead(image)).status).toBe(200);
});
it('checks current visibility for every fresh read including three-report hide, restore and soft delete', async () => {
  const image = id(),
    d = await draft(`![image](/api/media/${image})`);
  await upload(d, image);
  const p = (await publication(d, [image]))!;
  const db = await mf.getD1Database('DB');
  for (let n = 1; n <= 3; n++)
    await call(
      'report',
      { id: p.contentId, input: { reason: 'review', detail: 'Synthetic report' } },
      n,
    );
  expect((await publicRead(image)).status).toBe(404);
  expect((await ownRead(image)).status).toBe(200);
  await db.prepare("UPDATE content SET status='published' WHERE id=?").bind(p.contentId).run();
  expect((await publicRead(image)).status).toBe(200);
  await db.prepare("UPDATE content SET status='deleted' WHERE id=?").bind(p.contentId).run();
  expect((await publicRead(image)).status).toBe(404);
  expect(
    (await db
      .prepare('SELECT count(*) n FROM article_reports WHERE content_id=?')
      .bind(p.contentId)
      .first<{ n: number }>())!.n,
  ).toBe(3);
});
it('owner stop immediately denies article and project images and cannot be bypassed using cookies', async () => {
  const image = id(),
    d = await draft(`![image](/api/media/${image})`);
  await upload(d, image);
  const p = (await publication(d, [image]))!;
  expect(
    await call('stop', {
      kind: 'article',
      id: p.contentId,
      input: { expectedSourceVersion: 1, confirmStop: true },
    }),
  ).not.toBeNull();
  expect((await publicRead(image, h())).status).toBe(404);
  const projectImage = id(),
    project = await call<{ id: string; version: number }>('project-draft', {
      title: 'Image project',
      description: `![screen](/api/media/${projectImage})`,
      githubUrl: '',
      demoUrl: '',
    });
  const up = await mf.dispatchFetch(
    O + `/api/private/media/projects/${project.id}/${projectImage}`,
    {
      method: 'PUT',
      headers: { ...h(), 'Content-Type': 'image/png', 'If-Match': '"1"' },
      body: png,
    },
  );
  expect(up.status).toBe(201);
  const pp = await call<{ projectId: string }>('project-publish', {
    id: project.id,
    input: { expectedVersion: 1, confirmPublic: true, mediaIds: [projectImage] },
  });
  expect(pp).not.toBeNull();
  expect((await publicRead(projectImage)).status).toBe(200);
  await call('stop', {
    kind: 'project',
    id: pp.projectId,
    input: { expectedSourceVersion: 1, confirmStop: true },
  });
  expect((await publicRead(projectImage)).status).toBe(404);
});
it('requires current owner, CSRF, enrollment and saved version before reading upload bytes', async () => {
  const d = await draft();
  for (const extra of [
    { Origin: 'https://other.example.invalid' },
    { Authorization: '' },
    { 'If-Match': '"2"' },
    { 'Sec-Fetch-Site': 'cross-site' },
  ])
    expect((await upload(d, id(), png, 0, extra)).status).toBe(404);
  expect((await upload(d, id(), png, 1)).status).toBe(404);
  const r = await mf.dispatchFetch(O + `/api/private/media/articles/${d.id}/${id()}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/png', 'If-Match': '"1"' },
    body: png,
  });
  expect(r.status).toBe(404);
  const db = await mf.getD1Database('DB');
  const saved = (await db
    .prepare("SELECT * FROM private_enrollment_periods WHERE owner_account_id='account-0'")
    .first())!;
  await db
    .prepare("DELETE FROM private_enrollment_periods WHERE owner_account_id='account-0'")
    .run();
  expect((await upload(d)).status).toBe(404);
  await db
    .prepare(
      'INSERT INTO private_enrollment_periods(' +
        Object.keys(saved).join(',') +
        ') VALUES(' +
        Object.keys(saved)
          .map(() => '?')
          .join(',') +
        ')',
    )
    .bind(...Object.values(saved))
    .run();
});
it('makes duplicate upload IDs immutable/idempotent and closes final authorization races', async () => {
  const d = await draft(),
    image = id();
  const results = await Promise.all(Array.from({ length: 4 }, () => upload(d, image)));
  expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
  const other = pngEncode({ width: 3, height: 2, data: new Uint8Array(24).fill(200), channels: 4 });
  expect((await upload(d, image, other)).status).toBe(404);
  expect((await upload(d, id(), png, 0, { 'X-Test-Race': '1' })).status).toBe(404);
  const db = await mf.getD1Database('DB');
  await db.prepare("UPDATE private_accounts SET status='active' WHERE id='account-0'").run();
  users[0] = (await (
    await mf.dispatchFetch(O + '/fixture/session', { headers: { 'X-Test-Who': '0' } })
  ).json()) as Session;
  expect(
    (await db
      .prepare('SELECT count(*) n FROM media_assets WHERE article_draft_id=?')
      .bind(d.id)
      .first<{ n: number }>())!.n,
  ).toBe(1);
});
it('bounds transport, method, identifiers, query/hash and explicitly rejects active/unsupported formats', async () => {
  const d = await draft();
  expect(
    (await upload(d, id(), new Uint8Array(524289), 0, { 'X-Test-Transport': '1' })).status,
  ).toBe(413);
  for (const [bytes, type, status] of [
    [new TextEncoder().encode('<svg/>'), 'image/svg+xml', 415],
    [png, 'text/plain', 415],
    [new Uint8Array([1, 2, 3]), 'image/png', 404],
  ] as const)
    expect((await upload(d, id(), bytes, 0, { 'Content-Type': type })).status).toBe(status);
  for (const path of [
    '/api/media/' + id() + '?x=1',
    '/api/media/' + id() + '#private',
    '/api/media/%2e%2e',
    '/api/private/media/articles/' + d.id + '?x=1',
  ])
    expect((await mf.dispatchFetch(O + path, { headers: h() })).status).toBe(404);
  const r = await mf.dispatchFetch(O + '/api/media/' + id(), { method: 'POST' });
  expect(r.status).toBe(405);
  expect(r.headers.get('Allow')).toBe('GET');
});
it('enforces atomic per-draft and owner quotas and allows removal only after removing private references', async () => {
  const d = await draft();
  for (let n = 0; n < 8; n++) expect((await upload(d)).status).toBe(201);
  expect((await upload(d)).status).toBe(404);
  const image = id(),
    linked = await draft(`![keep](/api/media/${image})`);
  await upload(linked, image);
  expect(
    (await mf.dispatchFetch(O + '/api/private/media/' + image, { method: 'DELETE', headers: h() }))
      .status,
  ).toBe(404);
  const db = await mf.getD1Database('DB');
  await db
    .prepare('UPDATE private_article_drafts SET body=? WHERE id=?')
    .bind('removed', linked.id)
    .run();
  expect(
    (await mf.dispatchFetch(O + '/api/private/media/' + image, { method: 'DELETE', headers: h() }))
      .status,
  ).toBe(200);
  expect((await ownRead(image)).status).toBe(404);
});
it('strips PNG ancillary data/EXIF JPEG comments and validates actual pixels rather than accepting signatures', async () => {
  function crc(bytes: Uint8Array) {
    let n = 0xffffffff;
    for (const b of bytes) {
      n ^= b;
      for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    }
    return (n ^ 0xffffffff) >>> 0;
  }
  const text = new TextEncoder().encode('tEXtGPS\0private-location'),
    chunk = new Uint8Array(text.length + 8),
    view = new DataView(chunk.buffer);
  view.setUint32(0, text.length - 4);
  chunk.set(text, 4);
  view.setUint32(chunk.length - 4, crc(text));
  const marked = new Uint8Array(png.length + chunk.length);
  marked.set(png.subarray(0, 33));
  marked.set(chunk, 33);
  marked.set(png.subarray(33), 33 + chunk.length);
  const result = await mf.dispatchFetch(O + '/fixture/codec', {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: marked,
  });
  expect(result.status).toBe(200);
  const normalized = new Uint8Array(await result.arrayBuffer());
  expect(new TextDecoder().decode(normalized)).not.toContain('private-location');
  expect(pngDecode(normalized).data.length).toBe(32 * 24 * 4);
  const comment = new TextEncoder().encode('private-comment'),
    jpegMarked = new Uint8Array(jpg.length + comment.length + 4);
  jpegMarked.set(jpg.subarray(0, 2));
  jpegMarked.set([255, 254, 0, comment.length + 2], 2);
  jpegMarked.set(comment, 6);
  jpegMarked.set(jpg.subarray(2), 6 + comment.length);
  const jr = await mf.dispatchFetch(O + '/fixture/codec', {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' },
    body: jpegMarked,
  });
  expect(jr.status).toBe(200);
  expect(new TextDecoder().decode(await jr.arrayBuffer())).not.toContain('private-comment');
  const corrupt = png.slice();
  corrupt[corrupt.length - 5] ^= 1;
  for (const bytes of [
    png.subarray(0, 40),
    corrupt,
    new Uint8Array([...png, 0]),
    new Uint8Array([...jpg, 0]),
  ]) {
    const r = await mf.dispatchFetch(O + '/fixture/codec', {
      method: 'POST',
      headers: { 'Content-Type': bytes[0] === 137 ? 'image/png' : 'image/jpeg' },
      body: bytes,
    });
    expect(r.status).toBe(415);
  }
});
it('rejects EXIF orientation-changing raw JPEG and decoded-size PNG bombs while retaining metadata-free pixels', async () => {
  const exif = (orientation: number) => {
    const app = new Uint8Array(32),
      view = new DataView(app.buffer);
    app.set([69, 120, 105, 102, 0, 0, 73, 73]);
    view.setUint16(8, 42, true);
    view.setUint32(10, 8, true);
    view.setUint16(14, 1, true);
    view.setUint16(16, 274, true);
    view.setUint16(18, 3, true);
    view.setUint32(20, 1, true);
    view.setUint16(24, orientation, true);
    const result = new Uint8Array(jpg.length + app.length + 4);
    result.set(jpg.subarray(0, 2));
    result.set([255, 225, 0, app.length + 2], 2);
    result.set(app, 6);
    result.set(jpg.subarray(2), 6 + app.length);
    return result;
  };
  expect(
    (
      await mf.dispatchFetch(O + '/fixture/codec', {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: exif(6),
      })
    ).status,
  ).toBe(415);
  const good = await mf.dispatchFetch(O + '/fixture/codec', {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' },
    body: exif(1),
  });
  expect(good.status).toBe(200);
  expect(new TextDecoder().decode(await good.arrayBuffer())).not.toContain('Exif');
  const tiny = png.slice(),
    view = new DataView(tiny.buffer);
  view.setUint32(16, 1);
  view.setUint32(20, 1);
  let crc = 0xffffffff;
  for (const byte of tiny.subarray(12, 29)) {
    crc ^= byte;
    for (let b = 0; b < 8; b++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  view.setUint32(29, (crc ^ 0xffffffff) >>> 0);
  expect(
    (
      await mf.dispatchFetch(O + '/fixture/codec', {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: tiny,
      })
    ).status,
  ).toBe(415);
});
it('rejects trailing compressed payload and costly high-resolution PNG containers before publication', async () => {
  const bytes = png.slice(),
    view = new DataView(bytes.buffer);
  let offset = 8;
  while (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) !== 'IDAT')
    offset += view.getUint32(offset) + 12;
  const length = view.getUint32(offset),
    extra = new Uint8Array(bytes.length + 3),
    end = offset + 8 + length;
  extra.set(bytes.subarray(0, end));
  extra.set([1, 2, 3], end);
  extra.set(bytes.subarray(end), end + 3);
  new DataView(extra.buffer).setUint32(offset, length + 3);
  let crc = 0xffffffff;
  for (const byte of extra.subarray(offset + 4, end + 3)) {
    crc ^= byte;
    for (let b = 0; b < 8; b++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  new DataView(extra.buffer).setUint32(end + 3, (crc ^ 0xffffffff) >>> 0);
  expect(
    (
      await mf.dispatchFetch(O + '/fixture/codec', {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: extra,
      })
    ).status,
  ).toBe(415);
  const data = new Uint8Array(1000 * 800 * 4);
  let seed = 917;
  for (let p = 0; p < 800000; p++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    for (let c = 0; c < 3; c++) data[p * 4 + c] = p % 16 === 0 ? (seed >>> (8 * c)) & 255 : 235;
    data[p * 4 + 3] = 255;
  }
  const complex = pngEncode({ width: 1000, height: 800, data, channels: 4 });
  expect(complex.length).toBeGreaterThan(65536);
  expect(complex.length).toBeLessThan(524288);
  expect(
    (
      await mf.dispatchFetch(O + '/fixture/codec', {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: complex,
      })
    ).status,
  ).toBe(415);
});
it('enforces owner byte quotas and the global byte ceiling atomically in actual D1 triggers', async () => {
  const db = await mf.getD1Database('DB'),
    owners: string[] = [];
  try {
    let rejected = false;
    for (let owner = 0; owner < 9 && !rejected; owner++) {
      const account = 'quota-account-' + owner;
      owners.push(account);
      await db
        .prepare(
          "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)",
        )
        .bind(account, 'quota-subject-' + owner, 'quota-' + owner + '@st.kobedenshi.ac.jp', NOW)
        .run();
      const drafts = [id(), id(), id()];
      for (const d of drafts)
        await db
          .prepare('INSERT INTO private_article_drafts VALUES(?,?,?, ?,1,?)')
          .bind(d, account, 'Quota fixture', 'Unreferenced fixture', NOW)
          .run();
      const insert = (draftId: string) =>
        db
          .prepare(
            "INSERT INTO media_assets(id,owner_account_id,article_draft_id,mime,width,height,payload,sha256,created_at_ms) VALUES(?,?,?,'image/png',1,1,zeroblob(524288),?,?)",
          )
          .bind(id(), account, draftId, '0'.repeat(64), NOW);
      for (let n = 0; n < 16; n++) {
        const total = (await db
          .prepare('SELECT SUM(length(payload)) n FROM media_assets')
          .first<{ n: number }>())!.n;
        if (total + 524288 > 67108864) {
          await expect(insert(drafts[Math.floor(n / 8)]).run()).rejects.toThrow();
          rejected = true;
          break;
        }
        await insert(drafts[Math.floor(n / 8)]).run();
      }
      if (!rejected) await expect(insert(drafts[2]).run()).rejects.toThrow();
    }
    expect(rejected).toBe(true);
    expect(
      (await db.prepare('SELECT SUM(length(payload)) n FROM media_assets').first<{ n: number }>())!
        .n,
    ).toBeLessThanOrEqual(67108864);
  } finally {
    for (const account of owners) {
      await db.prepare('DELETE FROM media_assets WHERE owner_account_id=?').bind(account).run();
      await db.prepare('DELETE FROM private_accounts WHERE id=?').bind(account).run();
    }
  }
});
