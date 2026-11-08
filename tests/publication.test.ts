import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import type { Entry, Profile } from '../src/types';
import type { PrivateDraft } from '../worker/drafts';
const ORIGIN = 'https://app.example.invalid';
const NOW = 1800000000000;
let mf: Miniflare;
type Session = { setCookie: string; contextCookie: string; csrfToken: string };
type Public = { entry: Entry; author: Profile };
let users: Session[];
async function call<T>(input: Record<string, unknown>): Promise<T> {
  return (await (
    await mf.dispatchFetch('https://fixture.test', {
      method: 'POST',
      body: JSON.stringify({ now: NOW, ...input }),
    })
  ).json()) as T;
}
const headers = (s: Session) => ({
  Cookie: [s.setCookie, s.contextCookie].map((v) => v.split(';')[0]).join('; '),
  Origin: ORIGIN,
  Authorization: 'Bearer csrf.' + s.csrfToken,
  'Sec-Fetch-Site': 'same-origin',
});
const session = (who: string) => call<Session>({ action: 'session', who });
const meta = {
  expectedVersion: 1,
  confirmPublic: true,
  summary: '公開する概要',
  tags: [' 学び ', 'ＡＩ'],
  minutes: 3,
};
const create = (title = 'Stored title', body = '# Stored body', s = users[0]) =>
  call<PrivateDraft>({ action: 'create', headers: headers(s), input: { title, body } });
const publish = (draft: string, input: unknown = meta, s = users[0], extra = {}) =>
  call<{ contentId: string } | null>({
    action: 'publish',
    draft,
    input,
    headers: headers(s),
    ...extra,
  });
const read = (target: string) => call<Public | null>({ action: 'read', target, headers: {} });
async function counts() {
  const db = await mf.getD1Database('DB');
  return {
    records: (await db
      .prepare('SELECT count(*) n FROM article_publications')
      .first<{ n: number }>())!.n,
    content: (await db
      .prepare('SELECT count(*) n FROM content WHERE is_sample=0')
      .first<{ n: number }>())!.n,
  };
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: '.worker/publication-test.js',
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
  for (const who of ['0', '1', '2', '3'])
    await db
      .prepare(
        "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)",
      )
      .bind('account-' + who, 'subject-' + who, who + '@st.kobedenshi.ac.jp', NOW)
      .run();
  await db
    .prepare(
      "INSERT INTO public_profiles(id,display_name,department,year_label,bio,initials,is_sample) VALUES('public-author','手動の表示名','手動の分野','学年表示','手動で公開した自己紹介','手',0)",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO account_public_profiles(owner_account_id,public_profile_id) VALUES('account-0','public-author')",
    )
    .run();
  users = await Promise.all(['0', '1', '2', '3'].map(session));
});
afterAll(async () => {
  await mf?.dispose();
});
describe('unconnected publication snapshot boundary with real local sessions and D1', () => {
  it('requires explicit publication and anonymously reads exact public Entry/Profile DTOs', async () => {
    const d = await create();
    const receipt = (await publish(d.id))!;
    expect(receipt).toEqual({ contentId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    const value = (await read(receipt.contentId))!;
    expect(value).toEqual({
      entry: {
        id: receipt.contentId,
        kind: 'article',
        title: 'Stored title',
        body: '# Stored body',
        summary: meta.summary,
        tags: ['AI', '学び'],
        authorId: 'public-author',
        audience: '',
        prerequisite: '',
        outcome: '',
        updatedAt: new Date(NOW).toISOString().slice(0, 10),
        minutes: 3,
        relatedIds: [],
      },
      author: {
        id: 'public-author',
        name: '手動の表示名',
        department: '手動の分野',
        year: '学年表示',
        bio: '手動で公開した自己紹介',
        initials: '手',
      },
    });
    for (const marker of [
      'account-0',
      'subject-0',
      'st.kobedenshi',
      d.id,
      'source_version',
      'reporter',
      'tokenHash',
    ])
      expect(JSON.stringify(value)).not.toContain(marker);
    expect(await read('learning-notes')).toBeNull();
  });
  it('publishes one immutable snapshot, keeps it after source edits/deletion and refuses new versions', async () => {
    const d = await create();
    const receipt = (await publish(d.id))!;
    const old = await read(receipt.contentId);
    const edited = await call<PrivateDraft>({
      action: 'update',
      draft: d.id,
      headers: headers(users[0]),
      input: { title: 'new private title', body: 'new private body', expectedVersion: 1 },
    });
    expect(edited.version).toBe(2);
    expect(await publish(d.id)).toEqual(receipt);
    expect(await publish(d.id, { ...meta, expectedVersion: 2 })).toBeNull();
    expect(await read(receipt.contentId)).toEqual(old);
    expect(
      await call({
        action: 'delete',
        draft: d.id,
        headers: headers(users[0]),
        input: { expectedVersion: 2 },
      }),
    ).toEqual({ deleted: true });
    expect(await read(receipt.contentId)).toEqual(old);
    const db = await mf.getD1Database('DB');
    expect(
      (
        await db
          .prepare('SELECT draft_id FROM article_publications WHERE content_id=?')
          .bind(receipt.contentId)
          .first()
      )?.draft_id,
    ).toBeNull();
  });
  it('returns the same ID for12 concurrent identical/canonical requests and never changes metadata', async () => {
    const d = await create();
    const before = await counts();
    const results = await Promise.all(Array.from({ length: 12 }, () => publish(d.id)));
    expect(results.every(Boolean)).toBe(true);
    expect(new Set(results.map((r) => r!.contentId)).size).toBe(1);
    expect(await counts()).toEqual({ records: before.records + 1, content: before.content + 1 });
    expect(await publish(d.id, { ...meta, tags: ['AI', '学び'] })).toEqual(results[0]);
    for (const change of [
      { summary: 'changed' },
      { minutes: 4 },
      { tags: ['other'] },
      { audience: 'changed' },
    ])
      expect(await publish(d.id, { ...meta, ...change })).toBeNull();
    expect((await read(results[0]!.contentId))?.entry.summary).toBe(meta.summary);
  });
  it('rolls back publication records and content together when content insertion aborts or ignores', async () => {
    const db = await mf.getD1Database('DB');
    for (const failure of ['ABORT', 'IGNORE']) {
      const d = await create();
      const before = await counts();
      await db
        .prepare(
          `CREATE TRIGGER fixture_content_failure BEFORE INSERT ON content BEGIN SELECT RAISE(${failure}${failure === 'ABORT' ? ",'synthetic failure'" : ''}); END`,
        )
        .run();
      try {
        expect(await publish(d.id)).toBeNull();
        expect(await counts()).toEqual(before);
      } finally {
        await db.prepare('DROP TRIGGER fixture_content_failure').run();
      }
    }
  });
  it('rejects blank/stale/other-owner drafts and unsafe/client-privileged inputs', async () => {
    for (const [title, body] of [
      ['', 'body'],
      ['title', ''],
      ['　', 'body'],
      ['title', '\u00a0'],
    ]) {
      const d = await create(title, body);
      expect(await publish(d.id)).toBeNull();
    }
    const d = await create();
    expect(await publish(d.id, { ...meta, expectedVersion: 2 })).toBeNull();
    expect(await publish(d.id, meta, users[1])).toBeNull();
    for (const input of [
      null,
      [],
      {},
      { ...meta, confirmPublic: false },
      { ...meta, expectedVersion: 0 },
      { ...meta, expectedVersion: 1.5 },
      { ...meta, title: 'CLIENT' },
      { ...meta, body: 'CLIENT' },
      { ...meta, owner: 'account-0' },
      { ...meta, authorId: 'public-author' },
      { ...meta, status: 'published' },
      { ...meta, is_sample: 1 },
      { ...meta, summary: '界'.repeat(301) },
      { ...meta, tags: ['ＡＩ', 'AI'] },
      { ...meta, tags: ['bad\u0000tag'] },
      { ...meta, tags: ['bad\u200dtag'] },
      { ...meta, tags: ['x'.repeat(25)] },
      { ...meta, tags: Array(6).fill('x') },
      { ...meta, audience: 'x'.repeat(201) },
      { ...meta, minutes: 0 },
      { ...meta, minutes: 241 },
      { ...meta, minutes: 1.5 },
    ])
      expect(await publish(d.id, input)).toBeNull();
  });
  it('requires manually mapped non-sample bounded profiles and rejects reused private identifiers', async () => {
    const db = await mf.getD1Database('DB');
    const d = await create();
    await db
      .prepare("DELETE FROM account_public_profiles WHERE owner_account_id='account-0'")
      .run();
    expect(await publish(d.id)).toBeNull();
    await db.prepare("INSERT INTO account_public_profiles VALUES('account-0','sample-a')").run();
    expect(await publish(d.id)).toBeNull();
    await db
      .prepare(
        "UPDATE account_public_profiles SET public_profile_id='public-author' WHERE owner_account_id='account-0'",
      )
      .run();
    for (const name of ['　', 'x'.repeat(81), 'a\u0000' + 'x'.repeat(100)]) {
      await db
        .prepare("UPDATE public_profiles SET display_name=? WHERE id='public-author'")
        .bind(name)
        .run();
      expect(await publish(d.id)).toBeNull();
    }
    await db
      .prepare("UPDATE public_profiles SET display_name='手動の表示名' WHERE id='public-author'")
      .run();
    for (const id of ['account-0', 'subject-0', 'profile.with.dot', ' profile-id']) {
      await db
        .prepare("INSERT INTO public_profiles VALUES(?,'manual','','','','',0)")
        .bind(id)
        .run();
      await db
        .prepare(
          "UPDATE account_public_profiles SET public_profile_id=? WHERE owner_account_id='account-0'",
        )
        .bind(id)
        .run();
      expect(await publish(d.id)).toBeNull();
    }
    await db
      .prepare(
        "UPDATE account_public_profiles SET public_profile_id='public-author' WHERE owner_account_id='account-0'",
      )
      .run();
    await expect(
      db.prepare("INSERT INTO account_public_profiles VALUES('account-1','public-author')").run(),
    ).rejects.toThrow();
    expect(await publish(d.id)).not.toBeNull();
  });
  it('refuses replay after author mapping changes and rejects oversized/malformed legacy reader data', async () => {
    const db = await mf.getD1Database('DB');
    const d = await create();
    const receipt = (await publish(d.id))!;
    await db
      .prepare("INSERT INTO public_profiles VALUES('second-author','another','','','','',0)")
      .run();
    await db
      .prepare(
        "UPDATE account_public_profiles SET public_profile_id='second-author' WHERE owner_account_id='account-0'",
      )
      .run();
    expect(await publish(d.id)).toBeNull();
    expect((await read(receipt.contentId))?.author.id).toBe('public-author');
    await db
      .prepare(
        "UPDATE account_public_profiles SET public_profile_id='public-author' WHERE owner_account_id='account-0'",
      )
      .run();
    const original = (await read(receipt.contentId))!;
    for (const [field, value] of [
      ['body', '😀'.repeat(65537)],
      ['title', 'x'.repeat(201)],
      ['summary', 'a\u0000' + 'x'.repeat(1300)],
      ['tags_json', '["x","x"]'],
      ['updated_at', '2026-02-30'],
    ]) {
      const prior = (await db
        .prepare(`SELECT ${field} value FROM content WHERE id=?`)
        .bind(receipt.contentId)
        .first<{ value: string }>())!.value;
      await db
        .prepare(`UPDATE content SET ${field}=? WHERE id=?`)
        .bind(value, receipt.contentId)
        .run();
      expect(await read(receipt.contentId)).toBeNull();
      await db
        .prepare(`UPDATE content SET ${field}=? WHERE id=?`)
        .bind(prior, receipt.contentId)
        .run();
    }
    await db
      .prepare("UPDATE content SET author_id='second-author' WHERE id=?")
      .bind(receipt.contentId)
      .run();
    expect(await publish(d.id)).toBeNull();
    expect(await read(receipt.contentId)).toBeNull();
    await db
      .prepare("UPDATE content SET author_id='public-author' WHERE id=?")
      .bind(receipt.contentId)
      .run();
    expect(await read(receipt.contentId)).toEqual(original);
  });
  it('does not expose unrecorded non-sample legacy rows through the snapshot reader', async () => {
    const db = await mf.getD1Database('DB');
    await db
      .prepare(
        "INSERT INTO content(id,kind,title,summary,body,tags_json,author_id,audience,prerequisite,outcome,updated_at,minutes,related_ids_json,status,is_sample) VALUES('unrecorded-legacy','article','legacy','summary','body','[]','public-author','','','','2026-11-03',1,'[]','published',0)",
      )
      .run();
    expect(await read('unrecorded-legacy')).toBeNull();
  });
  it('requires actual POST/CSRF/origin/current sessions and rejects invalid date clocks', async () => {
    const d = await create();
    for (const extra of [
      { headers: {} },
      { headers: { ...headers(users[0]), Origin: 'https://evil.invalid' } },
      { headers: { ...headers(users[0]), Authorization: 'Bearer csrf.' + users[1].csrfToken } },
      { headers: { ...headers(users[0]), 'Sec-Fetch-Site': 'cross-site' } },
      { method: 'GET' },
      { now: NOW - 1 },
      { now: NOW + 1800000 },
      { url: 'https://evil.invalid/private' },
      { now: 253402300800000 },
    ])
      expect(await publish(d.id, meta, users[0], extra)).toBeNull();
  });
  it('integrates actual three-report hiding and never republishes hidden/deleted snapshots', async () => {
    const d = await create();
    const receipt = (await publish(d.id))!;
    for (let n = 0; n < 3; n++) {
      expect(
        await call({
          action: 'report',
          target: receipt.contentId,
          input: { reason: 'fixture report' },
          headers: headers(users[n]),
        }),
      ).toEqual({ received: true });
      expect(Boolean(await read(receipt.contentId))).toBe(n < 2);
    }
    expect(await publish(d.id)).toBeNull();
    const db = await mf.getD1Database('DB');
    expect(
      (await db.prepare('SELECT status FROM content WHERE id=?').bind(receipt.contentId).first())
        ?.status,
    ).toBe('hidden');
    await db
      .prepare("UPDATE content SET status='deleted' WHERE id=?")
      .bind(receipt.contentId)
      .run();
    expect(await publish(d.id)).toBeNull();
    expect(await read(receipt.contentId)).toBeNull();
  });
  it('rejects changed browser generation on private publication receipt and retry', async () => {
    users[0] = await session('0');
    const d = await create();
    const receipt = await publish(d.id);
    expect(receipt).not.toBeNull();
    for (const action of ['receipt', 'publish']) {
      users[0] = await session('0');
      const before = await counts();
      expect(
        await call({
          action,
          draft: d.id,
          input: meta,
          headers: headers(users[0]),
          race: 'context',
        }),
      ).toBeNull();
      expect(await counts()).toEqual(before);
    }
    users[0] = await session('0');
    expect(await publish(d.id)).toEqual(receipt);
  });
  it('rechecks revoked/status/epoch session state inside final publication SQL', async () => {
    const db = await mf.getD1Database('DB');
    for (const race of ['revoke', 'status', 'epoch', 'context']) {
      users[0] = await session('0');
      const d = await create();
      const before = await counts();
      expect(await publish(d.id, meta, users[0], { race })).toBeNull();
      expect(await counts()).toEqual(before);
      await db.prepare("UPDATE private_accounts SET status='active'").run();
    }
    users[0] = await session('0');
  });
});
