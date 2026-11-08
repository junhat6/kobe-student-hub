import { afterEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { AdmissionStore } from '../worker/auth/admission';
import { BrowserSessionCoordinator } from '../worker/auth/browser-session';
import { BrowserOAuthFlow } from '../worker/auth/browser-flow';
import { SessionStore } from '../worker/auth/sessions';
import { PendingRegistrationStore } from '../worker/auth/pending-registration';
const O = 'https://admission.example.invalid',
  NOW = 1800000000000;
const policy = {
  pendingRetentionMs: 86400000,
  auditRetentionMs: 172800000,
  maintenanceIntervalMs: 60000,
};
const instances: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map((m) => m.dispose()));
});
async function setup() {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("local only")}}',
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
    }),
  );
  instances.push(mf);
  const db = (await mf.getD1Database('DB')) as unknown as D1Database;
  for (const file of [
    '0003_oauth_attempts.sql',
    '0004_private_sessions.sql',
    '0012_browser_session_order.sql',
    '0013_local_admission.sql',
  ]) {
    const text = readFileSync('migrations/' + file, 'utf8');
    const sql = text
      .split(text.includes('-- @statement') ? /^-- @statement\s*$/m : /;\s*(?:\n|$)/)
      .map((s) => s.replace(/^--.*$/gm, '').trim())
      .filter(Boolean);
    await db.batch(sql.map((s) => db.prepare(s)));
  }
  let now = NOW;
  const clock = () => now;
  await db
    .prepare(
      "INSERT INTO private_accounts VALUES('operator','operator-subject','operator@st.kobedenshi.ac.jp','active',0,?)",
    )
    .bind(now)
    .run();
  const operator = (await session(db, 'operator-subject', 'operator', now))!;
  const headers = {
    Origin: O,
    Cookie: [operator.setCookie, operator.contextCookie].map((s) => s.split(';')[0]).join('; '),
    Authorization: 'Bearer csrf.' + operator.csrfToken,
  };
  const request = () => new Request(O + '/private/admission', { method: 'POST', headers });
  const grant = () =>
    db
      .prepare("INSERT INTO private_admission_operators VALUES('operator',?,?,NULL)")
      .bind(NOW, NOW + 28800000)
      .run();
  const store = new AdmissionStore(db, O, policy, clock);
  async function pending(subject = 'student') {
    const c = await claim(db, now, 'pending-registration');
    expect(
      await new PendingRegistrationStore(db, clock).record(
        { provider: 'google', subject, email: subject + '@st.kobedenshi.ac.jp' },
        c.proof,
      ),
    ).toEqual({ recorded: true });
    return (await db
      .prepare('SELECT id FROM private_accounts WHERE google_subject=?')
      .bind(subject)
      .first<{ id: string }>())!.id;
  }
  return {
    db,
    store,
    request,
    grant,
    pending,
    clock,
    advance: (n: number) => {
      now = n;
    },
    operator,
    headers,
  };
}
async function claim(
  db: D1Database,
  now: number,
  intent: 'login' | 'pending-registration' = 'login',
) {
  const c = new BrowserSessionCoordinator(db, O, () => now);
  const b = (await c.bootstrap(new Request(O, { method: 'POST', headers: { Origin: O } })))!;
  const h = new Headers({ Origin: O, Cookie: b.setCookie.split(';')[0] });
  const command = (await c.command(new Request(O, { method: 'POST', headers: h }), intent))!;
  h.set('Authorization', 'Bearer command.' + command.commandToken);
  const flow = new BrowserOAuthFlow(
    db,
    {
      origin: O,
      clientId: 'local.apps.googleusercontent.com',
      cookieKey: new Uint8Array(32).fill(29),
    },
    () => now,
  );
  const start = (await flow.start(
    new Request(O + '/api/auth/start', { method: 'POST', headers: h }),
    intent,
  ))!;
  const state = new URL(start.location).searchParams.get('state');
  const r = await flow.claim(
    new Request(O + '/api/auth/callback?state=' + state + '&code=fictional', {
      headers: { Cookie: b.setCookie.split(';')[0] + '; ' + start.setCookie.split(';')[0] },
    }),
    intent,
  );
  if (r?.kind !== 'code') throw Error('fixture claim');
  return { proof: r.proof, contextCookie: b.setCookie };
}
async function session(db: D1Database, subject: string, email: string, now: number) {
  const c = await claim(db, now);
  const s = await new SessionStore(db, O, () => now).create(
    { provider: 'google', subject, email: email + '@st.kobedenshi.ac.jp' },
    c.proof,
  );
  return s ? { ...s, contextCookie: c.contextCookie } : null;
}
const decision = (
  targetId: string,
  action: 'approve' | 'withdraw' = 'approve',
  expectedEpoch = 0,
) => ({ targetId, action, expectedEpoch, reviewReference: crypto.randomUUID() });
const account = (db: D1Database, id: string) =>
  db.prepare('SELECT status,session_epoch FROM private_accounts WHERE id=?').bind(id).first();
it('records verified synthetic pending without login; explicit operator decision then permits fresh login', async () => {
  const t = await setup(),
    id = await t.pending();
  expect(await session(t.db, 'student', 'student', NOW)).toBeNull();
  await t.grant();
  expect(await t.store.decide(t.request(), decision(id))).toEqual({ recorded: true });
  expect(await account(t.db, id)).toEqual({ status: 'active', session_epoch: 1 });
  expect(await session(t.db, 'student', 'student', NOW)).not.toBeNull();
  const rows = (await t.db.prepare('SELECT * FROM private_admission_audit').all()).results;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    actor_account_id: 'operator',
    target_account_id: id,
    action: 'approve',
  });
  expect(JSON.stringify(rows)).not.toContain('@');
  expect(Object.keys(rows[0])).not.toContain('google_subject');
});
it('active session alone is not an operator and client claims cannot create a grant', async () => {
  const t = await setup(),
    id = await t.pending();
  const h = { ...t.headers, 'X-Operator': 'true' };
  expect(
    await t.store.decide(new Request(O, { method: 'POST', headers: h }), decision(id)),
  ).toBeNull();
  expect(await account(t.db, id)).toEqual({ status: 'pending', session_epoch: 0 });
  expect((await t.db.prepare('SELECT * FROM private_admission_operators').all()).results).toEqual(
    [],
  );
});
it('refuses self-approval and self-withdrawal without a decision or state change', async () => {
  const t = await setup();
  await t.grant();
  expect(await t.store.decide(t.request(), decision('operator', 'withdraw'))).toBeNull();
  expect(await account(t.db, 'operator')).toEqual({ status: 'active', session_epoch: 0 });
});
it('requires same-origin POST, live session and CSRF; never accepts a client actor', async () => {
  const t = await setup(),
    id = await t.pending();
  await t.grant();
  for (const r of [
    new Request(O, { headers: t.headers }),
    new Request(O, { method: 'POST', headers: { ...t.headers, Origin: 'https://other.invalid' } }),
    new Request(O, {
      method: 'POST',
      headers: { ...t.headers, Authorization: 'Bearer csrf.' + 'x'.repeat(43) },
    }),
    new Request(O, { method: 'POST', headers: { Origin: O } }),
  ])
    expect(await t.store.decide(r, decision(id))).toBeNull();
  expect(await account(t.db, id)).toEqual({ status: 'pending', session_epoch: 0 });
});
it('operator expiry and revocation deny decisions', async () => {
  for (const change of ['expiry', 'revoke']) {
    const t = await setup(),
      id = await t.pending();
    await t.grant();
    await t.db
      .prepare(
        change === 'expiry'
          ? 'UPDATE private_admission_operators SET granted_at_ms=granted_at_ms-1,expires_at_ms=?'
          : 'UPDATE private_admission_operators SET revoked_at_ms=?',
      )
      .bind(NOW)
      .run();
    expect(await t.store.decide(t.request(), decision(id))).toBeNull();
  }
});
it('exact status/epoch CAS permits one of twelve competing approvals with one audit', async () => {
  const t = await setup(),
    id = await t.pending();
  await t.grant();
  const results = await Promise.all(
    Array.from({ length: 12 }, () => t.store.decide(t.request(), decision(id))),
  );
  expect(results.filter(Boolean)).toHaveLength(1);
  expect((await t.db.prepare('SELECT * FROM private_admission_audit').all()).results).toHaveLength(
    1,
  );
  expect(await t.store.decide(t.request(), decision(id))).toBeNull();
});
it('withdraws active access, revokes existing session through epoch and blocks old in-flight login', async () => {
  const t = await setup(),
    id = await t.pending();
  await t.grant();
  expect(await t.store.decide(t.request(), decision(id))).toBeTruthy();
  const student = (await session(t.db, 'student', 'student', NOW))!;
  const old = await claim(t.db, NOW);
  expect(await t.store.decide(t.request(), decision(id, 'withdraw', 1))).toEqual({
    recorded: true,
  });
  expect(await account(t.db, id)).toEqual({ status: 'suspended', session_epoch: 2 });
  expect(
    await new SessionStore(t.db, O, () => NOW).authenticate(
      new Request(O, {
        headers: {
          Cookie: [student.setCookie, student.contextCookie].map((s) => s.split(';')[0]).join('; '),
        },
      }),
    ),
  ).toBeNull();
  expect(
    await new SessionStore(t.db, O, () => NOW).create(
      { provider: 'google', subject: 'student', email: 'student@st.kobedenshi.ac.jp' },
      old.proof,
    ),
  ).toBeNull();
  expect(await t.store.decide(t.request(), decision(id, 'approve', 2))).toBeNull();
});
it('audit insertion/trigger failure cannot change target state', async () => {
  const t = await setup(),
    id = await t.pending();
  await t.grant();
  await t.db
    .prepare(
      "CREATE TRIGGER fixture_abort AFTER INSERT ON private_admission_audit BEGIN SELECT RAISE(ABORT,'local fault'); END",
    )
    .run();
  expect(await t.store.decide(t.request(), decision(id))).toBeNull();
  expect(await account(t.db, id)).toEqual({ status: 'pending', session_epoch: 0 });
  expect((await t.db.prepare('SELECT * FROM private_admission_audit').all()).results).toEqual([]);
});
it('cannot alter audit entries and bounds reference/input without storing raw evidence', async () => {
  const t = await setup(),
    id = await t.pending();
  await t.grant();
  for (const patch of [
    { reviewReference: 'student@st.kobedenshi.ac.jp' },
    { expectedEpoch: -1 },
    { action: 'restore' },
    { targetId: 'bad\n' },
  ])
    expect(await t.store.decide(t.request(), { ...decision(id), ...patch } as any)).toBeNull();
  expect(await t.store.decide(t.request(), decision(id))).toBeTruthy();
  await expect(
    t.db.prepare("UPDATE private_admission_audit SET action='withdraw'").run(),
  ).rejects.toThrow();
  expect((await t.db.prepare('SELECT action FROM private_admission_audit').first())?.action).toBe(
    'approve',
  );
});
it('rechecks operator session/grant in final SQL after preflight races', async () => {
  for (const kind of ['role', 'context', 'account']) {
    const t = await setup(),
      id = await t.pending();
    await t.grant();
    let fired = false;
    const db = new Proxy(t.db, {
      get(target, key) {
        if (key === 'prepare')
          return (sql: string) => {
            const statement = target.prepare(sql);
            if (!fired && sql.startsWith('INSERT INTO private_admission_audit')) {
              fired = true;
              return new Proxy(statement, {
                get(st, k) {
                  if (k === 'bind')
                    return (...args: any[]) => {
                      const bound = st.bind(...args);
                      return {
                        first: async () => {
                          await target
                            .prepare(
                              kind === 'role'
                                ? 'UPDATE private_admission_operators SET revoked_at_ms=1800000000000'
                                : kind === 'context'
                                  ? 'UPDATE auth_browser_contexts SET generation=generation+1'
                                  : "UPDATE private_accounts SET status='suspended' WHERE id='operator'",
                            )
                            .run();
                          return bound.first();
                        },
                      };
                    };
                  const v = Reflect.get(st, k);
                  return typeof v === 'function' ? v.bind(st) : v;
                },
              });
            }
            return statement;
          };
        const v = Reflect.get(target, key);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    expect(
      await new AdmissionStore(db, O, policy, t.clock).decide(t.request(), decision(id)),
    ).toBeNull();
    expect(fired).toBe(true);
    expect(await account(t.db, id)).toEqual({ status: 'pending', session_epoch: 0 });
  }
});
it('purges only expired never-active pending and audits, bounded100 with interval and clock rollback refusal', async () => {
  const t = await setup();
  const values = Array.from({ length: 105 }, (_, i) =>
    t.db
      .prepare("INSERT INTO private_accounts VALUES(?,?,?,'pending',0,?)")
      .bind('old' + i, 'old-sub' + i, 'old' + i + '@st.kobedenshi.ac.jp', NOW),
  );
  await t.db.batch(values);
  await t.db
    .prepare(
      "INSERT INTO private_accounts VALUES('keep-active','keep','keep@st.kobedenshi.ac.jp','active',0,?)",
    )
    .bind(NOW)
    .run();
  const student = await t.pending();
  await t.grant();
  await t.store.decide(t.request(), decision(student));
  t.advance(NOW + policy.auditRetentionMs);
  expect(await t.store.purge()).toEqual({ pending: 100, audits: 1 });
  expect(await t.store.purge()).toBeNull();
  t.advance(NOW + policy.auditRetentionMs - 1);
  expect(await t.store.purge()).toBeNull();
  t.advance(NOW + policy.auditRetentionMs + policy.maintenanceIntervalMs);
  expect(await t.store.purge()).toEqual({ pending: 5, audits: 0 });
  expect(await account(t.db, 'keep-active')).toBeTruthy();
  expect(await account(t.db, student)).toBeTruthy();
  expect(
    (await t.db.prepare('SELECT count(*) n FROM auth_subject_fences').first())?.n,
  ).toBeGreaterThanOrEqual(105);
});
it('retention deletion invalidates old registration but new verified registration remains pending', async () => {
  const t = await setup();
  await t.pending();
  const old = await claim(t.db, NOW, 'pending-registration');
  t.advance(NOW + policy.pendingRetentionMs);
  expect(await t.store.purge()).toEqual({ pending: 1, audits: 0 });
  const identity = {
    provider: 'google' as const,
    subject: 'student',
    email: 'student@st.kobedenshi.ac.jp',
  };
  expect(
    await new PendingRegistrationStore(t.db, () => NOW).record(identity, old.proof),
  ).toBeNull();
  const fresh = await claim(t.db, t.clock(), 'pending-registration');
  expect(await new PendingRegistrationStore(t.db, t.clock).record(identity, fresh.proof)).toEqual({
    recorded: true,
  });
});
it('invalid or absent retention policy does not decide or purge', async () => {
  const t = await setup(),
    target = await t.pending();
  await t.grant();
  for (const patch of [
    { pendingRetentionMs: 0 },
    { auditRetentionMs: NaN },
    { maintenanceIntervalMs: -1 },
  ]) {
    const store = new AdmissionStore(t.db, O, { ...policy, ...patch }, t.clock);
    expect(await store.decide(t.request(), decision(target))).toBeNull();
    expect(await store.purge()).toBeNull();
  }
});
