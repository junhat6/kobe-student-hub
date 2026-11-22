import { applyFixtureMigrations } from './helpers/migrations';
import { workerModules } from './helpers/worker-modules';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { dispatchModerationEmails } from '../worker/moderation-email';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { ProfileReportCase, ProfileReportCaseSummary } from '../src/profile-report-types';
const O = 'https://app.example.invalid',
  NOW = 1800000000000;
let mf: Miniflare;
type Session = { setCookie: string; contextCookie: string; csrfToken: string };
type Profile = { profile: { id: string } };
let users: Session[], author: string, quiet: string;
const reportPath = (id = author) => '/api/private/profile-reports/' + id,
  queue = '/api/private/profile-moderation/cases';
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
  if (path.startsWith('/api/private/profile-')) {
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
async function profileFor(n: number, displayName: string) {
  const r = (await (
    await req(
      '/fixture/profile',
      'POST',
      { displayName, department: 'IT', yearLabel: '2年', bio: 'Original bio', confirmPublic: true },
      n,
    )
  ).json()) as Profile;
  return r.profile.id;
}
async function publishProject(n: number) {
  const d = (await (
    await req(
      '/api/private/project-drafts',
      'POST',
      { title: 'Visible work', description: 'Saved', githubUrl: '', demoUrl: '' },
      n,
    )
  ).json()) as { id: string };
  const r = await req(
    '/api/private/project-publications/' + d.id,
    'POST',
    { expectedVersion: 1, confirmPublic: true },
    n,
  );
  expect([200, 201]).toContain(r.status);
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: workerModules('.worker/profile-reports-test.js'),
      compatibilityDate: '2026-11-03',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: ['DB'],
    }),
  );
  const db = await mf.getD1Database('DB');
  await applyFixtureMigrations(db);
  users = [];
  for (let n = 0; n < 6; n++) {
    await db
      .prepare(
        "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)",
      )
      .bind('account-' + n, 'subject-' + n, n + '@st.kobedenshi.ac.jp', NOW)
      .run();
    users.push(await login(n));
  }
  author = await profileFor(0, 'Reported author');
  await publishProject(0);
  // A profile with no published work is not public, so it cannot be reported either.
  quiet = await profileFor(5, 'Quiet author');
});
afterAll(async () => {
  await mf?.dispose();
});
it('separates no receipt, empty operator queue and unavailable targets', async () => {
  expect(await (await req(reportPath(), 'GET', undefined, 2)).json()).toEqual({ received: false });
  expect(await (await req(queue, 'GET', undefined, 1)).json()).toEqual([]);
  expect((await req(queue, 'GET', undefined, 2)).status).toBe(404);
  expect((await req(queue, 'GET', undefined, 1, { 'X-Test-No-Operator': '1' })).status).toBe(404);
  expect((await req(reportPath('profile-missing'), 'GET', undefined, 2)).status).toBe(404);
  expect((await req(reportPath(quiet), 'GET', undefined, 2)).status).toBe(404);
  expect((await req(reportPath('sample-a'), 'GET', undefined, 2)).status).toBe(404);
});
it('refuses the author reporting their own profile, on the API and in the table trigger', async () => {
  expect((await req(reportPath(), 'GET', undefined, 0)).status).toBe(404);
  expect((await req(reportPath(), 'POST', { reason: 'Self' }, 0)).status).toBe(404);
  expect((await req(reportPath(quiet), 'POST', { reason: 'Not public' }, 2)).status).toBe(404);
  const db = await mf.getD1Database('DB');
  await expect(
    db
      .prepare(
        "INSERT INTO profile_reports SELECT ?,p.id,'account-0','Self','',p.display_name,p.department,p.year_label,p.bio,? FROM public_profiles p WHERE p.id=?",
      )
      .bind(crypto.randomUUID(), NOW, author)
      .run(),
  ).rejects.toThrow();
  expect(
    (await db.prepare('SELECT count(*) n FROM profile_reports').first<{ n: number }>())!.n,
  ).toBe(0);
});
it('deduplicates concurrent reports per account, keeps the original reason and snapshot', async () => {
  const rs = await Promise.all(
    Array.from({ length: 8 }, () =>
      req(reportPath(), 'POST', { reason: 'Original reason', detail: 'Private detail' }, 2),
    ),
  );
  expect(rs.every((r) => r.status === 201)).toBe(true);
  for (const r of rs) expect(await r.json()).toEqual({ received: true });
  expect((await req(reportPath(), 'POST', { reason: 'Replacement' }, 2)).status).toBe(201);
  expect(await (await req(reportPath(), 'GET', undefined, 2)).json()).toEqual({ received: true });
  expect(await (await req(reportPath(), 'GET', undefined, 3)).json()).toEqual({ received: false });
  const db = await mf.getD1Database('DB');
  expect(
    await db.prepare('SELECT reason,detail,bio,reporter_account_id FROM profile_reports').all(),
  ).toMatchObject({
    results: [
      {
        reason: 'Original reason',
        detail: 'Private detail',
        bio: 'Original bio',
        reporter_account_id: 'account-2',
      },
    ],
  });
  expect(
    (await db.prepare('SELECT report_count,event FROM profile_report_outbox').all()).results,
  ).toEqual([{ report_count: 1, event: 'report_received' }]);
  await expect(db.prepare("UPDATE profile_reports SET reason='Rewritten'").run()).rejects.toThrow();
});
it('rejects signed-out, missing CSRF, malformed input and unknown routes', async () => {
  const anonymous = await mf.dispatchFetch(O + reportPath(), {
    method: 'POST',
    headers: { Origin: O, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'x' }),
  });
  expect(anonymous.status).toBe(401);
  const { Authorization: _, ...noCsrf } = h(3);
  const forged = await mf.dispatchFetch(O + reportPath(), {
    method: 'POST',
    headers: noCsrf,
    body: JSON.stringify({ reason: 'x' }),
  });
  expect(forged.status).toBe(401);
  for (const v of [
    {},
    { reason: '' },
    { reason: '  ' },
    { reason: 'x'.repeat(201) },
    { reason: 'x', detail: 'y'.repeat(2001) },
    { reason: 'x', reporterAccountId: 'account-4' },
    { reason: 'x\0' },
  ])
    expect((await req(reportPath(), 'POST', v, 3)).status).toBe(404);
  expect((await req(reportPath(), 'DELETE', undefined, 3)).status).toBe(405);
  expect((await req(queue, 'POST', {}, 1)).status).toBe(405);
  expect((await req('/api/private/profile-reports', 'GET', undefined, 3)).status).toBe(404);
  expect((await req(reportPath() + '?x=1', 'GET', undefined, 3)).status).toBe(404);
  expect(await (await req(reportPath(), 'GET', undefined, 3)).json()).toEqual({ received: false });
});
it('reaches profile reports through the production composition, not the own-profile route', async () => {
  const r = await req(reportPath(), 'POST', { reason: 'Second account' }, 3, {
    'X-Test-Composed': '1',
  });
  expect(r.status).toBe(201);
  expect(await r.json()).toEqual({ received: true });
  const own = await req('/api/private/profile', 'GET', undefined, 0, { 'X-Test-Composed': '1' });
  expect(own.status).toBe(200);
});
it('shows operators the current profile and what each reporter saw, without identities', async () => {
  const db = await mf.getD1Database('DB');
  await db
    .prepare("UPDATE public_profiles SET bio='Edited after report' WHERE id=?")
    .bind(author)
    .run();
  const list = (await (await req(queue, 'GET', undefined, 1)).json()) as ProfileReportCaseSummary[];
  expect(list).toEqual([
    {
      profileId: author,
      displayName: 'Reported author',
      reportCount: 2,
      latestReportAt: NOW,
    },
  ]);
  const r = await req(queue + '/' + author, 'GET', undefined, 1);
  const c = (await r.json()) as ProfileReportCase;
  expect(c.profile).toMatchObject({ id: author, bio: 'Edited after report' });
  expect(c.reports.map((x) => x.reason).sort()).toEqual(['Original reason', 'Second account']);
  expect(c.reports.every((x) => x.reported.bio === 'Original bio')).toBe(true);
  expect(c.reportsTruncated).toBe(false);
  const raw = JSON.stringify(c) + JSON.stringify(list);
  for (const marker of ['account-', 'subject-', '@st.kobedenshi', 'reporter'])
    expect(raw).not.toContain(marker);
  expect((await req(queue + '/' + author, 'GET', undefined, 2)).status).toBe(404);
  expect((await req(queue + '/' + quiet, 'GET', undefined, 1)).status).toBe(404);
});
it('emails the operator once per profile report with a profile case link and no report text', async () => {
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
  let accepted = 0;
  for (let i = 0; i < 4 && accepted < 2; i++)
    accepted += (await dispatchModerationEmails(db, options, () => NOW + 10)).accepted;
  expect(accepted).toBe(2);
  expect((await dispatchModerationEmails(db, options, () => NOW + 11)).attempted).toBe(0);
  expect(
    (await db
      .prepare(
        "SELECT count(*) n FROM profile_moderation_email_deliveries WHERE state='accepted' AND attempts=1",
      )
      .first<{ n: number }>())!.n,
  ).toBe(2);
  for (const m of sent) {
    expect(m.subject).toBe('プロフィールの通報が届いています');
    expect(m.text).toBe(
      '運営画面でプロフィールと通報内容を確認できます。\n' +
        O +
        '/moderation?type=profile&case=' +
        encodeURIComponent(author),
    );
    for (const marker of ['Original reason', 'Private detail', 'account-', '@st.kobedenshi'])
      expect(JSON.stringify(m)).not.toContain(marker);
  }
});
