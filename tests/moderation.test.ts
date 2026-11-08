import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import type { ModerationCase, ModerationSummary } from '../worker/moderation';
const ORIGIN = 'https://app.example.invalid';
const NOW = 1800000000000;
let mf: Miniflare;
type Session = { setCookie: string; contextCookie: string; csrfToken: string };
let users: Session[];
let operator: Session;
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
const report = (
  target: string,
  s = users[0],
  input: unknown = { reason: 'private reason', detail: 'private detail' },
  extra = {},
) =>
  call<{ received: true } | null>({
    action: 'report',
    target,
    headers: headers(s),
    input,
    ...extra,
  });
const queue = (s = operator, extra = {}) =>
  call<ModerationSummary[] | null>({ action: 'queue', headers: headers(s), ...extra });
const read = (target: string, s = operator, extra = {}) =>
  call<ModerationCase | null>({ action: 'case', target, headers: headers(s), ...extra });
async function seed(id: string, status = 'published', kind = 'article') {
  const db = await mf.getD1Database('DB');
  await db
    .prepare(
      "INSERT INTO content(id,kind,title,summary,body,tags_json,author_id,audience,prerequisite,outcome,updated_at,minutes,related_ids_json,status,is_sample) VALUES(?,?,?,'summary','PRIVATE ARTICLE BODY','[]','sample-a','','','','2026-11-03',1,'[]',?,1)",
    )
    .bind(id, kind, 'Article ' + id, status)
    .run();
}
async function state(id: string) {
  const db = await mf.getD1Database('DB');
  return {
    status: (await db
      .prepare('SELECT status FROM content WHERE id=?')
      .bind(id)
      .first<{ status: string }>())!.status,
    votes: (await db
      .prepare('SELECT count(*) n FROM article_reports WHERE content_id=?')
      .bind(id)
      .first<{ n: number }>())!.n,
    events: (
      await db
        .prepare(
          'SELECT event,report_count,state FROM article_report_outbox WHERE content_id=? ORDER BY report_count',
        )
        .bind(id)
        .all()
    ).results,
  };
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: '.worker/moderation-test.js',
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
  for (const who of [...Array.from({ length: 12 }, (_, n) => String(n)), 'operator', 'removed'])
    await db
      .prepare(
        "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)",
      )
      .bind(who, 'subject-' + who, who + '@st.kobedenshi.ac.jp', NOW)
      .run();
  users = await Promise.all(Array.from({ length: 12 }, (_, n) => session(String(n))));
  operator = await session('operator');
});
afterAll(async () => {
  await mf?.dispose();
});
describe('private article reports, atomic temporary hiding, and durable pending outbox', () => {
  it('accepts unique1/2 visible and3 hidden, with identical receipts and durable pending events', async () => {
    expect(await queue()).toEqual([]);
    await seed('threshold');
    expect(await report('threshold')).toEqual({ received: true });
    expect(await report('threshold', users[0], { reason: 'different' })).toEqual({
      received: true,
    });
    expect((await state('threshold')).votes).toBe(1);
    expect(await report('threshold', users[1])).toEqual({ received: true });
    expect(await state('threshold')).toEqual({
      status: 'published',
      votes: 2,
      events: [
        { event: 'report_received', report_count: 1, state: 'pending' },
        { event: 'report_received', report_count: 2, state: 'pending' },
      ],
    });
    expect(await report('threshold', users[2])).toEqual({ received: true });
    expect(await state('threshold')).toEqual({
      status: 'hidden',
      votes: 3,
      events: [
        { event: 'report_received', report_count: 1, state: 'pending' },
        { event: 'report_received', report_count: 2, state: 'pending' },
        { event: 'temporarily_hidden', report_count: 3, state: 'pending' },
      ],
    });
    expect(await report('threshold', users[3])).toBeNull();
    expect((await read('threshold'))?.reportCount).toBe(3);
    expect((await state('threshold')).events).toHaveLength(3);
  });
  it('serializes12 same-user and12 distinct-user submissions without extra votes/events', async () => {
    await seed('same');
    const same = await Promise.all(Array.from({ length: 12 }, () => report('same')));
    expect(same).toEqual(Array(12).fill({ received: true }));
    expect((await state('same')).votes).toBe(1);
    expect((await state('same')).events).toHaveLength(1);
    await seed('distinct');
    const distinct = await Promise.all(users.map((s) => report('distinct', s)));
    expect(distinct.filter(Boolean)).toHaveLength(3);
    const result = await state('distinct');
    expect(result.status).toBe('hidden');
    expect(result.votes).toBe(3);
    expect(result.events).toHaveLength(3);
    expect(result.events.filter((e) => e.event === 'temporarily_hidden')).toHaveLength(1);
  });
  it('rolls back the third vote and hide when pending outbox insertion aborts', async () => {
    await seed('rollback');
    await report('rollback', users[0]);
    await report('rollback', users[1]);
    const db = await mf.getD1Database('DB');
    await db
      .prepare(
        "CREATE TRIGGER fixture_outbox_failure BEFORE INSERT ON article_report_outbox BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
      )
      .run();
    try {
      expect(await report('rollback', users[2])).toBeNull();
      expect((await state('rollback')).status).toBe('published');
      expect((await state('rollback')).votes).toBe(2);
      expect((await state('rollback')).events).toHaveLength(2);
    } finally {
      await db.prepare('DROP TRIGGER fixture_outbox_failure').run();
    }
    expect(await report('rollback', users[2])).toEqual({ received: true });
    expect((await state('rollback')).status).toBe('hidden');
  });
  it('preserves accepted votes/private cases/outbox when reporter account is removed', async () => {
    await seed('removed-link');
    const s = await session('removed');
    await report('removed-link', s);
    const db = await mf.getD1Database('DB');
    await db.prepare("DELETE FROM private_accounts WHERE id='removed'").run();
    expect(
      (
        await db
          .prepare(
            "SELECT reporter_account_id FROM article_reports WHERE content_id='removed-link'",
          )
          .first()
      )?.reporter_account_id,
    ).toBeNull();
    expect((await state('removed-link')).votes).toBe(1);
    await report('removed-link', users[0]);
    await report('removed-link', users[1]);
    expect((await state('removed-link')).status).toBe('hidden');
    expect((await read('removed-link'))?.reports).toHaveLength(3);
  });
  it('rejects projects, private/draft/hidden/deleted/missing targets and blocks direct invalid inserts', async () => {
    for (const [id, status, kind] of [
      ['project', 'published', 'project'],
      ['draft', 'draft', 'article'],
      ['hidden', 'hidden', 'article'],
      ['deleted', 'deleted', 'article'],
    ]) {
      await seed(id, status, kind);
      expect(await report(id)).toBeNull();
      expect(await read(id)).toBeNull();
    }
    for (const target of ['missing', '../private', "' OR 1=1 --"])
      expect(await report(target)).toBeNull();
    const db = await mf.getD1Database('DB');
    for (const [target, reporter] of [
      ['project', '0'],
      ['threshold', '0'],
      ['same', null],
      ['same', 'unknown'],
    ])
      await expect(
        db
          .prepare(
            'INSERT INTO article_reports(id,content_id,reporter_account_id,reason,detail,created_at_ms) VALUES(?,?,?,?,?,?)',
          )
          .bind(crypto.randomUUID(), target, reporter, 'reason', '', NOW)
          .run(),
      ).rejects.toThrow();
    await db.prepare("UPDATE content SET status='published' WHERE id='threshold'").run();
    expect(await report('threshold', users[4])).toBeNull();
    expect((await state('threshold')).votes).toBe(3);
  });
  it('defaults operator access to none and returns only bounded explicit private case DTOs', async () => {
    expect(await queue(users[0])).toBeNull();
    expect(await read('same', users[0])).toBeNull();
    expect(await queue(operator, { disabled: true })).toBeNull();
    expect(await queue(operator, { invalidConfig: true })).toBeNull();
    expect(
      await queue(users[0], { headers: { ...headers(users[0]), 'X-Operator': 'operator' } }),
    ).toBeNull();
    const list = (await queue())!;
    expect(list.length).toBeLessThanOrEqual(20);
    for (const item of list)
      expect(Object.keys(item).sort()).toEqual([
        'contentId',
        'latestReportAt',
        'reportCount',
        'status',
        'title',
      ]);
    const value = (await read('same'))!;
    expect(Object.keys(value).sort()).toEqual([
      'body',
      'contentId',
      'latestReportAt',
      'reportCount',
      'reports',
      'status',
      'title',
    ]);
    for (const entry of value.reports)
      expect(Object.keys(entry).sort()).toEqual(['createdAt', 'detail', 'reason']);
    expect(value.body).toBe('PRIVATE ARTICLE BODY');
    expect(await read('learning-notes')).toBeNull();
  });
  it('bounds queue20 metadata and orders different timestamps then IDs deterministically', async () => {
    for (let n = 0; n < 23; n++) {
      const id = 'queue-' + String(n).padStart(2, '0');
      await seed(id);
      expect(await report(id, users[0], { reason: 'q' }, { now: NOW + n + 1 })).toEqual({
        received: true,
      });
    }
    const list = (await queue(operator, { now: NOW + 24 }))!;
    expect(list).toHaveLength(20);
    expect(list.map((x) => x.contentId)).toEqual(
      Array.from({ length: 20 }, (_, n) => 'queue-' + String(22 - n).padStart(2, '0')),
    );
    users[0] = await session('0');
    operator = await session('operator');
  });
  it('validates strict inputs/Unicode bounds and stores SQL-like reason as literal data', async () => {
    await seed('inputs');
    for (const input of [
      null,
      [],
      {},
      { reason: '' },
      { reason: ' ' },
      { reason: 'x'.repeat(201) },
      { reason: 'x', detail: '😀'.repeat(2001) },
      { reason: 'x', detail: null },
      { reason: 'x', reporter_account_id: 'operator' },
      { reason: 'x', status: 'hidden' },
      { reason: 'x', operator: true },
    ])
      expect(await report('inputs', users[1], input)).toBeNull();
    const reason = "'; DELETE FROM content; --";
    expect(await report('inputs', users[1], { reason, detail: '😀'.repeat(2000) })).toEqual({
      received: true,
    });
    expect((await read('inputs'))?.reports[0]).toEqual({
      reason,
      detail: '😀'.repeat(2000),
      createdAt: NOW,
    });
    expect(await report('inputs', users[2], { reason: '😀'.repeat(200) })).toEqual({
      received: true,
    });
  });
  it('requires unsafe POST/CSRF/origin and rejects rollback/expired clocks', async () => {
    await seed('auth');
    for (const extra of [
      { headers: {} },
      { headers: { ...headers(users[1]), Origin: 'https://evil.invalid' } },
      { headers: { ...headers(users[1]), Authorization: 'Bearer csrf.' + users[2].csrfToken } },
      { headers: { ...headers(users[1]), 'Sec-Fetch-Site': 'cross-site' } },
      { method: 'GET' },
      { now: NOW - 1 },
      { now: NOW + 1800000 },
      { url: 'https://evil.invalid/private' },
    ])
      expect(await report('auth', users[1], { reason: 'r' }, extra)).toBeNull();
    expect((await state('auth')).votes).toBe(0);
  });
  it('rejects changed browser generation for private operator queue and case', async () => {
    for (const action of ['queue', 'case']) {
      operator = await session('operator');
      expect(
        await call({ action, target: 'same', headers: headers(operator), race: 'context' }),
      ).toBeNull();
    }
    operator = await session('operator');
    expect(await read('same')).not.toBeNull();
  });
  it('rechecks revocation/status/epoch after authentication in final report/operator SQL', async () => {
    await seed('race');
    const db = await mf.getD1Database('DB');
    for (const race of ['revoke', 'status', 'epoch', 'context']) {
      const s = await session('1');
      expect(await report('race', s, { reason: 'r' }, { race })).toBeNull();
      await db.prepare("UPDATE private_accounts SET status='active'").run();
    }
    expect((await state('race')).votes).toBe(0);
    operator = await session('operator');
    expect(await queue(operator, { race: 'revoke' })).toBeNull();
    operator = await session('operator');
    expect(await read('same', operator, { race: 'epoch' })).toBeNull();
  });
  it('bounds legacy article projections without loading oversized case bodies', async () => {
    await seed('oversized-case');
    const db = await mf.getD1Database('DB');
    await db
      .prepare("UPDATE content SET title=?,body=? WHERE id='oversized-case'")
      .bind('界'.repeat(300), '😀'.repeat(65537))
      .run();
    const s = await session('1');
    expect(await report('oversized-case', s, { reason: 'legacy' }, { now: NOW + 25 })).toEqual({
      received: true,
    });
    operator = await session('operator');
    expect(await read('oversized-case', operator, { now: NOW + 26 })).toBeNull();
    const list = (await queue(operator, { now: NOW + 26 }))!;
    expect(list.find((item) => item.contentId === 'oversized-case')?.title).toBe('界'.repeat(200));
  });
  it('returns an empty queue when every previously reported article is excluded', async () => {
    const db = await mf.getD1Database('DB');
    await db.prepare("UPDATE content SET status='deleted'").run();
    operator = await session('operator');
    expect(await queue()).toEqual([]);
  });
});
