import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import type { PublicAuthorArticles } from '../src/types';
const ORIGIN = 'https://app.example.invalid';
const NOW = 1800000000000;
let mf: Miniflare;
type Session = { setCookie: string; contextCookie: string; csrfToken: string };
let a: Session, b: Session;
let authorA: string, authorB: string;
const headers = (s: Session) => ({
  Cookie: [s.setCookie, s.contextCookie].map((v) => v.split(';')[0]).join('; '),
  Origin: ORIGIN,
  Authorization: 'Bearer csrf.' + s.csrfToken,
});
async function call<T>(input: Record<string, unknown>): Promise<T> {
  return (await (
    await mf.dispatchFetch('https://fixture.test', { method: 'POST', body: JSON.stringify(input) })
  ).json()) as T;
}
const read = (id: unknown, extra = {}) =>
  call<PublicAuthorArticles | null>({ action: 'author', target: id, ...extra });
async function publish(title: string, s = a) {
  const d = await call<{ id: string }>({
    action: 'draft',
    headers: headers(s),
    input: { title, body: '# Public saved article body' },
  });
  return await call<{ contentId: string }>({
    action: 'publish',
    headers: headers(s),
    draft: d.id,
    input: {
      expectedVersion: 1,
      confirmPublic: true,
      summary: 'Public summary',
      tags: ['学び'],
      audience: 'audience',
      prerequisite: 'prerequisite',
      outcome: 'outcome',
      minutes: 3,
    },
  });
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: '.worker/publication-author-test.js',
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
    }),
  );
  const db = await mf.getD1Database('DB');
  for (const file of [
    '0001_discovery.sql',
    '0002_sample_content.sql',
    '0003_oauth_attempts.sql',
    '0004_private_sessions.sql',
    '0005_private_article_drafts.sql',
    '0006_article_reports.sql',
    '0007_article_publications.sql',
  ])
    for (const sql of readFileSync('migrations/' + file, 'utf8')
      .replace(/^--.*$/gm, '')
      .split(/;\s*(?:\n|$)/)
      .filter((s) => s.trim()))
      await db.prepare(sql).run();
  for (const who of ['a', 'b'])
    await db
      .prepare(
        "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)",
      )
      .bind('private-' + who, 'subject-' + who, who + '@st.kobedenshi.ac.jp', NOW)
      .run();
  a = await call<Session>({ action: 'session', who: 'a' });
  b = await call<Session>({ action: 'session', who: 'b' });
  for (const [s, name, key] of [
    [a, 'Author A', 'a'],
    [b, 'Author B', 'b'],
  ] as const) {
    const created = await call<{ profile: { id: string } }>({
      action: 'profile',
      headers: headers(s),
      input: {
        displayName: name,
        department: 'Manual department',
        yearLabel: 'Manual year',
        bio: 'Explicit bio',
        confirmPublic: true,
      },
    });
    if (key === 'a') authorA = created.profile.id;
    else authorB = created.profile.id;
  }
});
afterAll(async () => {
  await mf?.dispose();
});
describe('public author discovery derived only from eligible published snapshots', () => {
  it('does not expose orphan/manual/sample/private profiles without linked eligible articles', async () => {
    for (const id of [
      authorA,
      authorB,
      'sample-a',
      'private-a',
      'subject-a',
      'missing',
      null,
      '../private',
      "' OR 1=1 --",
    ])
      expect(await read(id)).toBeNull();
  });
  it('returns explicit summary cards and the manual author without any session or private fields', async () => {
    const first = await publish('First public A');
    const other = await publish('Other author B', b);
    const result = (await read(authorA))!;
    expect(result.author).toEqual({
      id: authorA,
      name: 'Author A',
      department: 'Manual department',
      year: 'Manual year',
      bio: 'Explicit bio',
      initials: 'A',
    });
    expect(result.entries).toEqual([
      {
        id: first.contentId,
        title: 'First public A',
        summary: 'Public summary',
        tags: ['学び'],
        audience: 'audience',
        prerequisite: 'prerequisite',
        outcome: 'outcome',
        updatedAt: new Date(NOW).toISOString().slice(0, 10),
        minutes: 3,
      },
    ]);
    expect((await read(authorB))!.entries.map((row) => row.id)).toEqual([other.contentId]);
    for (const entry of result.entries)
      expect(Object.keys(entry).sort()).toEqual([
        'audience',
        'id',
        'minutes',
        'outcome',
        'prerequisite',
        'summary',
        'tags',
        'title',
        'updatedAt',
      ]);
    for (const marker of [
      '# Public saved article body',
      'body',
      'relatedIds',
      'authorId',
      'private-a',
      'subject-a',
      'st.kobedenshi',
      'tokenHash',
      'draft_id',
      'sourceVersion',
      'reporter',
    ])
      expect(JSON.stringify(result)).not.toContain(marker);
    expect(await read(authorA, { headers: { Cookie: 'invalid' } })).toEqual(result);
    const db = await mf.getD1Database('DB');
    await db.prepare("UPDATE private_accounts SET status='suspended' WHERE id='private-a'").run();
    expect(await read(authorA)).toEqual(result);
    await db.prepare("UPDATE private_accounts SET status='active' WHERE id='private-a'").run();
    a = await call<Session>({ action: 'session', who: 'a' });
  });
  it('excludes hidden/deleted/sample/project and unrecorded content without mixing authors', async () => {
    const db = await mf.getD1Database('DB');
    for (const [field, value] of [
      ['status', 'hidden'],
      ['status', 'deleted'],
      ['is_sample', 1],
      ['kind', 'project'],
    ] as const) {
      const receipt = await publish('Excluded ' + field);
      await db
        .prepare(`UPDATE content SET ${field}=? WHERE id=?`)
        .bind(value, receipt.contentId)
        .run();
    }
    await db
      .prepare(
        "INSERT INTO content(id,kind,title,summary,body,tags_json,author_id,audience,prerequisite,outcome,updated_at,minutes,related_ids_json,status,is_sample) VALUES('unrecorded-local','article','Unrecorded','summary','body','[]',?,'','','','9999-01-01',1,'[]','published',0)",
      )
      .bind(authorA)
      .run();
    const result = (await read(authorA))!;
    expect(result.entries.map((e) => e.title)).toEqual(['First public A']);
    expect(result.entries.every((e) => !e.title.includes('Other author'))).toBe(true);
  });
  it('fails closed for malformed selected rows instead of silently skipping unreadable articles', async () => {
    const db = await mf.getD1Database('DB');
    const good = (await read(authorA))!;
    const id = good.entries[0].id;
    for (const [field, value] of [
      ['body', 'x'.repeat(262145)],
      ['body', 'bad\u0000body'],
      ['tags_json', '[1]'],
      ['title', 'a\u0000' + 'x'.repeat(1000)],
      ['updated_at', '2026-02-30'],
    ] as const) {
      const before = (await db
        .prepare(`SELECT ${field} value FROM content WHERE id=?`)
        .bind(id)
        .first<{ value: string }>())!.value;
      await db.prepare(`UPDATE content SET ${field}=? WHERE id=?`).bind(value, id).run();
      expect(await read(authorA)).toBeNull();
      await db.prepare(`UPDATE content SET ${field}=? WHERE id=?`).bind(before, id).run();
      expect(await read(authorA)).toEqual(good);
    }
  });
  it('fails closed for invalid manual profiles and private authentication IDs', async () => {
    const db = await mf.getD1Database('DB');
    const original = (await read(authorA))!;
    await db
      .prepare('UPDATE public_profiles SET bio=? WHERE id=?')
      .bind('x'.repeat(801), authorA)
      .run();
    expect(await read(authorA)).toBeNull();
    await db
      .prepare('UPDATE public_profiles SET bio=? WHERE id=?')
      .bind(original.author.bio, authorA)
      .run();
    for (const [id, subject] of [
      [authorA, 'collision-subject'],
      ['collision-account', authorA],
    ]) {
      await db
        .prepare(
          "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)",
        )
        .bind(id, subject, 'fictional@st.kobedenshi.ac.jp', NOW)
        .run();
      expect(await read(authorA)).toBeNull();
      await db.prepare('DELETE FROM private_accounts WHERE id=?').bind(id).run();
    }
    expect(await read(authorA)).toEqual(original);
  });
  it('returns unavailable for storage failure or visibility changing between bounded queries', async () => {
    expect(await read(authorA, { fault: true })).toBeNull();
    expect(await read(authorA, { hideAfterSelection: true })).toBeNull();
    const db = await mf.getD1Database('DB');
    await db.prepare("UPDATE content SET status='published' WHERE title='First public A'").run();
    expect((await read(authorA))!.entries[0].title).toBe('First public A');
  });
  it('returns at most20 newest articles by publication instant with deterministic same-instant ID ties', async () => {
    const db = await mf.getD1Database('DB');
    const created: { id: string; publishedAt: number }[] = [];
    for (let n = 0; n < 23; n++) {
      const receipt = await publish('Bounded ' + n);
      const instant = NOW + Math.floor(n / 2) + 1;
      await db
        .prepare('UPDATE article_publications SET published_at_ms=? WHERE content_id=?')
        .bind(instant, receipt.contentId)
        .run();
      created.push({ id: receipt.contentId, publishedAt: instant });
    }
    const expected = created
      .sort((a, b) => b.publishedAt - a.publishedAt || a.id.localeCompare(b.id))
      .slice(0, 20);
    const result = (await read(authorA))!;
    expect(result.entries).toHaveLength(20);
    expect(result.entries.map((e) => e.id)).toEqual(expected.map((e) => e.id));
    expect(new Set(result.entries.map((e) => e.updatedAt)).size).toBe(1);
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(
      256 * 1024,
    );
    for (const entry of result.entries)
      expect(await call({ action: 'read', target: entry.id })).not.toBeNull();
  });
  it('keeps twenty maximum escaped cards valid above128KiB and below the256KiB response cap', async () => {
    const db = await mf.getD1Database('DB');
    const selected = (await read(authorA))!.entries;
    const tags = ['a', 'b', 'c', 'd', 'e'].map((first) => first + '"'.repeat(23));
    await db.batch(
      selected.map((entry) =>
        db
          .prepare(
            'UPDATE content SET title=?,summary=?,tags_json=?,audience=?,prerequisite=?,outcome=? WHERE id=?',
          )
          .bind(
            'A' + '\u0001'.repeat(199),
            '\u0001'.repeat(300),
            JSON.stringify(tags),
            '\u0001'.repeat(200),
            '\u0001'.repeat(200),
            '\u0001'.repeat(200),
            entry.id,
          ),
      ),
    );
    await db
      .prepare('UPDATE public_profiles SET bio=? WHERE id=?')
      .bind('\u0001'.repeat(800), authorA)
      .run();
    const result = (await read(authorA))!;
    expect(result.entries).toHaveLength(20);
    expect(
      result.entries.every(
        (entry) =>
          entry.title.length === 200 && entry.summary.length === 300 && entry.tags.length === 5,
      ),
    ).toBe(true);
    const size = new TextEncoder().encode(JSON.stringify(result)).byteLength;
    expect(size).toBeGreaterThan(128 * 1024);
    expect(size).toBeLessThanOrEqual(256 * 1024);
  });
  it('returns unavailable rather than an author profile when no eligible publications remain', async () => {
    const db = await mf.getD1Database('DB');
    await db.prepare("UPDATE content SET status='hidden' WHERE author_id=?").bind(authorB).run();
    expect(await read(authorB)).toBeNull();
    expect(await read(authorA)).not.toBeNull();
  });
  it('refuses a record-backed legacy non-UUID article ID before exposing an unreadable card', async () => {
    const draft = await call<{ id: string }>({
      action: 'draft',
      headers: headers(a),
      input: { title: 'Legacy malformed identifier', body: 'Saved public body' },
    });
    const db = await mf.getD1Database('DB');
    await db
      .prepare(
        "INSERT INTO article_publications(content_id,owner_account_id,draft_id,public_profile_id,source_version,summary,tags_json,audience,prerequisite,outcome,minutes,published_at_ms) VALUES(?,?,?,?,1,'','[]','','','',1,?)",
      )
      .bind('x'.repeat(36), 'private-a', draft.id, authorA, NOW + 100)
      .run();
    expect(
      (await db
        .prepare('SELECT count(*) n FROM content WHERE id=?')
        .bind('x'.repeat(36))
        .first<{ n: number }>())!.n,
    ).toBe(1);
    expect(await read(authorA)).toBeNull();
  });
});
