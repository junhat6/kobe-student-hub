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
describe('explicit article correction with immutable evidence', () => {
  const update = (d: PrivateDraft, title = 'Corrected title', body = 'Corrected body') =>
    call<PrivateDraft>({
      action: 'update',
      draft: d.id,
      headers: headers(users[0]),
      input: { expectedVersion: d.version, title, body },
    });
  const revise = (d: PrivateDraft, previous = 1, extra = {}, user = users[0]) =>
    publish(
      d.id,
      { ...meta, expectedVersion: d.version, expectedPublicationVersion: previous, ...extra },
      user,
    );
  it('updates the stable public URL only after confirmation and preserves both snapshots/creation time', async () => {
    const d = await create('Original title', 'Original body');
    const first = (await publish(d.id))!;
    const saved = await update(d);
    expect((await read(first.contentId))?.entry.body).toBe('Original body');
    expect(await publish(d.id, { ...meta, expectedVersion: saved.version })).toBeNull();
    expect(await revise(saved)).toEqual(first);
    expect((await read(first.contentId))?.entry.body).toBe('Corrected body');
    expect(
      (
        await call<{ publication: { sourceVersion: number } }>({
          action: 'receipt',
          draft: d.id,
          headers: headers(users[0]),
        })
      ).publication.sourceVersion,
    ).toBe(2);
    const db = await mf.getD1Database('DB');
    expect(
      (
        await db
          .prepare(
            'SELECT revision,source_version,title,body,published_at_ms FROM article_publication_revisions WHERE content_id=? ORDER BY revision',
          )
          .bind(first.contentId)
          .all()
      ).results,
    ).toEqual([
      {
        revision: 1,
        source_version: 1,
        title: 'Original title',
        body: 'Original body',
        published_at_ms: NOW,
      },
      {
        revision: 2,
        source_version: 2,
        title: 'Corrected title',
        body: 'Corrected body',
        published_at_ms: NOW,
      },
    ]);
    expect(
      await db
        .prepare(
          'SELECT published_at_ms,source_version FROM article_publications WHERE content_id=?',
        )
        .bind(first.contentId)
        .first(),
    ).toEqual({ published_at_ms: NOW, source_version: 1 });
    await expect(
      db
        .prepare('UPDATE article_publication_revisions SET body=? WHERE content_id=?')
        .bind('rewrite', first.contentId)
        .run(),
    ).rejects.toThrow();
    await expect(
      db
        .prepare('DELETE FROM article_publication_revisions WHERE content_id=?')
        .bind(first.contentId)
        .run(),
    ).rejects.toThrow();
  });
  it('races two different publication attempts using both saved and public version guards', async () => {
    const d = await create();
    const first = (await publish(d.id))!;
    const saved = await update(d);
    const results = await Promise.all([
      revise(saved, 1, { summary: 'A' }),
      revise(saved, 1, { summary: 'B' }),
    ]);
    expect(results.filter(Boolean)).toEqual([first]);
    expect(await revise(saved, 1)).toBeNull();
    const next = await update(saved, 'Third title', 'Third body');
    expect(await revise(next, 1)).toBeNull();
    expect(await revise(next, 2)).toEqual(first);
    expect((await read(first.contentId))?.entry.title).toBe('Third title');
  });
  it('keeps active report evidence/outbox unchanged and refuses updates during moderation or owner stop', async () => {
    const db = await mf.getD1Database('DB');
    const d = await create('Reported original', 'Reported body');
    const first = (await publish(d.id))!;
    const saved = await update(d);
    expect(
      await call({
        action: 'report',
        target: first.contentId,
        input: { reason: 'Needs review' },
        headers: headers(users[1]),
      }),
    ).toEqual({ received: true });
    const reports = await db
      .prepare('SELECT * FROM article_reports WHERE content_id=?')
      .bind(first.contentId)
      .all();
    const outbox = await db
      .prepare('SELECT * FROM article_report_outbox WHERE content_id=?')
      .bind(first.contentId)
      .all();
    expect(await revise(saved)).toBeNull();
    expect((await read(first.contentId))?.entry.title).toBe('Reported original');
    expect(
      await db
        .prepare(
          'SELECT revision.title,revision.body FROM article_report_revisions ref JOIN article_publication_revisions revision USING(content_id,revision) WHERE ref.content_id=?',
        )
        .bind(first.contentId)
        .first(),
    ).toEqual({ title: 'Reported original', body: 'Reported body' });
    expect(
      (
        await db
          .prepare('SELECT * FROM article_reports WHERE content_id=?')
          .bind(first.contentId)
          .all()
      ).results,
    ).toEqual(reports.results);
    expect(
      (
        await db
          .prepare('SELECT * FROM article_report_outbox WHERE content_id=?')
          .bind(first.contentId)
          .all()
      ).results,
    ).toEqual(outbox.results);
    for (const status of ['hidden', 'deleted']) {
      await db
        .prepare('UPDATE content SET status=? WHERE id=?')
        .bind(status, first.contentId)
        .run();
      expect(await revise(saved)).toBeNull();
    }
    const stopped = await create();
    const pub = (await publish(stopped.id))!;
    const edit = await update(stopped);
    await db
      .prepare('INSERT INTO article_publication_stops VALUES(?,?,?,?)')
      .bind(pub.contentId, 'account-0', 1, NOW)
      .run();
    expect(await revise(edit)).toBeNull();
  });
  it('guards stopping against the current published version after a correction', async () => {
    const d = await create();
    const first = (await publish(d.id))!;
    const saved = await update(d);
    expect(await revise(saved)).toEqual(first);
    const stop = (expectedSourceVersion: number) =>
      call<{ stopped: boolean } | null>({
        action: 'stop',
        target: first.contentId,
        input: { expectedSourceVersion, confirmStop: true },
        headers: headers(users[0]),
      });
    expect(await stop(1)).toBeNull();
    expect((await read(first.contentId))?.entry.body).toBe('Corrected body');
    expect((await stop(2))?.stopped).toBe(true);
    const newer = await update(saved, 'After stop', 'After stop body');
    expect(await revise(newer, 2)).toBeNull();
  });
  it('rolls back the new immutable snapshot when projection update aborts', async () => {
    const d = await create();
    const first = (await publish(d.id))!;
    const saved = await update(d);
    const db = await mf.getD1Database('DB');
    await db
      .prepare(
        'CREATE TRIGGER fixture_revision_failure BEFORE UPDATE OF body ON content BEGIN SELECT RAISE(IGNORE); END',
      )
      .run();
    try {
      expect(await revise(saved)).toBeNull();
      expect(
        (
          await db
            .prepare('SELECT COUNT(*) n FROM article_publication_revisions WHERE content_id=?')
            .bind(first.contentId)
            .first()
        )?.n,
      ).toBe(1);
      expect((await read(first.contentId))?.entry.body).toBe('# Stored body');
    } finally {
      await db.prepare('DROP TRIGGER fixture_revision_failure').run();
    }
  });
  it('rejects foreign ownership, stale draft, confirmation/CSRF loss and final session revocation races', async () => {
    const d = await create();
    await publish(d.id);
    const saved = await update(d);
    expect(await revise(saved, 1, {}, users[1])).toBeNull();
    expect(await revise(saved, 1, { expectedVersion: 1 })).toBeNull();
    expect(await revise(saved, 1, { confirmPublic: false })).toBeNull();
    const invalid = { ...users[0], csrfToken: 'wrong' };
    expect(await revise(saved, 1, {}, invalid)).toBeNull();
    const db = await mf.getD1Database('DB');
    for (const race of ['context', 'epoch', 'revoke', 'status']) {
      const current = await session('0');
      users[0] = current;
      expect(
        await publish(
          d.id,
          { ...meta, expectedVersion: 2, expectedPublicationVersion: 1 },
          current,
          { race },
        ),
      ).toBeNull();
      await db.prepare("UPDATE private_accounts SET status='active'").run();
    }
    expect(
      (
        await db
          .prepare(
            'SELECT COUNT(*) n FROM article_publication_revisions WHERE content_id=(SELECT content_id FROM article_publications WHERE draft_id=?)',
          )
          .bind(d.id)
          .first()
      )?.n,
    ).toBe(1);
  });
});
