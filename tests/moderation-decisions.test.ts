import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import type { ModerationDecisionState, ModerationDecisionReceipt } from '../worker/moderation';

const ORIGIN = 'https://app.example.invalid';
const NOW = 1800000000000;
const MIGRATION = '0018_article_moderation_decisions.sql';
type Session = { setCookie: string; contextCookie: string; csrfToken: string };
type Db = Awaited<ReturnType<Miniflare['getD1Database']>>;
let mf: Miniflare;
let users: Session[];
let operator: Session;
let legacyReports: Record<string, unknown>[];
let legacyEvents: Record<string, unknown>[];
const statements = (raw: string) =>
  (raw.includes('-- @statement') ? raw.split(/^-- @statement\s*$/m) : raw.split(/;\s*(?:\n|$)/))
    .map((sql) => sql.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
const migration = () => statements(readFileSync('migrations/' + MIGRATION, 'utf8'));
function instance() {
  return new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: '.worker/moderation-http-test.js',
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
      outboundService: () => {
        throw Error('Unexpected outbound request');
      },
    }),
  );
}
async function oldSchema(db: Db) {
  for (const file of readdirSync('migrations')
    .filter((name) => name.endsWith('.sql') && name < MIGRATION)
    .sort()) {
    await db.batch(
      statements(readFileSync('migrations/' + file, 'utf8')).map((sql) => db.prepare(sql)),
    );
  }
}
async function signIn(who: string): Promise<Session> {
  return (await (
    await mf.dispatchFetch(ORIGIN + '/fixture/session', {
      headers: { 'X-Test-Who': who },
    })
  ).json()) as Session;
}
const credentials = (s: Session) => ({
  Cookie: [s.setCookie, s.contextCookie].map((v) => v.split(';')[0]).join('; '),
  Origin: ORIGIN,
  Authorization: 'Bearer csrf.' + s.csrfToken,
  'Content-Type': 'application/json',
});
const path = (id: string) => '/api/private/moderation/cases/' + id + '/decision';
async function request(route: string, method = 'GET', who = operator, body?: unknown, extra = {}) {
  const response = await mf.dispatchFetch(ORIGIN + route, {
    method,
    headers: { ...credentials(who), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const [key, value] of Object.entries({
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
    'Content-Type': 'application/json; charset=utf-8',
  }))
    expect(response.headers.get(key)).toBe(value);
  for (const key of ['Set-Cookie', 'Location', 'Access-Control-Allow-Origin'])
    expect(response.headers.has(key)).toBe(false);
  return response;
}
async function action<T>(action: string, input?: unknown, id?: string) {
  return (await (
    await mf.dispatchFetch(ORIGIN + '/fixture/store', {
      method: 'POST',
      body: JSON.stringify({ action, input, id, method: 'POST', headers: credentials(users[0]) }),
    })
  ).json()) as T;
}
async function publish() {
  const draft = await action<{ id: string }>('draft', {
    title: 'Reported saved article',
    body: 'SAVED ARTICLE BODY',
  });
  const publication = await action<{ contentId: string }>(
    'publish',
    {
      expectedVersion: 1,
      confirmPublic: true,
      summary: 'Summary',
      tags: [],
      minutes: 1,
    },
    draft.id,
  );
  expect(publication?.contentId).toBeTypeOf('string');
  return publication.contentId;
}
async function report(id: string, n: number) {
  return request('/api/private/reports/' + id, 'POST', users[n], {
    reason: 'Private report ' + n,
    detail: 'Private detail',
  });
}
async function reported(count = 3) {
  const id = await publish();
  for (let n = 0; n < count; n++) expect((await report(id, n)).status).toBe(200);
  return id;
}
async function state(id: string) {
  const response = await request(path(id));
  expect(response.status).toBe(200);
  return (await response.json()) as ModerationDecisionState;
}
async function command(id: string, action: 'restore' | 'delete' = 'restore') {
  const current = await state(id);
  return {
    decisionId: crypto.randomUUID(),
    expectedRound: current.round,
    expectedVersion: current.version,
    action,
    reason: 'Reviewed the saved article and report evidence.',
  };
}
async function records(id: string) {
  const db = await mf.getD1Database('DB');
  return {
    content: await db.prepare('SELECT status,body FROM content WHERE id=?').bind(id).first(),
    reports: (
      await db
        .prepare(
          'SELECT round,reason,detail FROM article_reports WHERE content_id=? ORDER BY round,id',
        )
        .bind(id)
        .all()
    ).results,
    decisions: (
      await db
        .prepare('SELECT * FROM article_moderation_decisions WHERE content_id=?')
        .bind(id)
        .all()
    ).results,
    events: (
      await db.prepare('SELECT * FROM article_moderation_outbox WHERE content_id=?').bind(id).all()
    ).results,
  };
}
beforeAll(async () => {
  mf = instance();
  const db = await mf.getD1Database('DB');
  await oldSchema(db);
  for (const who of ['0', '1', '2', '3', 'operator', 'legacy-removed']) {
    await db
      .prepare(
        "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)",
      )
      .bind(
        who === 'operator' || who === 'legacy-removed' ? who : 'account-' + who,
        'subject-' + who,
        who + '@st.kobedenshi.ac.jp',
        NOW,
      )
      .run();
  }
  for (let n = 0; n < 3; n++)
    await db
      .prepare(
        'INSERT INTO article_reports(id,content_id,reporter_account_id,reason,detail,created_at_ms) VALUES(?,?,?,?,?,?)',
      )
      .bind(
        crypto.randomUUID(),
        'learning-notes',
        n === 2 ? 'legacy-removed' : 'account-' + n,
        'Legacy private reason',
        'Legacy detail',
        NOW,
      )
      .run();
  await db.prepare("DELETE FROM private_accounts WHERE id='legacy-removed'").run();
  legacyReports = (await db.prepare('SELECT * FROM article_reports ORDER BY id').all()).results;
  legacyEvents = (await db.prepare('SELECT * FROM article_report_outbox ORDER BY id').all())
    .results;
  await db.batch(migration().map((sql) => db.prepare(sql)));
  await db.batch(
    statements(readFileSync('migrations/0020_private_images.sql', 'utf8')).map((sql) =>
      db.prepare(sql),
    ),
  );
  await db.batch(
    statements(readFileSync('migrations/0022_article_revisions.sql', 'utf8')).map((sql) =>
      db.prepare(sql),
    ),
  );
  users = await Promise.all(['0', '1', '2', '3'].map(signIn));
  operator = await signIn('operator');
  expect(
    await action('create', {
      displayName: 'Explicit author',
      department: '',
      yearLabel: '',
      bio: '',
      confirmPublic: true,
    }),
  ).not.toBeNull();
});
afterAll(async () => mf?.dispose());

describe('article moderation decisions with actual Workers/D1', () => {
  it('migrates accepted reports and pending events unchanged, retaining their foreign keys', async () => {
    const db = await mf.getD1Database('DB');
    const migrated = (await db.prepare('SELECT * FROM article_reports ORDER BY id').all()).results;
    expect(migrated.map(({ round, ...row }) => row)).toEqual(legacyReports);
    expect(migrated.every((row) => row.round === 1)).toBe(true);
    expect(
      (await db.prepare('SELECT * FROM article_report_outbox ORDER BY id').all()).results,
    ).toEqual(legacyEvents);
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    expect(await state('learning-notes')).toEqual({
      contentId: 'learning-notes',
      round: 1,
      version: 3,
      status: 'hidden',
      reportCount: 3,
    });
  });
  it('restores only hidden reports, keeps audit evidence, and receives three new reports in a new round', async () => {
    const id = await reported();
    const input = await command(id);
    const response = await request(path(id), 'POST', operator, input);
    expect(response.status).toBe(200);
    const receipt = (await response.json()) as ModerationDecisionReceipt;
    expect(receipt).toEqual({
      decisionId: input.decisionId,
      contentId: id,
      action: 'restore',
      reason: input.reason,
      resultStatus: 'published',
      resultRound: 2,
      resultVersion: 4,
      notification: 'pending',
    });
    expect(JSON.stringify(receipt)).not.toMatch(
      /operator|account-|subject-|st\.kobedenshi|token|csrf/,
    );
    const receiptPath = '/api/private/moderation/cases/' + id + '/decisions/' + input.decisionId;
    expect(await (await request(receiptPath)).json()).toEqual(receipt);
    expect((await request(receiptPath, 'GET', users[0])).status).toBe(404);
    expect(
      (await request(receiptPath, 'GET', operator, undefined, { 'X-Test-Operators': 'none' }))
        .status,
    ).toBe(404);
    expect(await action('read-public', undefined, id)).not.toBeNull();
    expect(await (await request('/api/private/reports/' + id, 'GET', users[0])).json()).toEqual({
      received: false,
    });
    expect(
      (
        await request(path(id), 'POST', operator, {
          ...input,
          decisionId: crypto.randomUUID(),
          expectedRound: 2,
          expectedVersion: 4,
        })
      ).status,
    ).toBe(404);
    for (let n = 0; n < 3; n++) {
      expect((await report(id, n)).status).toBe(200);
      expect((await action('read-public', undefined, id)) === null).toBe(n === 2);
    }
    expect((await records(id)).reports.map((row) => row.round).sort()).toEqual([1, 1, 1, 2, 2, 2]);
    expect(await state(id)).toMatchObject({
      round: 2,
      version: 7,
      status: 'hidden',
      reportCount: 3,
    });
    const detail = (await (await request('/api/private/moderation/cases/' + id)).json()) as {
      reports: unknown[];
    };
    expect(detail.reports).toHaveLength(3);
    expect((await records(id)).events.map((event) => event.state)).toEqual(['pending']);
  });
  it('serializes same-ID retries and different decisions, with current authorization on every receipt', async () => {
    const id = await reported();
    const input = await command(id);
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => request(path(id), 'POST', operator, input)),
    );
    expect(responses.map((response) => response.status)).toEqual(Array(8).fill(200));
    const receipts = await Promise.all(responses.map((response) => response.json()));
    expect(
      receipts.every((receipt) => JSON.stringify(receipt) === JSON.stringify(receipts[0])),
    ).toBe(true);
    expect((await records(id)).decisions).toHaveLength(1);
    expect((await records(id)).events).toHaveLength(1);
    expect(
      (await request(path(id), 'POST', operator, { ...input, reason: 'Changed reason' })).status,
    ).toBe(404);
    expect((await request(path(id), 'POST', users[0], input)).status).toBe(404);
    expect(
      (await request(path(id), 'POST', operator, input, { 'X-Test-Operators': 'none' })).status,
    ).toBe(404);
    const db = await mf.getD1Database('DB');
    await db.prepare("UPDATE private_accounts SET status='suspended' WHERE id='operator'").run();
    try {
      expect((await request(path(id), 'POST', operator, input)).status).toBe(401);
    } finally {
      await db.prepare("UPDATE private_accounts SET status='active' WHERE id='operator'").run();
      operator = await signIn('operator');
    }
    const competing = await reported();
    const a = await command(competing);
    const b = { ...a, decisionId: crypto.randomUUID(), action: 'delete' };
    expect(
      (
        await Promise.all([
          request(path(competing), 'POST', operator, a),
          request(path(competing), 'POST', operator, b),
        ])
      )
        .map((response) => response.status)
        .sort(),
    ).toEqual([200, 404]);
    expect((await records(competing)).decisions).toHaveLength(1);
  });
  it('rejects stale report versions and never restores an owner-stopped publication, including a race', async () => {
    const id = await reported(1);
    const stale = await command(id, 'delete');
    expect((await report(id, 1)).status).toBe(200);
    expect((await request(path(id), 'POST', operator, stale)).status).toBe(404);
    const current = await command(id);
    const [stopped, restore] = await Promise.all([
      action('stop', { expectedSourceVersion: 1, confirmStop: true }, id),
      request(path(id), 'POST', operator, current),
    ]);
    expect(stopped).toMatchObject({ stopped: true, status: 'hidden' });
    expect(restore.status).toBe(404);
    const fresh = await command(id);
    expect((await request(path(id), 'POST', operator, fresh)).status).toBe(404);
    expect((await records(id)).decisions).toHaveLength(0);
    expect(await action('read-public', undefined, id)).toBeNull();
  });
  it('soft-deletes both published and hidden cases, preserves bodies, and rejects new decisions on deleted records', async () => {
    for (const count of [1, 3]) {
      const id = await reported(count);
      const input = await command(id, 'delete');
      const response = await request(path(id), 'POST', operator, input);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        action: 'delete',
        resultStatus: 'deleted',
        notification: 'pending',
      });
      expect((await records(id)).content).toEqual({
        status: 'deleted',
        body: 'SAVED ARTICLE BODY',
      });
      expect((await records(id)).reports).toHaveLength(count);
      expect(
        (
          await request(path(id), 'POST', operator, {
            ...input,
            decisionId: crypto.randomUUID(),
            expectedVersion: input.expectedVersion + 1,
          })
        ).status,
      ).toBe(404);
      expect((await request(path(id), 'POST', operator, input)).status).toBe(200);
      expect(await action('read-public', undefined, id)).toBeNull();
    }
    const id = await reported(1);
    expect((await request(path(id), 'POST', operator, await command(id))).status).toBe(404);
  });
  it('rolls back audit, status, version and round together when pending notification persistence fails', async () => {
    const id = await reported();
    const input = await command(id);
    const before = await state(id);
    const db = await mf.getD1Database('DB');
    await db
      .prepare(
        "CREATE TRIGGER fixture_decision_outbox_failure BEFORE INSERT ON article_moderation_outbox BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
      )
      .run();
    try {
      expect((await request(path(id), 'POST', operator, input)).status).toBe(404);
      expect(await state(id)).toEqual(before);
      expect((await records(id)).decisions).toEqual([]);
      expect((await records(id)).events).toEqual([]);
    } finally {
      await db.prepare('DROP TRIGGER fixture_decision_outbox_failure').run();
    }
    expect((await request(path(id), 'POST', operator, input)).status).toBe(200);
  });
  it('rejects malformed input, methods, query, CSRF, spoofed operators and post-auth revocation without exposing content', async () => {
    const id = await reported();
    const input = await command(id);
    for (const invalid of [
      null,
      {},
      { ...input, action: 'publish' },
      { ...input, reason: '' },
      { ...input, reason: '\0' },
      { ...input, reason: '😀'.repeat(1001) },
      { ...input, expectedVersion: 0 },
      { ...input, expectedRound: 1.1 },
      { ...input, decisionId: '../private' },
      { ...input, operator: 'operator' },
    ]) {
      const response = await request(path(id), 'POST', operator, invalid);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'moderation_unavailable' });
    }
    expect((await request(path(id) + '?code=PRIVATE_CANARY', 'POST', operator, input)).status).toBe(
      404,
    );
    expect((await request(path(id), 'PUT', operator, input)).status).toBe(405);
    expect((await request(path(id), 'POST', operator, input, { Authorization: '' })).status).toBe(
      401,
    );
    expect(
      (await request(path(id), 'POST', users[0], input, { 'X-Operator': 'operator' })).status,
    ).toBe(404);
    const db = await mf.getD1Database('DB');
    for (const race of ['status', 'epoch', 'revoke']) {
      const response = await request(path(id), 'POST', operator, input, {
        'X-Test-Race': race,
        'X-Test-Race-At': '2',
      });
      expect(response.status).toBe(404);
      expect((await records(id)).decisions).toHaveLength(0);
      await db.prepare("UPDATE private_accounts SET status='active'").run();
      operator = await signIn('operator');
    }
  });
});

it('rolls back a failed migration batch without losing legacy reports or pending events', async () => {
  const local = instance();
  try {
    const db = await local.getD1Database('DB');
    await oldSchema(db);
    await db
      .prepare(
        "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES('legacy','legacy-subject','legacy@st.kobedenshi.ac.jp','active',0)",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO article_reports(id,content_id,reporter_account_id,reason,detail,created_at_ms) VALUES(?,'learning-notes','legacy','Private legacy reason','',0)",
      )
      .bind(crypto.randomUUID())
      .run();
    const reports = (await db.prepare('SELECT * FROM article_reports').all()).results;
    const events = (await db.prepare('SELECT * FROM article_report_outbox').all()).results;
    await expect(
      db.batch([
        ...migration().map((sql) => db.prepare(sql)),
        db.prepare('INSERT INTO nonexistent_fixture_table VALUES(1)'),
      ]),
    ).rejects.toThrow();
    expect((await db.prepare('SELECT * FROM article_reports').all()).results).toEqual(reports);
    expect((await db.prepare('SELECT * FROM article_report_outbox').all()).results).toEqual(events);
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    await db.batch(migration().map((sql) => db.prepare(sql)));
    expect((await db.prepare('SELECT * FROM article_report_outbox').all()).results).toEqual(events);
  } finally {
    await local.dispose();
  }
});
