import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { encode as pngEncode, decode as pngDecode } from 'fast-png';
import jpeg from 'jpeg-js';
import { workerModules } from './helpers/worker-modules';
import type { PrivateDraft } from '../worker/drafts';
import {
  MEDIA_GLOBAL_BYTES,
  MEDIA_GLOBAL_COUNT,
  MEDIA_MAX_BYTES,
  MEDIA_OWNER_BYTES,
  MEDIA_OWNER_COUNT,
  MEDIA_PER_DRAFT,
  type MediaReceipt,
} from '../src/shared/media';
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
type TestDb = Awaited<ReturnType<Miniflare['getD1Database']>>;
async function holderDraft(db: TestDb, account: string) {
  const draftId = id();
  await db
    .prepare('INSERT INTO private_article_drafts VALUES(?,?,?, ?,1,?)')
    .bind(draftId, account, 'Limit fixture', 'Unreferenced fixture', NOW)
    .run();
  return draftId;
}
/** The insert trigger exactly as the newest migration defines it. */
const insertTrigger = () =>
  readdirSync('migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map(
      (f) =>
        /CREATE TRIGGER media_assets_insert[\s\S]*?\nEND;/.exec(
          readFileSync('migrations/' + f, 'utf8'),
        )?.[0],
    )
    .filter(Boolean)
    .at(-1)!;
/**
 * Fills the site to `total` images with 1-byte fixture rows owned by `account`. The trigger scans
 * the table per row, so the fill runs without it and the migration's trigger is restored after.
 */
async function fillSiteCount(db: TestDb, account: string, total: number) {
  const holder = await holderDraft(db, account);
  const used = (await db.prepare('SELECT COUNT(*) n FROM media_assets').first<{ n: number }>())!.n;
  await db.prepare('DROP TRIGGER media_assets_insert').run();
  try {
    await db
      .prepare(
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<?) INSERT INTO media_assets(id,owner_account_id,article_draft_id,mime,width,height,payload,sha256,created_at_ms) SELECT printf('e%07x-0000-4000-8000-000000000000',i),?,?,'image/png',1,1,zeroblob(1),?,? FROM n",
      )
      .bind(total - used, account, holder, '0'.repeat(64), NOW)
      .run();
  } finally {
    await db.prepare(insertTrigger().replace(/;$/, '')).run();
  }
  expect((await db.prepare('SELECT COUNT(*) n FROM media_assets').first<{ n: number }>())!.n).toBe(
    total,
  );
}
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
// Every case runs without R2 (D1 only, the previous Worker's shape) and with the private bucket (#12).
/** Boots the media worker on a fresh D1 with every migration before `until` applied. */
async function boot(r2: boolean, until = '\uffff') {
  users = [];
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: workerModules('.worker/media-test.js'),
      compatibilityDate: '2026-11-03',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: ['DB'],
      r2Buckets: r2 ? ['MEDIA_BUCKET'] : [],
      outboundService() {
        throw Error('Unexpected outbound');
      },
    }),
  );
  const db = await mf.getD1Database('DB');
  for (const file of readdirSync('migrations')
    .filter((f) => f.endsWith('.sql') && f < until)
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
}
describe.each([{ r2: false }, { r2: true }])('media storage (r2: $r2)', ({ r2 }) => {
  beforeAll(() => boot(r2));
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
      db
        .prepare('DELETE FROM article_publication_media WHERE content_id=?')
        .bind(p.contentId)
        .run(),
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
    const list = await mf.dispatchFetch(O + '/api/private/media/articles/' + d.id, {
      headers: h(),
    });
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
      (
        await mf.dispatchFetch(O + '/api/private/media/' + image, {
          method: 'DELETE',
          headers: h(),
        })
      ).status,
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
    const other = pngEncode({
      width: 3,
      height: 2,
      data: new Uint8Array(24).fill(200),
      channels: 4,
    });
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
    const images: ReturnType<typeof id>[] = [];
    for (let n = 0; n < MEDIA_PER_DRAFT; n++) {
      images.push(id());
      expect((await upload(d, images[n])).status).toBe(201);
    }
    const full = await upload(d);
    expect(full.status).toBe(409);
    security(full);
    expect(await full.json()).toEqual({ error: 'media_limit', limit: 'draft' });
    // A resend of an image that is already saved stays the idempotent receipt, not a refusal.
    expect((await upload(d, images[MEDIA_PER_DRAFT - 1])).status).toBe(201);
    const image = id(),
      linked = await draft(`![keep](/api/media/${image})`);
    await upload(linked, image);
    expect(
      (
        await mf.dispatchFetch(O + '/api/private/media/' + image, {
          method: 'DELETE',
          headers: h(),
        })
      ).status,
    ).toBe(404);
    const db = await mf.getD1Database('DB');
    await db
      .prepare('UPDATE private_article_drafts SET body=? WHERE id=?')
      .bind('removed', linked.id)
      .run();
    expect(
      (
        await mf.dispatchFetch(O + '/api/private/media/' + image, {
          method: 'DELETE',
          headers: h(),
        })
      ).status,
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
  it('enforces owner byte/count quotas and the site count ceiling atomically in actual D1 triggers', async () => {
    const db = await mf.getD1Database('DB'),
      accounts = ['quota-bytes', 'quota-count', 'quota-site', 'quota-probe'];
    const insert = (account: string, draftId: string, size: number) =>
      db
        .prepare(
          "INSERT INTO media_assets(id,owner_account_id,article_draft_id,mime,width,height,payload,sha256,created_at_ms) VALUES(?,?,?,'image/png',1,1,zeroblob(?),?,?)",
        )
        .bind(id(), account, draftId, size, '0'.repeat(64), NOW);
    const holders = async (account: string, images: number) => {
      const drafts: string[] = [];
      // One spare draft so the probe is never refused by the per-draft limit instead.
      for (let n = 0; n <= Math.ceil(images / MEDIA_PER_DRAFT); n++)
        drafts.push(await holderDraft(db, account));
      return drafts;
    };
    const count = async (account?: string) =>
      (await db
        .prepare(
          'SELECT COUNT(*) n FROM media_assets' + (account ? ' WHERE owner_account_id=?' : ''),
        )
        .bind(...(account ? [account] : []))
        .first<{ n: number }>())!.n;
    try {
      for (const account of accounts)
        await db
          .prepare(
            "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)",
          )
          .bind(account, account + '-subject', account + '@st.kobedenshi.ac.jp', NOW)
          .run();
      // Owner bytes: one byte below the limit, then exactly the limit fits; one more byte does not.
      const full = MEDIA_OWNER_BYTES / 524288,
        byteDrafts = await holders('quota-bytes', full);
      for (let n = 0; n < full; n++)
        await insert(
          'quota-bytes',
          byteDrafts[Math.floor(n / MEDIA_PER_DRAFT)],
          n === full - 1 ? 524287 : 524288,
        ).run();
      await insert('quota-bytes', byteDrafts.at(-1)!, 1).run();
      await expect(insert('quota-bytes', byteDrafts.at(-1)!, 1).run()).rejects.toThrow(
        'media unavailable',
      );
      // Owner count: exactly MEDIA_OWNER_COUNT images fit; one more does not.
      const countDrafts = await holders('quota-count', MEDIA_OWNER_COUNT);
      await db.batch(
        Array.from({ length: MEDIA_OWNER_COUNT }, (_, n) =>
          insert('quota-count', countDrafts[Math.floor(n / MEDIA_PER_DRAFT)], 1),
        ),
      );
      expect(await count('quota-count')).toBe(MEDIA_OWNER_COUNT);
      await expect(insert('quota-count', countDrafts.at(-1)!, 1).run()).rejects.toThrow(
        'media unavailable',
      );
      // Site count: other owners leave one slot; another owner takes it, then nobody can add more.
      await fillSiteCount(db, 'quota-site', MEDIA_GLOBAL_COUNT - 1);
      const probe = await holderDraft(db, 'quota-probe');
      await insert('quota-probe', probe, 1).run();
      expect(await count()).toBe(MEDIA_GLOBAL_COUNT);
      await expect(insert('quota-probe', probe, 1).run()).rejects.toThrow('media unavailable');
    } finally {
      for (const account of accounts) {
        await db.prepare('DELETE FROM media_assets WHERE owner_account_id=?').bind(account).run();
        await db
          .prepare('DELETE FROM private_article_drafts WHERE owner_account_id=?')
          .bind(account)
          .run();
        await db.prepare('DELETE FROM private_accounts WHERE id=?').bind(account).run();
      }
    }
  }, 60_000);
  it('refuses an upload past the owner and site limits with a named reason, and accepts it just below', async () => {
    const db = await mf.getD1Database('DB'),
      owner = 'account-3',
      filler = 'limit-filler';
    const fill = async (account: string, size: number) => {
      const holder = id();
      await db
        .prepare('INSERT INTO private_article_drafts VALUES(?,?,?, ?,1,?)')
        .bind(holder, account, 'Limit fixture', 'Unreferenced fixture', NOW)
        .run();
      await db
        .prepare(
          "INSERT INTO media_assets(id,owner_account_id,article_draft_id,mime,width,height,payload,sha256,created_at_ms) VALUES(?,?,?,'image/png',1,1,zeroblob(?),?,?)",
        )
        .bind(id(), account, holder, size, '0'.repeat(64), NOW)
        .run();
    };
    const used = async (account?: string) =>
      (await db
        .prepare(
          'SELECT COALESCE(SUM(length(payload)),0) n FROM media_assets' +
            (account ? ' WHERE owner_account_id=?' : ''),
        )
        .bind(...(account ? [account] : []))
        .first<{ n: number }>())!.n;
    await db
      .prepare(
        "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)",
      )
      .bind(filler, 'limit-filler-subject', 'limit-filler@st.kobedenshi.ac.jp', NOW)
      .run();
    try {
      const d = await call<PrivateDraft>('draft', { title: 'Limit', body: '# Limit' }, 3);
      // Owner: leave 4 KiB free (an upload fits), then fill to exactly the limit (it does not).
      for (let free = MEDIA_OWNER_BYTES - (await used(owner)) - 4096; free > 0; free -= 524288)
        await fill(owner, Math.min(524288, free));
      expect((await upload(d, id(), png, 3)).status).toBe(201);
      await fill(owner, MEDIA_OWNER_BYTES - (await used(owner)));
      const ownerFull = await upload(d, id(), png, 3);
      expect(ownerFull.status).toBe(409);
      expect(await ownerFull.json()).toEqual({ error: 'media_limit', limit: 'owner' });
      const ownerRows = await db
        .prepare('DELETE FROM media_assets WHERE owner_account_id=? RETURNING id,sha256')
        .bind(owner)
        .all<{ id: string; sha256: string }>();
      if (r2) {
        const bucket = await mf.getR2Bucket('MEDIA_BUCKET');
        for (const row of ownerRows.results) await bucket.delete(`media/${row.id}/${row.sha256}`);
      }
      // Site: other owners' images leave one slot; this upload takes it, the next is refused.
      await fillSiteCount(db, filler, MEDIA_GLOBAL_COUNT - 1);
      expect((await upload(d, id(), png, 3)).status).toBe(201);
      const siteFull = await upload(d, id(), png, 3);
      expect(siteFull.status).toBe(409);
      expect(await siteFull.json()).toEqual({ error: 'media_limit', limit: 'site' });
      expect(
        (await db.prepare('SELECT COUNT(*) n FROM media_assets').first<{ n: number }>())!.n,
      ).toBe(MEDIA_GLOBAL_COUNT);
    } finally {
      const removed = await db
        .prepare('DELETE FROM media_assets WHERE owner_account_id=? RETURNING id,sha256')
        .bind(owner)
        .all<{ id: string; sha256: string }>();
      // Filler rows were written straight to D1 and have no objects; thousands of R2 deletes
      // would only slow the case past its timeout.
      await db
        .prepare("DELETE FROM media_assets WHERE owner_account_id LIKE 'limit-filler%'")
        .run();
      // Later cases count R2 orphans, so the uploaded objects leave with their rows.
      if (r2) {
        const bucket = await mf.getR2Bucket('MEDIA_BUCKET');
        for (const row of removed.results) await bucket.delete(`media/${row.id}/${row.sha256}`);
      }
      await db
        .prepare("DELETE FROM private_article_drafts WHERE owner_account_id LIKE 'limit-filler%'")
        .run();
      await db.prepare("DELETE FROM private_accounts WHERE id LIKE 'limit-filler%'").run();
    }
  }, 30_000);

  it('independent: concurrent final uploads cannot cross the per-draft image limit', async () => {
    const d = await draft();
    for (let n = 0; n < MEDIA_PER_DRAFT - 1; n++) expect((await upload(d)).status).toBe(201);
    const last = [id(), id()];
    const final = await Promise.all(last.map((image) => upload(d, image)));
    expect(final.map((r) => r.status).sort()).toEqual([201, 409]);
    // The refused image leaves no private object behind, whichever check refused it.
    const refused = last[final.findIndex((r) => r.status === 409)];
    if (r2)
      expect(
        (await (await mf.getR2Bucket('MEDIA_BUCKET')).list({ prefix: `media/${refused}/` }))
          .objects,
      ).toHaveLength(0);
    const db = await mf.getD1Database('DB');
    expect(
      (
        await db
          .prepare('SELECT COUNT(*) n FROM media_assets WHERE article_draft_id=?')
          .bind(d.id)
          .first()
      )?.n,
    ).toBe(MEDIA_PER_DRAFT);
  });
  it('independent: a limit reason is only told to the authorized owner of a live draft', async () => {
    const d = await draft();
    for (let n = 0; n < MEDIA_PER_DRAFT; n++) expect((await upload(d)).status).toBe(201);
    expect((await upload(d)).status).toBe(409);
    const db = await mf.getD1Database('DB'),
      count = async () =>
        (await db
          .prepare('SELECT COUNT(*) n FROM media_assets WHERE article_draft_id=?')
          .bind(d.id)
          .first<{ n: number }>())!.n;
    // Another student, a missing CSRF proof, a foreign Origin and a stale version all get the
    // same 404 as an unknown draft: none of them learns the draft is full.
    const refusals = [
      await mf.dispatchFetch(O + `/api/private/media/articles/${d.id}/${id()}`, {
        method: 'PUT',
        headers: { ...h(1), 'If-Match': `"${d.version}"`, 'Content-Type': 'image/png' },
        body: png,
      }),
      await upload(d, id(), png, 0, { Authorization: '' }),
      await upload(d, id(), png, 0, { Origin: 'https://evil.example.invalid' }),
      await upload({ ...d, version: d.version + 1 }),
      await mf.dispatchFetch(O + `/api/private/media/articles/${d.id}/${id()}`, {
        method: 'PUT',
        headers: { 'If-Match': `"${d.version}"`, 'Content-Type': 'image/png' },
        body: png,
      }),
    ];
    for (const r of refusals) {
      expect(r.status).toBe(404);
      expect(await r.text()).not.toContain('media_limit');
    }
    expect(await count()).toBe(MEDIA_PER_DRAFT);
  });
  it('independent: an author cannot grant another owners private attachment using a known image UUID', async () => {
    const other = await call<PrivateDraft>(
      'draft',
      { title: 'Other private draft', body: 'Private' },
      1,
    );
    const image = id();
    expect((await upload(other, image, png, 1)).status).toBe(201);
    const own = await draft(`![foreign](/api/media/${image})`);
    expect(await publication(own, [image])).toBeNull();
    expect((await publicRead(image, h(1))).status).toBe(404);
    expect((await ownRead(image, 1)).status).toBe(200);
  });
  it('independent: one account upload does not erase another account old unattached private image', async () => {
    const d = await draft(),
      source = id();
    expect((await upload(d, source)).status).toBe(201);
    const other = await call<PrivateDraft>(
      'draft',
      { title: 'Other retained private draft', body: 'No image reference yet' },
      1,
    );
    const old = id(),
      db = await mf.getD1Database('DB');
    await db
      .prepare(
        'INSERT INTO media_assets(id,owner_account_id,article_draft_id,mime,width,height,payload,sha256,created_at_ms) SELECT ?,?,?,mime,width,height,payload,sha256,? FROM media_assets WHERE id=?',
      )
      .bind(old, 'account-1', other.id, NOW - 2 * 86400000, source)
      .run();
    expect((await ownRead(old, 1)).status).toBe(200);
    expect((await upload(d)).status).toBe(201);
    expect((await ownRead(old, 1)).status).toBe(200);
  });

  it('article revisions grant only the current immutable media manifest and retain old report evidence bytes', async () => {
    const d = await draft();
    const firstImage = id();
    expect((await upload(d, firstImage)).status).toBe(201);
    const db = await mf.getD1Database('DB');
    await db
      .prepare('UPDATE private_article_drafts SET body=?,version=version+1 WHERE id=?')
      .bind('![first](/api/media/' + firstImage + ')', d.id)
      .run();
    const first = (await publication({ ...d, version: 2 }, [firstImage]))!;
    expect((await publicRead(firstImage)).status).toBe(200);
    const secondImage = id();
    expect((await upload({ ...d, version: 2 }, secondImage)).status).toBe(201);
    await db
      .prepare('UPDATE private_article_drafts SET body=?,version=version+1 WHERE id=?')
      .bind('![second](/api/media/' + secondImage + ')', d.id)
      .run();
    expect(
      await call('article-publish', {
        id: d.id,
        input: {
          expectedVersion: 3,
          expectedPublicationVersion: 2,
          confirmPublic: true,
          summary: 'Corrected image',
          tags: [],
          minutes: 1,
          mediaIds: [secondImage],
        },
      }),
    ).toEqual(first);
    expect((await publicRead(firstImage)).status).toBe(404);
    expect((await publicRead(secondImage)).status).toBe(200);
    expect((await ownRead(firstImage)).status).toBe(200);
    expect(
      (
        await db
          .prepare(
            'SELECT media_ids_json FROM article_publication_revisions WHERE content_id=? ORDER BY revision',
          )
          .bind(first.contentId)
          .all()
      ).results,
    ).toEqual([
      { media_ids_json: JSON.stringify([firstImage]) },
      { media_ids_json: JSON.stringify([secondImage]) },
    ]);
  });

  it('publishes and revises an article with a full draft of images; one more fails every manifest CHECK', async () => {
    const d = await draft(),
      images = Array.from({ length: MEDIA_PER_DRAFT }, id),
      db = await mf.getD1Database('DB');
    for (const image of images) expect((await upload(d, image)).status).toBe(201);
    const body = (list: string[]) => list.map((image) => `![x](/api/media/${image})`).join('\n');
    await db
      .prepare('UPDATE private_article_drafts SET body=?,version=version+1 WHERE id=?')
      .bind(body(images), d.id)
      .run();
    const p = (await publication({ ...d, version: 2 }, images))!;
    expect(p).not.toBeNull();
    for (const image of [images[0], images.at(-1)!])
      expect((await publicRead(image)).status).toBe(200);
    const reversed = [...images].reverse();
    await db
      .prepare('UPDATE private_article_drafts SET body=?,version=version+1 WHERE id=?')
      .bind(body(reversed), d.id)
      .run();
    expect(
      await call('article-publish', {
        id: d.id,
        input: {
          expectedVersion: 3,
          expectedPublicationVersion: 2,
          confirmPublic: true,
          summary: 'Many images',
          tags: [],
          minutes: 1,
          mediaIds: reversed,
        },
      }),
    ).toEqual(p);
    expect(
      (
        await db
          .prepare(
            'SELECT json_array_length(media_ids_json) n FROM article_publication_revisions WHERE content_id=? ORDER BY revision',
          )
          .bind(p.contentId)
          .all()
      ).results,
    ).toEqual([{ n: MEDIA_PER_DRAFT }, { n: MEDIA_PER_DRAFT }]);
    // The column CHECK takes a full draft of ids and refuses one more. Rows that pass it are still
    // refused by the media and foreign-key checks, so nothing here is stored.
    const manifest = (n: number) => JSON.stringify(Array.from({ length: n }, id));
    const inserts = (n: number) => [
      db
        .prepare(
          "INSERT INTO article_publications(content_id,owner_account_id,draft_id,public_profile_id,source_version,summary,tags_json,audience,prerequisite,outcome,minutes,published_at_ms,media_ids_json) VALUES(?,'account-0',NULL,'image-author',1,'','[]','','','',1,?,?)",
        )
        .bind(id(), NOW, manifest(n)),
      db
        .prepare(
          "INSERT INTO project_publications(id,owner_account_id,draft_id,public_profile_id,source_version,title,description,github_url,demo_url,published_at_ms,status,media_ids_json) VALUES(?,'account-0',NULL,'image-author',1,'t','d','','',?,'hidden',?)",
        )
        .bind(id(), NOW, manifest(n)),
      db
        .prepare(
          "INSERT INTO article_publication_revisions(content_id,revision,source_version,title,body,summary,tags_json,audience,prerequisite,outcome,minutes,media_ids_json,published_at_ms) VALUES(?,1,1,'t','b','','[]','','','',1,?,?)",
        )
        .bind(id(), manifest(n), NOW),
    ];
    const failure = (statement: ReturnType<typeof db.prepare>) =>
      statement.run().then(
        () => 'stored',
        (error: unknown) => String(error),
      );
    for (const statement of inserts(MEDIA_PER_DRAFT)) {
      const error = await failure(statement);
      expect(error).not.toBe('stored');
      expect(error).not.toContain('CHECK constraint failed');
    }
    for (const statement of inserts(MEDIA_PER_DRAFT + 1))
      expect(await failure(statement)).toContain('CHECK constraint failed');
  });

  const stored = async (image: string) =>
    (await (
      await mf.getD1Database('DB')
    )
      .prepare('SELECT sha256,object_stored_at_ms FROM media_assets WHERE id=?')
      .bind(image)
      .first<{ sha256: string; object_stored_at_ms: number | null }>())!;
  const objectKey = async (image: string) => `media/${image}/${(await stored(image)).sha256}`;
  it.runIf(r2)(
    'writes new bytes to the private bucket, reads them back only through D1 authorization, and deletes them with the row',
    async () => {
      const d = await draft(),
        image = id();
      expect((await upload(d, image)).status).toBe(201);
      const bucket = await mf.getR2Bucket('MEDIA_BUCKET');
      const row = await stored(image);
      expect(row.object_stored_at_ms).toBe(NOW);
      const object = await bucket.get(await objectKey(image));
      expect(new Uint8Array(await object!.arrayBuffer())).toEqual(png);
      // The object exists, yet other students and anonymous readers still get nothing for a draft image.
      expect((await ownRead(image, 1)).status).toBe(404);
      expect((await publicRead(image)).status).toBe(404);
      // Proof the read comes from R2: drop the D1 payload path by checking a swapped object is rejected.
      await bucket.put(await objectKey(image), new Uint8Array(png.length).fill(7));
      const own = await ownRead(image);
      expect(own.status).toBe(200);
      expect(new Uint8Array(await own.arrayBuffer())).toEqual(png);
      const removed = await mf.dispatchFetch(O + '/api/private/media/' + image, {
        method: 'DELETE',
        headers: h(),
      });
      expect(removed.status).toBe(200);
      expect(await bucket.head(`media/${image}/${row.sha256}`)).toBeNull();
    },
  );
  it.runIf(r2)(
    'creates no D1 row when R2 refuses the bytes, and leaves no object when D1 refuses the row',
    async () => {
      const d = await draft(),
        failed = id();
      const r = await upload(d, failed, png, 0, { 'X-Test-R2-Fail': '1' });
      expect(r.status).toBe(404);
      const db = await mf.getD1Database('DB');
      expect(
        await db.prepare('SELECT 1 FROM media_assets WHERE id=?').bind(failed).first(),
      ).toBeNull();
      const bucket = await mf.getR2Bucket('MEDIA_BUCKET');
      expect((await bucket.list({ prefix: `media/${failed}/` })).objects).toEqual([]);
      // The writer is suspended between the R2 put and the D1 insert; the object must not survive.
      const raced = id();
      expect((await upload(d, raced, png, 0, { 'X-Test-Race': '1' })).status).toBe(404);
      await db.prepare("UPDATE private_accounts SET status='active' WHERE id='account-0'").run();
      users[0] = (await (
        await mf.dispatchFetch(O + '/fixture/session', { headers: { 'X-Test-Who': '0' } })
      ).json()) as Session;
      expect(
        await db.prepare('SELECT 1 FROM media_assets WHERE id=?').bind(raced).first(),
      ).toBeNull();
      expect((await bucket.list({ prefix: `media/${raced}/` })).objects).toEqual([]);
    },
  );
  it.runIf(r2)(
    'never lets another student overwrite a stored object by reusing its id',
    async () => {
      const mine = await draft(),
        image = id();
      expect((await upload(mine, image)).status).toBe(201);
      const key = await objectKey(image);
      const theirs = await call<PrivateDraft>('draft', { title: 'Other', body: '# x' }, 1);
      expect((await upload(theirs, image, jpg, 1, { 'Content-Type': 'image/jpeg' })).status).toBe(
        404,
      );
      const bucket = await mf.getR2Bucket('MEDIA_BUCKET');
      expect((await bucket.list({ prefix: `media/${image}/` })).objects.map((o) => o.key)).toEqual([
        key,
      ]);
      expect(new Uint8Array(await (await ownRead(image)).arrayBuffer())).toEqual(png);
    },
  );
  it.runIf(r2)('copies D1-only rows to R2 and sweeps old objects that have no D1 row', async () => {
    const d = await draft(),
      source = id();
    expect((await upload(d, source)).status).toBe(201);
    const legacy = id(),
      db = await mf.getD1Database('DB');
    // A row written by the previous Worker: bytes only in D1.
    await db
      .prepare(
        'INSERT INTO media_assets(id,owner_account_id,article_draft_id,mime,width,height,payload,sha256,created_at_ms) SELECT ?,owner_account_id,article_draft_id,mime,width,height,payload,sha256,? FROM media_assets WHERE id=?',
      )
      .bind(legacy, NOW, source)
      .run();
    const bucket = await mf.getR2Bucket('MEDIA_BUCKET');
    // Sorts right after the fixed start, so it is on the first sweep page however many objects
    // earlier cases left in the bucket (a full draft is 24 images since #195).
    const orphan = `media/00000000-0000-4000-8000-${id().slice(-12)}/${'a'.repeat(64)}`;
    await bucket.put(orphan, new Uint8Array([1, 2, 3]));
    const later = String(Date.now() + 2 * 60 * 60 * 1000);
    const run = async (now: string) =>
      (await (
        await mf.dispatchFetch(O + '/fixture/maintain', {
          headers: { 'X-Test-Now': now, 'X-Test-Start': '00000000-0000-0000-0000-000000000000' },
        })
      ).json()) as { copied: number; swept: number };
    // Inside the grace period a fresh orphan (an upload in flight) is kept.
    expect((await run(String(Date.now()))).swept).toBe(0);
    expect(await bucket.head(orphan)).not.toBeNull();
    expect((await stored(legacy)).object_stored_at_ms).not.toBeNull();
    const copied = await bucket.get(await objectKey(legacy));
    expect(new Uint8Array(await copied!.arrayBuffer())).toEqual(png);
    const second = await run(later);
    expect(second.copied).toBe(0);
    // One orphan, counted once even though the wrap-around page lists the same keys again.
    expect(second.swept).toBe(1);
    expect(await bucket.head(orphan)).toBeNull();
    expect(await bucket.head(await objectKey(source))).not.toBeNull();
    expect(await bucket.head(await objectKey(legacy))).not.toBeNull();
  });
  it.runIf(r2)('keeps copying when a full batch of older rows can never be copied', async () => {
    const db = await mf.getD1Database('DB'),
      source = id(),
      good = 'f0000000-0000-4000-8000-000000000000';
    const d = await draft(),
      bad = await draft();
    expect((await upload(d, source)).status).toBe(201);
    // Eight older rows whose payload does not match its sha256 (a full batch), then one good row.
    for (let i = 0; i < 8; i++)
      await db
        .prepare(
          'INSERT INTO media_assets(id,owner_account_id,article_draft_id,mime,width,height,payload,sha256,created_at_ms) SELECT ?,owner_account_id,?,mime,width,height,payload,?,? FROM media_assets WHERE id=?',
        )
        .bind(`0000000${i}-0000-4000-8000-000000000000`, bad.id, 'b'.repeat(64), NOW - 10, source)
        .run();
    await db
      .prepare(
        'INSERT INTO media_assets(id,owner_account_id,article_draft_id,mime,width,height,payload,sha256,created_at_ms) SELECT ?,owner_account_id,article_draft_id,mime,width,height,payload,sha256,? FROM media_assets WHERE id=?',
      )
      .bind(good, NOW, source)
      .run();
    const run = async (start: string) =>
      (await (
        await mf.dispatchFetch(O + '/fixture/maintain', {
          headers: { 'X-Test-Now': String(Date.now()), 'X-Test-Start': start },
        })
      ).json()) as { copied: number; swept: number };
    // Starting past every row wraps around to the broken ones: nothing to copy this run.
    expect((await run('ffffffff-ffff-4fff-bfff-ffffffffffff')).copied).toBe(0);
    expect((await stored(good)).object_stored_at_ms).toBeNull();
    // Another start reaches the good row although the broken ones are older and fill a batch.
    expect((await run('e0000000-0000-4000-8000-000000000000')).copied).toBe(1);
    expect((await stored(good)).object_stored_at_ms).not.toBeNull();
    const bucket = await mf.getR2Bucket('MEDIA_BUCKET');
    expect(new Uint8Array(await (await bucket.get(await objectKey(good)))!.arrayBuffer())).toEqual(
      png,
    );
    expect(
      (
        await db
          .prepare(
            "SELECT COUNT(*) n FROM media_assets WHERE id LIKE '0000000_-0000-4000-8000-000000000000' AND object_stored_at_ms IS NULL",
          )
          .first<{ n: number }>()
      )?.n,
    ).toBe(8);
    // Broken rows are left as they were: no object under their id, payload untouched.
    expect((await bucket.list({ prefix: 'media/0000000' })).objects).toHaveLength(0);
    const payloads = await db
      .prepare(
        "SELECT a.payload=s.payload same FROM media_assets a, media_assets s WHERE a.id LIKE '0000000_-0000-4000-8000-000000000000' AND s.id=?",
      )
      .bind(source)
      .all<{ same: number }>();
    expect(payloads.results.map((r) => r.same)).toEqual(Array(8).fill(1));
  });
  it.runIf(r2)('wraps around once and copies every pending row exactly once', async () => {
    const db = await mf.getD1Database('DB'),
      source = id();
    expect((await upload(await draft(), source)).status).toBe(201);
    // Rows left pending by earlier tests (the broken ones) would take part of the batch.
    await db
      .prepare('UPDATE media_assets SET object_stored_at_ms=0 WHERE object_stored_at_ms IS NULL')
      .run();
    // Fewer than a batch, on both sides of the start, and one row equal to the start.
    const ids = ['10', '30', '50', '70', '90'].map((p) => `${p}000000-0000-4000-8000-00000000000a`);
    for (const row of ids)
      await db
        .prepare(
          'INSERT INTO media_assets(id,owner_account_id,article_draft_id,mime,width,height,payload,sha256,created_at_ms) SELECT ?,owner_account_id,article_draft_id,mime,width,height,payload,sha256,? FROM media_assets WHERE id=?',
        )
        .bind(row, NOW, source)
        .run();
    const run = async (start: string) =>
      (await (
        await mf.dispatchFetch(O + '/fixture/maintain', {
          headers: { 'X-Test-Now': String(Date.now()), 'X-Test-Start': start },
        })
      ).json()) as { copied: number; swept: number };
    expect((await run(ids[2])).copied).toBe(ids.length);
    for (const row of ids) expect((await stored(row)).object_stored_at_ms).not.toBeNull();
    expect((await run(ids[2])).copied).toBe(0);
  });
});

// #249: the read-only D1↔R2 audit that release trains report before the contract stage of #12.
describe('media object audit', () => {
  beforeAll(() => boot(true));
  afterAll(async () => {
    await mf?.dispose();
  });
  type Audit = {
    total: number;
    pending: number;
    checked: number;
    missing: number;
    mismatched: number;
    complete: boolean;
  };
  const audit = async () => {
    const r = await mf.dispatchFetch(O + '/fixture/audit');
    expect(r.status).toBe(200);
    const text = await r.text();
    return { text, value: JSON.parse(text) as Audit & { error?: string } };
  };
  const row = async (image: string) =>
    (await (
      await mf.getD1Database('DB')
    )
      .prepare(
        'SELECT sha256,length(payload) bytes,owner_account_id,article_draft_id FROM media_assets WHERE id=?',
      )
      .bind(image)
      .first<{
        sha256: string;
        bytes: number;
        owner_account_id: string;
        article_draft_id: string;
      }>())!;
  const ok = { pending: 0, missing: 0, mismatched: 0, complete: true };
  const images: string[] = [];
  let d: PrivateDraft;

  it('refuses every write in the read-only views it runs on', async () => {
    expect(await (await mf.dispatchFetch(O + '/fixture/audit-guards')).json()).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });
  it('counts every row as matching when D1 and R2 agree', async () => {
    d = await draft();
    for (let i = 0; i < 3; i++) {
      const image = id();
      expect((await upload(d, image)).status).toBe(201);
      images.push(image);
    }
    expect((await audit()).value).toEqual({ total: 3, checked: 3, ...ok });
  });
  it('counts a copied row whose object is gone from R2 as missing', async () => {
    const bucket = await mf.getR2Bucket('MEDIA_BUCKET');
    await bucket.delete(`media/${images[0]}/${(await row(images[0])).sha256}`);
    expect((await audit()).value).toEqual({ total: 3, checked: 3, ...ok, missing: 1 });
  });
  it('counts an object with the same size but other bytes as mismatched, with or without a stored checksum', async () => {
    const bucket = await mf.getR2Bucket('MEDIA_BUCKET');
    const { sha256, bytes } = await row(images[1]);
    // Same length, other bytes, no checksum: the audit has to hash the object itself.
    await bucket.put(`media/${images[1]}/${sha256}`, new Uint8Array(bytes).fill(7));
    expect((await audit()).value).toEqual({
      total: 3,
      checked: 3,
      ...ok,
      missing: 1,
      mismatched: 1,
    });
    // Another length counts as mismatched too, and the object is left as it is (a later run still finds it).
    await bucket.put(`media/${images[1]}/${sha256}`, new Uint8Array(bytes - 1).fill(7));
    expect((await audit()).value).toEqual({
      total: 3,
      checked: 3,
      ...ok,
      missing: 1,
      mismatched: 1,
    });
    expect(await bucket.head(`media/${images[1]}/${sha256}`)).not.toBeNull();
    // The right bytes without a stored checksum still count as matching.
    const good = await row(images[2]);
    const key = `media/${images[2]}/${good.sha256}`;
    const original = new Uint8Array(await (await bucket.get(key))!.arrayBuffer());
    await bucket.put(key, original);
    expect((await audit()).value).toEqual({
      total: 3,
      checked: 3,
      ...ok,
      missing: 1,
      mismatched: 1,
    });
  });
  it('counts a row whose bytes are only in D1 as pending, and leaves no id, key, owner or bytes in the output', async () => {
    const db = await mf.getD1Database('DB'),
      legacy = id();
    await db
      .prepare(
        'INSERT INTO media_assets(id,owner_account_id,article_draft_id,mime,width,height,payload,sha256,created_at_ms) SELECT ?,owner_account_id,article_draft_id,mime,width,height,payload,sha256,? FROM media_assets WHERE id=?',
      )
      .bind(legacy, NOW, images[2])
      .run();
    const { text, value } = await audit();
    expect(value).toEqual({ total: 4, checked: 3, ...ok, pending: 1, missing: 1, mismatched: 1 });
    const canaries = [legacy, ...images];
    for (const image of [legacy, ...images]) {
      const r = await row(image);
      canaries.push(r.sha256, r.owner_account_id, r.article_draft_id);
    }
    canaries.push(
      'media/',
      'account-',
      d.id,
      'image/png',
      [...png.slice(0, 8)].map(String).join(','),
    );
    for (const canary of canaries) expect(text).not.toContain(canary);
    expect(Object.keys(value).sort()).toEqual([
      'checked',
      'complete',
      'mismatched',
      'missing',
      'pending',
      'total',
    ]);
  });
  it('throws instead of reporting zeros when R2 fails', async () => {
    const r = await mf.dispatchFetch(O + '/fixture/audit', { headers: { 'X-Test-R2-Fail': '1' } });
    expect(Object.keys((await r.json()) as object)).toEqual(['error']);
  });
  it('never changes a row or an object', async () => {
    const db = await mf.getD1Database('DB');
    const before = await db
      .prepare('SELECT id,sha256,object_stored_at_ms,hex(payload) p FROM media_assets ORDER BY id')
      .all();
    const objects = (
      await (await mf.getR2Bucket('MEDIA_BUCKET')).list({ prefix: 'media/' })
    ).objects
      .map((o) => o.key)
      .sort();
    await audit();
    expect(
      (
        await db
          .prepare(
            'SELECT id,sha256,object_stored_at_ms,hex(payload) p FROM media_assets ORDER BY id',
          )
          .all()
      ).results,
    ).toEqual(before.results);
    expect(
      (await (await mf.getR2Bucket('MEDIA_BUCKET')).list({ prefix: 'media/' })).objects
        .map((o) => o.key)
        .sort(),
    ).toEqual(objects);
  });
  it('records counts at most once per interval and keeps only the latest records', async () => {
    const db = await mf.getD1Database('DB');
    const due = async (at: number) =>
      (await (
        await mf.dispatchFetch(O + '/fixture/audit-if-due', {
          headers: { 'X-Test-Now': String(at) },
        })
      ).json()) as boolean;
    expect(await due(NOW)).toBe(true);
    expect(await due(NOW + 30 * 60 * 1000)).toBe(false);
    expect(
      await db
        .prepare(
          'SELECT total,pending,checked,missing,mismatched,complete FROM media_object_audits',
        )
        .all(),
    ).toMatchObject({
      results: [{ total: 4, pending: 1, checked: 3, missing: 1, mismatched: 1, complete: 1 }],
    });
    for (let i = 1; i <= 20; i++) expect(await due(NOW + i * 60 * 60 * 1000)).toBe(true);
    const kept = await db
      .prepare('SELECT MIN(measured_at_ms) first, COUNT(*) n FROM media_object_audits')
      .first<{ first: number; n: number }>();
    expect(kept).toEqual({ first: NOW + 7 * 60 * 60 * 1000, n: 14 });
  });
});

describe('migration 0032 on a database that already has published images', () => {
  const db = () => mf.getD1Database('DB');
  const apply = async (file: string) => {
    const database = await db();
    for (const sql of readFileSync('migrations/' + file, 'utf8')
      .split(/^-- @statement\s*$/m)
      .map((part) => part.replace(/^--.*$/gm, '').trim())
      .filter(Boolean))
      await database.prepare(sql).run();
  };
  beforeAll(async () => {
    await boot(false, '0032');
    // The current Worker writes the size column of 0039 (summed from its index) and the project stage
    // of 0043; only those are added here, so the limits and triggers stay those before 0032.
    await (await db()).prepare('ALTER TABLE media_assets ADD COLUMN bytes INTEGER').run();
    await (
      await db()
    )
      .prepare(
        "ALTER TABLE project_publications ADD COLUMN stage TEXT NOT NULL DEFAULT 'complete' CHECK(stage IN ('in_progress','complete'))",
      )
      .run();
    await (
      await db()
    )
      .prepare('CREATE INDEX media_bytes ON media_assets(owner_account_id,bytes)')
      .run();
  });
  afterAll(async () => {
    await mf?.dispose();
  });
  it('keeps every manifest, grant and trigger, and only raises the limits', async () => {
    const database = await db();
    // Before: an article with two revisions and a project, each with images (old limits apply).
    const d = await draft(),
      first = id(),
      second = id();
    for (const image of [first, second]) expect((await upload(d, image)).status).toBe(201);
    await database
      .prepare('UPDATE private_article_drafts SET body=?,version=version+1 WHERE id=?')
      .bind(`![a](/api/media/${first}) ![b](/api/media/${second})`, d.id)
      .run();
    const article = (await publication({ ...d, version: 2 }, [first, second]))!;
    await database
      .prepare('UPDATE private_article_drafts SET body=?,version=version+1 WHERE id=?')
      .bind(`![b](/api/media/${second})`, d.id)
      .run();
    expect(
      await call('article-publish', {
        id: d.id,
        input: {
          expectedVersion: 3,
          expectedPublicationVersion: 2,
          confirmPublic: true,
          summary: 'Before the migration',
          tags: [],
          minutes: 1,
          mediaIds: [second],
        },
      }),
    ).toEqual(article);
    const projectImage = id(),
      project = await call<{ id: string }>('project-draft', {
        title: 'Image project',
        description: `![screen](/api/media/${projectImage})`,
        githubUrl: '',
        demoUrl: '',
      });
    expect(
      (
        await mf.dispatchFetch(O + `/api/private/media/projects/${project.id}/${projectImage}`, {
          method: 'PUT',
          headers: { ...h(), 'Content-Type': 'image/png', 'If-Match': '"1"' },
          body: png,
        })
      ).status,
    ).toBe(201);
    const published = (await call<{ projectId: string }>('project-publish', {
      id: project.id,
      input: { expectedVersion: 1, confirmPublic: true, mediaIds: [projectImage] },
    }))!;
    const snapshot = async () => ({
      articles: (
        await database
          .prepare('SELECT * FROM article_publications ORDER BY content_id')
          .all<Record<string, unknown>>()
      ).results,
      projects: (
        await database
          .prepare('SELECT * FROM project_publications ORDER BY id')
          .all<Record<string, unknown>>()
      ).results,
      revisions: (
        await database
          .prepare('SELECT * FROM article_publication_revisions ORDER BY content_id,revision')
          .all<Record<string, unknown>>()
      ).results,
      grants: await database
        .prepare(
          "SELECT 'a',content_id,media_id FROM article_publication_media UNION ALL SELECT 'p',project_id,media_id FROM project_publication_media ORDER BY 1,2,3",
        )
        .raw(),
    });
    const triggers = async () =>
      (
        await database
          .prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name")
          .all<{ name: string; sql: string }>()
      ).results;
    const before = await snapshot(),
      beforeTriggers = await triggers();
    expect(before.revisions).toHaveLength(2);

    await apply('0032_media_limits_raise.sql');

    // Same rows and values (column order may differ), same grants, no dangling references.
    expect(await snapshot()).toEqual(before);
    expect((await database.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    // Same triggers; only the limit trigger and the revision copy's column list changed.
    const after = await triggers();
    expect(after.map((t) => t.name)).toEqual(beforeTriggers.map((t) => t.name));
    expect(
      after
        .filter((t, n) => t.sql !== beforeTriggers[n].sql)
        .map((t) => t.name)
        .sort(),
    ).toEqual(['article_revision_initial', 'media_assets_insert']);
    // Published images still read; manifests and revisions stay immutable.
    for (const image of [second, projectImage]) expect((await publicRead(image)).status).toBe(200);
    expect((await publicRead(first)).status).toBe(404);
    for (const sql of [
      "UPDATE article_publications SET media_ids_json='[]' WHERE content_id=?",
      "UPDATE project_publications SET media_ids_json='[]' WHERE id=?",
      "UPDATE article_publication_revisions SET media_ids_json='[]' WHERE content_id=?",
    ])
      await expect(
        database
          .prepare(sql)
          .bind(sql.includes('project') ? published.projectId : article.contentId)
          .run(),
      ).rejects.toThrow(/immutable/);
    // The raised limits apply to new work: a new draft takes a full draft of images and publishes.
    const next = await draft(),
      images = Array.from({ length: MEDIA_PER_DRAFT }, id);
    for (const image of images) expect((await upload(next, image)).status).toBe(201);
    expect((await upload(next)).status).toBe(409);
    await database
      .prepare('UPDATE private_article_drafts SET body=?,version=version+1 WHERE id=?')
      .bind(images.map((image) => `/api/media/${image}`).join(' '), next.id)
      .run();
    const fresh = (await publication({ ...next, version: 2 }, images))!;
    expect(fresh).not.toBeNull();
    expect(
      await database
        .prepare(
          'SELECT revision,json_array_length(media_ids_json) n FROM article_publication_revisions WHERE content_id=?',
        )
        .bind(fresh.contentId)
        .first(),
    ).toEqual({ revision: 1, n: MEDIA_PER_DRAFT });
  });
});

// #260: the size lives in its own column so the contract of #12 can empty payload.
/** Simulates the contract of #12 for one row: payload no longer holds the image. */
async function emptyPayload(db: TestDb, image: string) {
  const guard = (await db
    .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?")
    .bind('media_assets_content_immutable')
    .first<{ sql: string }>())!.sql;
  await db.prepare('DROP TRIGGER media_assets_content_immutable').run();
  try {
    await db.prepare("UPDATE media_assets SET payload=x'00' WHERE id=?").bind(image).run();
  } finally {
    await db.prepare(guard).run();
  }
}
/** Rows whose size column says `size` but whose payload is 1 byte, as after the contract. */
async function fillContracted(db: TestDb, account: string, rows: number, size: number) {
  const holder = await holderDraft(db, account);
  const saved = (
    await db
      .prepare(
        "SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name IN ('media_assets_insert','media_assets_bytes_insert')",
      )
      .all<{ name: string; sql: string }>()
  ).results;
  expect(saved).toHaveLength(2);
  for (const t of saved) await db.prepare('DROP TRIGGER ' + t.name).run();
  try {
    await db
      .prepare(
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<?) INSERT INTO media_assets(id,owner_account_id,article_draft_id,mime,width,height,payload,bytes,sha256,created_at_ms) SELECT printf('%s-0000-4000-8000-%012x',?,i),?,?,'image/png',1,1,zeroblob(1),?,?,? FROM n",
      )
      .bind(
        rows,
        account === 'account-2' ? 'c0000000' : 'd0000000',
        account,
        holder,
        size,
        '0'.repeat(64),
        NOW,
      )
      .run();
  } finally {
    for (const t of saved) await db.prepare(t.sql).run();
  }
}
describe('media size column', () => {
  beforeAll(() => boot(true));
  afterAll(async () => {
    await mf?.dispose();
  });
  const sizeOf = async (image: string) =>
    (await (
      await mf.getD1Database('DB')
    )
      .prepare('SELECT bytes,length(payload) stored FROM media_assets WHERE id=?')
      .bind(image)
      .first<{ bytes: number; stored: number }>())!;

  it('stores the normalized size on upload, and the list, own read and audit keep it after payload is emptied', async () => {
    const db = await mf.getD1Database('DB'),
      d = await draft(),
      image = id();
    expect((await upload(d, image)).status).toBe(201);
    expect(await sizeOf(image)).toEqual({ bytes: png.length, stored: png.length });
    await emptyPayload(db, image);
    expect(await sizeOf(image)).toEqual({ bytes: png.length, stored: 1 });
    const list = await mf.dispatchFetch(O + '/api/private/media/articles/' + d.id, {
      headers: h(),
    });
    expect(await list.json()).toEqual({
      images: [{ id: image, mime: 'image/png', width: 32, height: 24, bytes: png.length }],
    });
    // The R2 object is matched against the size column, not the emptied payload.
    const own = await ownRead(image);
    expect(own.status).toBe(200);
    expect(new Uint8Array(await own.arrayBuffer())).toEqual(png);
    expect(await (await mf.dispatchFetch(O + '/fixture/audit')).json()).toEqual({
      total: 1,
      pending: 0,
      checked: 1,
      missing: 0,
      mismatched: 0,
      complete: true,
    });
  });
  it('counts the owner quota from the size column in the Worker check and the trigger', async () => {
    const db = await mf.getD1Database('DB');
    // 128 rows of 512 KiB fill the owner's 64 MiB, although their payloads hold 128 bytes in all.
    await fillContracted(db, 'account-2', MEDIA_OWNER_BYTES / MEDIA_MAX_BYTES, MEDIA_MAX_BYTES);
    const d = await call<PrivateDraft>('draft', { title: 'Owner', body: '# Owner' }, 2);
    const full = await upload(d, id(), png, 2);
    expect(full.status).toBe(409);
    expect(await full.json()).toEqual({ error: 'media_limit', limit: 'owner' });
    await expect(
      db
        .prepare(
          "INSERT INTO media_assets(id,owner_account_id,article_draft_id,mime,width,height,payload,sha256,created_at_ms) VALUES(?,'account-2',?,'image/png',1,1,zeroblob(1),?,?)",
        )
        .bind(id(), d.id, '0'.repeat(64), NOW)
        .run(),
    ).rejects.toThrow('media unavailable');
    await db.prepare("DELETE FROM media_assets WHERE owner_account_id='account-2'").run();
    expect((await upload(d, id(), png, 2)).status).toBe(201);
    await db.prepare("DELETE FROM media_assets WHERE owner_account_id='account-2'").run();
  });
  it('counts the site quota from the size column in the Worker check and the trigger', async () => {
    const db = await mf.getD1Database('DB');
    await fillContracted(db, 'account-3', MEDIA_GLOBAL_BYTES / MEDIA_MAX_BYTES, MEDIA_MAX_BYTES);
    const d = await call<PrivateDraft>('draft', { title: 'Site', body: '# Site' }, 1);
    const full = await upload(d, id(), png, 1);
    expect(full.status).toBe(409);
    expect(await full.json()).toEqual({ error: 'media_limit', limit: 'site' });
    await expect(
      db
        .prepare(
          "INSERT INTO media_assets(id,owner_account_id,article_draft_id,mime,width,height,payload,sha256,created_at_ms) VALUES(?,'account-1',?,'image/png',1,1,zeroblob(1),?,?)",
        )
        .bind(id(), d.id, '0'.repeat(64), NOW)
        .run(),
    ).rejects.toThrow('media unavailable');
    await db.prepare("DELETE FROM media_assets WHERE owner_account_id='account-3'").run();
    expect((await upload(d, id(), png, 1)).status).toBe(201);
  });
  it('fills the size for an insert that does not name it, refuses a wrong size and never changes a set one', async () => {
    const db = await mf.getD1Database('DB'),
      d = await draft(),
      image = id();
    // The previous Worker's insert (no size column) gets its size from the payload.
    await db
      .prepare(
        "INSERT INTO media_assets(id,owner_account_id,article_draft_id,mime,width,height,payload,sha256,created_at_ms) VALUES(?,'account-0',?,'image/png',1,1,zeroblob(7),?,?)",
      )
      .bind(image, d.id, '0'.repeat(64), NOW)
      .run();
    expect(await sizeOf(image)).toEqual({ bytes: 7, stored: 7 });
    for (const size of [6, 8])
      await expect(
        db
          .prepare(
            "INSERT INTO media_assets(id,owner_account_id,article_draft_id,mime,width,height,payload,bytes,sha256,created_at_ms) VALUES(?,'account-0',?,'image/png',1,1,zeroblob(7),?,?,?)",
          )
          .bind(id(), d.id, size, '0'.repeat(64), NOW)
          .run(),
      ).rejects.toThrow('media unavailable');
    for (const sql of [
      'UPDATE media_assets SET bytes=8 WHERE id=?',
      'UPDATE media_assets SET bytes=NULL WHERE id=?',
    ])
      await expect(db.prepare(sql).bind(image).run()).rejects.toThrow('immutable media');
    await expect(
      db.prepare('UPDATE media_assets SET bytes=0 WHERE id=?').bind(image).run(),
    ).rejects.toThrow();
    expect(await sizeOf(image)).toEqual({ bytes: 7, stored: 7 });
  });
});

describe('migration 0039 on a database that already has images', () => {
  beforeAll(() => boot(true, '0039'));
  afterAll(async () => {
    await mf?.dispose();
  });
  it('fills every existing size from its payload and keeps every other column', async () => {
    const db = await mf.getD1Database('DB'),
      holder = await holderDraft(db, 'account-0');
    const ids = [3, 9, 524288].map((n) => [id(), n] as const);
    for (const [image, n] of ids)
      await db
        .prepare(
          "INSERT INTO media_assets(id,owner_account_id,article_draft_id,mime,width,height,payload,sha256,created_at_ms,object_stored_at_ms) VALUES(?,'account-0',?,'image/jpeg',1,1,zeroblob(?),?,?,?)",
        )
        .bind(image, holder, n, '0'.repeat(64), NOW, n === 9 ? null : NOW)
        .run();
    const before = await db
      .prepare('SELECT * FROM media_assets ORDER BY id')
      .all<Record<string, unknown>>();
    for (const sql of readFileSync('migrations/0039_media_bytes.sql', 'utf8')
      .split(/^-- @statement\s*$/m)
      .map((part) => part.replace(/^--.*$/gm, '').trim())
      .filter(Boolean))
      await db.prepare(sql).run();
    const after = await db
      .prepare('SELECT * FROM media_assets ORDER BY id')
      .all<Record<string, unknown>>();
    expect(after.results.map(({ bytes, ...rest }) => (void bytes, rest))).toEqual(before.results);
    for (const [image, n] of ids)
      expect(
        await db.prepare('SELECT bytes FROM media_assets WHERE id=?').bind(image).first(),
      ).toEqual({ bytes: n });
    expect(
      (
        await db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'media_assets_%' ORDER BY name",
          )
          .all<{ name: string }>()
      ).results.map((r) => r.name),
    ).toEqual([
      'media_assets_bytes_fill',
      'media_assets_bytes_immutable',
      'media_assets_bytes_insert',
      'media_assets_content_immutable',
      'media_assets_insert',
      'media_assets_no_retarget',
    ]);
  });
});
