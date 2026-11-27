import { SESSION_IDLE_MS } from '../worker/auth/sessions';
import { applyFixtureMigrations } from './helpers/migrations';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { dispatchModerationEmails } from '../worker/moderation-email';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import type { ProjectReportCase, ProjectReportCaseSummary } from '../src/project-report-types';
const O = 'https://app.example.invalid',
  NOW = 1800000000000;
let mf: Miniflare;
type Session = { setCookie: string; contextCookie: string; csrfToken: string };
let users: Session[], project: string;
const reportPath = () => '/api/private/project-reports/' + project,
  queue = '/api/private/project-moderation/cases';
const h = (n = 0) => ({
  Cookie: [users[n].setCookie, users[n].contextCookie].map((v) => v.split(';')[0]).join('; '),
  Origin: O,
  Authorization: 'Bearer csrf.' + users[n].csrfToken,
  'Content-Type': 'application/json',
});
async function req(
  path: string,
  method = 'GET',
  input?: unknown,
  n = 0,
  extra: Record<string, string> = {},
) {
  const r = await mf.dispatchFetch(O + path, {
    method,
    headers: { ...h(n), ...extra },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  if (
    path.startsWith('/api/private/project-reports') ||
    path.startsWith('/api/private/project-moderation')
  ) {
    for (const [k, v] of Object.entries({
      'Cache-Control': 'private, no-store',
      Vary: 'Cookie',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    }))
      expect(r.headers.get(k)).toBe(v);
    for (const k of ['Set-Cookie', 'Location', 'Access-Control-Allow-Origin'])
      expect(r.headers.has(k)).toBe(false);
  }
  return r;
}
async function login(n: number) {
  return (await (
    await mf.dispatchFetch(O + '/fixture/session', { headers: { 'X-Test-Who': String(n) } })
  ).json()) as Session;
}
async function seedProject() {
  const d = (await (
    await req('/api/private/project-drafts', 'POST', {
      title: 'Reported standalone work',
      description: 'Saved plain snapshot',
      githubUrl: '',
      demoUrl: '',
    })
  ).json()) as { id: string };
  return (
    (await (
      await req('/api/private/project-publications/' + d.id, 'POST', {
        expectedVersion: 1,
        confirmPublic: true,
      })
    ).json()) as { projectId: string }
  ).projectId;
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: '.worker/project-reports-test.js',
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
    }),
  );
  const db = await mf.getD1Database('DB');
  await applyFixtureMigrations(db);
  users = [];
  for (let n = 0; n < 24; n++) {
    await db
      .prepare(
        "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)",
      )
      .bind('account-' + n, 'subject-' + n, n + '@st.kobedenshi.ac.jp', NOW)
      .run();
    users.push(await login(n));
  }
  await req('/fixture/profile', 'POST', {
    displayName: 'Project author',
    department: 'Manual',
    yearLabel: 'Manual',
    bio: 'Public bio',
    confirmPublic: true,
  });
  project = await seedProject();
});
afterAll(async () => {
  await mf?.dispose();
});
it('distinguishes genuine no receipt and authorized empty queue from unavailable', async () => {
  expect(await (await req(reportPath())).json()).toEqual({ received: false });
  expect(await (await req(queue, 'GET', undefined, 1)).json()).toEqual([]);
  expect((await req(queue)).status).toBe(404);
  expect((await req(queue, 'GET', undefined, 1, { 'X-Test-No-Operator': '1' })).status).toBe(404);
  expect((await req('/api/private/project-reports/' + crypto.randomUUID())).status).toBe(404);
});
it('deduplicates12 concurrent reports preserving original reason; one account never hides and queues one notice', async () => {
  // Read each body as soon as its response arrives: Miniflare expects dispatchFetch bodies to be
  // consumed immediately, and holding 12 unread streams let one be cancelled ("Body has already been read").
  const rs = await Promise.all(
    Array.from({ length: 12 }, async () => {
      const r = await req(reportPath(), 'POST', {
        reason: 'Original plain reason',
        detail: 'Private detail',
      });
      return { status: r.status, body: await r.json() };
    }),
  );
  expect(rs.every((r) => r.status === 201)).toBe(true);
  for (const r of rs) expect(r.body).toEqual({ received: true });
  await req(reportPath(), 'POST', { reason: 'Replacement forbidden' });
  const db = await mf.getD1Database('DB');
  expect(
    await db
      .prepare('SELECT reason,detail FROM project_reports WHERE project_id=?')
      .bind(project)
      .all(),
  ).toMatchObject({ results: [{ reason: 'Original plain reason', detail: 'Private detail' }] });
  expect(
    (await db
      .prepare('SELECT status FROM project_publications WHERE id=?')
      .bind(project)
      .first<{ status: string }>())!.status,
  ).toBe('published');
  expect(await (await req(reportPath(), 'GET', undefined, 2)).json()).toEqual({ received: false });
  expect(
    (
      await db
        .prepare('SELECT report_count,event FROM project_report_outbox WHERE project_id=?')
        .bind(project)
        .all()
    ).results,
  ).toEqual([{ report_count: 1, event: 'report_received' }]);
});
it('exposes bounded private cases only to configured operator without reporter identity', async () => {
  const q = (await (await req(queue, 'GET', undefined, 1)).json()) as ProjectReportCaseSummary[];
  expect(q).toEqual([
    {
      projectId: project,
      title: 'Reported standalone work',
      status: 'published',
      latestReportAt: NOW,
    },
  ]);
  const c = (await (
    await req(queue + '/' + project, 'GET', undefined, 1)
  ).json()) as ProjectReportCase;
  expect(c.reports).toEqual([
    { reason: 'Original plain reason', detail: 'Private detail', receivedAt: NOW },
  ]);
  expect(c.reportsTruncated).toBe(false);
  expect(c.project.description).toBe('Saved plain snapshot');
  for (const marker of [
    'account-0',
    'subject-0',
    'reporter',
    'tokenHash',
    '@st.kobedenshi',
    'sourceVersion',
    'draft_id',
  ])
    expect(JSON.stringify(c)).not.toContain(marker);
  expect((await req(queue + '/' + project)).status).toBe(404);
  expect((await req(queue + '/' + crypto.randomUUID(), 'GET', undefined, 1)).status).toBe(404);
});
it('retains accepted own receipt on hidden/deleted while denying others and intake; operator sees fresh status', async () => {
  const db = await mf.getD1Database('DB');
  for (const status of ['hidden', 'deleted']) {
    await db
      .prepare('UPDATE project_publications SET status=? WHERE id=?')
      .bind(status, project)
      .run();
    expect(await (await req(reportPath())).json()).toEqual({ received: true });
    expect((await req(reportPath(), 'GET', undefined, 2)).status).toBe(404);
    expect((await req(reportPath(), 'POST', { reason: 'No intake' }, 2)).status).toBe(404);
    expect(
      ((await (await req(queue + '/' + project, 'GET', undefined, 1)).json()) as ProjectReportCase)
        .status,
    ).toBe(status);
  }
  await db
    .prepare("UPDATE project_publications SET status='published' WHERE id=?")
    .bind(project)
    .run();
});
it('returns latest20 with explicit truncation, preserving reports after reporter deletion', async () => {
  const db = await mf.getD1Database('DB');
  // The 3rd distinct reporter hides the project; an operator restore lets later reports in.
  for (let i = 0; i < 22; i++) {
    expect((await req(reportPath(), 'POST', { reason: 'Report ' + (i + 2) }, i + 2)).status).toBe(
      201,
    );
    await db
      .prepare("UPDATE project_publications SET status='published' WHERE id=?")
      .bind(project)
      .run();
  }
  expect(
    (
      await db
        .prepare(
          "SELECT report_count FROM project_report_outbox WHERE project_id=? AND event='temporarily_hidden'",
        )
        .bind(project)
        .all()
    ).results,
  ).toEqual([{ report_count: 3 }]);
  let c = (await (
    await req(queue + '/' + project, 'GET', undefined, 1)
  ).json()) as ProjectReportCase;
  expect(c.reports).toHaveLength(20);
  expect(c.reportsTruncated).toBe(true);
  expect(
    (await db
      .prepare('SELECT status FROM project_publications WHERE id=?')
      .bind(project)
      .first<{ status: string }>())!.status,
  ).toBe('published');
  expect(
    (await db.prepare('SELECT count(*) n FROM article_reports').first<{ n: number }>())!.n,
  ).toBe(0);
  expect(
    (await db.prepare('SELECT count(*) n FROM article_report_outbox').first<{ n: number }>())!.n,
  ).toBe(0);
  await db.prepare("DELETE FROM private_accounts WHERE id='account-23'").run();
  expect(
    (await db
      .prepare('SELECT count(*) n FROM project_reports WHERE project_id=?')
      .bind(project)
      .first<{ n: number }>())!.n,
  ).toBe(23);
  c = (await (await req(queue + '/' + project, 'GET', undefined, 1)).json()) as ProjectReportCase;
  expect(c.reports).toHaveLength(20);
});
it('temporarily hides on the 3rd distinct account without deleting, and stops further intake', async () => {
  const db = await mf.getD1Database('DB'),
    fresh = await seedProject(),
    path = '/api/private/project-reports/' + fresh;
  const status = async () =>
    (await db
      .prepare('SELECT status FROM project_publications WHERE id=?')
      .bind(fresh)
      .first<{ status: string }>())!.status;
  for (const n of [3, 3, 4]) {
    expect((await req(path, 'POST', { reason: 'Same or second reporter' }, n)).status).toBe(201);
    expect(await status()).toBe('published');
  }
  expect((await req(path, 'POST', { reason: 'Third distinct reporter' }, 5)).status).toBe(201);
  expect(await status()).toBe('hidden');
  expect(
    (await db
      .prepare('SELECT count(*) n FROM project_reports WHERE project_id=?')
      .bind(fresh)
      .first<{ n: number }>())!.n,
  ).toBe(3);
  expect(
    (
      await db
        .prepare(
          'SELECT report_count,event FROM project_report_outbox WHERE project_id=? ORDER BY report_count',
        )
        .bind(fresh)
        .all()
    ).results,
  ).toEqual([
    { report_count: 1, event: 'report_received' },
    { report_count: 2, event: 'report_received' },
    { report_count: 3, event: 'temporarily_hidden' },
  ]);
  expect((await req(path, 'POST', { reason: 'After hide' }, 6)).status).toBe(404);
  expect(await (await req(path, 'GET', undefined, 5)).json()).toEqual({ received: true });
  const c = (await (
    await req(queue + '/' + fresh, 'GET', undefined, 1)
  ).json()) as ProjectReportCase;
  expect(c.status).toBe('hidden');
  expect(c.reports).toHaveLength(3);
});
it('emails the operator once per queued project report with a project case link and no report text', async () => {
  const db = await mf.getD1Database('DB');
  const sent: { subject: string; text: string; html: string }[] = [];
  const send = vi.fn(async (m: { subject: string; text: string; html: string }) => {
    sent.push(m);
    return { messageId: 'provider-' + sent.length };
  });
  const options = {
    email: { send } as unknown as SendEmail,
    from: 'notice@example.invalid',
    to: 'verified-ops@example.invalid',
    origin: O,
  };
  const queued = (await db
    .prepare('SELECT count(*) n FROM project_report_outbox')
    .first<{ n: number }>())!.n;
  let accepted = 0;
  for (let i = 0; i < queued && accepted < queued; i++)
    accepted += (await dispatchModerationEmails(db, options, () => NOW + 10)).accepted;
  expect(accepted).toBe(queued);
  expect((await dispatchModerationEmails(db, options, () => NOW + 11)).attempted).toBe(0);
  expect(
    (await db
      .prepare(
        "SELECT count(*) n FROM project_moderation_email_deliveries WHERE state='accepted' AND attempts=1",
      )
      .first<{ n: number }>())!.n,
  ).toBe(queued);
  expect(sent.filter((m) => m.subject === '作品を一時非公開にしました').length).toBeGreaterThan(0);
  expect(sent.filter((m) => m.subject === '作品の通報が届いています').length).toBeGreaterThan(0);
  for (const m of sent) {
    expect(m.text).toMatch(
      new RegExp(
        '^運営画面で作品と通報内容を確認できます。\\n' +
          O.replace(/\./g, '\\.') +
          '/moderation\\?type=project&case=[0-9a-f-]{36}$',
      ),
    );
    for (const marker of ['Report ', 'reporter', 'account-', '@st.kobedenshi', 'Private detail'])
      expect(JSON.stringify(m)).not.toContain(marker);
  }
});
it('rejects privileged/malformed/plain text overflow inputs and unsafe transport', async () => {
  for (const v of [
    null,
    {},
    { reason: '' },
    { reason: ' ' },
    { reason: '\ud800' },
    { reason: 'bad\0text' },
    { reason: 'x'.repeat(201) },
    { reason: 'r', detail: '😀'.repeat(2001) },
    { reason: 'r', reporter: 'account-1' },
    { reason: 'r', status: 'hidden' },
  ])
    expect((await req(reportPath(), 'POST', v, 2)).status).toBe(404);
  expect(
    (await req(reportPath(), 'POST', { reason: 'r' }, 2, { 'Content-Type': 'text/plain' })).status,
  ).toBe(415);
  expect((await req(reportPath(), 'POST', {}, 2, { 'X-Test-Body': 'utf8' })).status).toBe(400);
  expect((await req(reportPath(), 'POST', undefined, 2, { 'X-Test-Body': 'empty' })).status).toBe(
    413,
  );
  expect((await req(reportPath() + '?PRIVATE=1')).status).toBe(404);
  expect((await req(reportPath(), 'PUT')).headers.get('Allow')).toBe('GET, POST');
});
it('rejects changed browser generation for report writes, own receipt and operator reads', async () => {
  const db = await mf.getD1Database('DB');
  for (const [path, method, input, n] of [
    [reportPath(), 'POST', { reason: 'denied' }, 2],
    [reportPath(), 'GET', undefined, 0],
    [queue, 'GET', undefined, 1],
    [queue + '/' + project, 'GET', undefined, 1],
  ] as const) {
    users[n] = await login(n);
    const before = (await db
      .prepare('SELECT count(*) n FROM project_reports')
      .first<{ n: number }>())!.n;
    expect(
      (
        await req(path, method, input, n, {
          'X-Test-Race': 'context',
          'X-Test-Race-At': method === 'POST' ? '3' : '2',
        })
      ).status,
    ).toBe(404);
    expect(
      (await db.prepare('SELECT count(*) n FROM project_reports').first<{ n: number }>())!.n,
    ).toBe(before);
  }
  for (const n of [0, 1, 2]) users[n] = await login(n);
});
it('requires real sessions/CSRF and final live SQL after auth', async () => {
  expect((await req(reportPath(), 'POST', { reason: 'r' }, 2, { Cookie: '' })).status).toBe(401);
  expect(
    (
      await req(reportPath(), 'POST', { reason: 'r' }, 2, {
        Authorization: 'Bearer csrf.' + users[1].csrfToken,
      })
    ).status,
  ).toBe(401);
  expect(
    (await req(reportPath(), 'GET', undefined, 2, { 'X-Test-Now': String(NOW + SESSION_IDLE_MS) }))
      .status,
  ).toBe(401);
  expect((await req(queue, 'GET', undefined, 1, { 'X-Test-Race': 'revoke' })).status).toBe(404);
  for (let n = 0; n < 23; n++) users[n] = await login(n);
});
it('times out a stalled report without late insertion', async () => {
  const db = await mf.getD1Database('DB'),
    fresh = await seedProject();
  const before = (await db
    .prepare('SELECT count(*) n FROM project_reports')
    .first<{ n: number }>())!.n;
  const start = Date.now();
  expect(
    (
      await req('/api/private/project-reports/' + fresh, 'POST', undefined, 2, {
        'X-Test-Body': 'late',
      })
    ).status,
  ).toBe(408);
  expect(Date.now() - start).toBeLessThan(6500);
  await new Promise((r) => setTimeout(r, 700));
  expect(
    (await db.prepare('SELECT count(*) n FROM project_reports').first<{ n: number }>())!.n,
  ).toBe(before);
}, 8000);
it('never acknowledges failed inserts and refuses malformed cases/storage without false empty', async () => {
  const db = await mf.getD1Database('DB'),
    fresh = await seedProject();
  await db
    .prepare(
      "CREATE TRIGGER fixture_report_abort BEFORE INSERT ON project_reports BEGIN SELECT RAISE(ABORT,'fixture'); END",
    )
    .run();
  try {
    expect(
      (await req('/api/private/project-reports/' + fresh, 'POST', { reason: 'r' })).status,
    ).toBe(404);
    expect(await (await req('/api/private/project-reports/' + fresh)).json()).toEqual({
      received: false,
    });
  } finally {
    await db.prepare('DROP TRIGGER fixture_report_abort').run();
  }
  await db
    .prepare('UPDATE project_reports SET reason=? WHERE project_id=?')
    .bind('x'.repeat(201), project)
    .run();
  expect((await req(queue + '/' + project, 'GET', undefined, 1)).status).toBe(404);
  for (const table of ['project_moderation_email_deliveries', 'project_report_outbox'])
    await db.prepare('DROP TABLE ' + table).run();
  await db.prepare('DROP TABLE project_reports').run();
  expect((await req(queue, 'GET', undefined, 1)).status).toBe(404);
  expect((await req(reportPath())).status).toBe(404);
});
