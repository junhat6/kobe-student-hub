import { beforeAll, afterAll, it, expect } from 'vitest';
import { createSessionLab, LabJar, LAB_NOW, LAB_ORIGIN } from './helpers/session-order-http';
let lab: Awaited<ReturnType<typeof createSessionLab>>;
beforeAll(async () => {
  lab = await createSessionLab();
});
afterAll(async () => {
  await lab?.dispose();
});
const epoch = async (j: LabJar) =>
  (await lab.db
    .prepare('SELECT epoch FROM lab_contexts WHERE id=?')
    .bind(j.value('__Host-lab-context'))
    .first<{ epoch: number }>())!.epoch;
const count = async (table: string) =>
  Number((await lab.db.prepare('SELECT count(*) n FROM ' + table).first<{ n: number }>())!.n);
it('uses an actual loopback HTTP listener, anonymous bootstrap and strict Cookie attributes', async () => {
  expect(new URL(lab.base).hostname).toBe('127.0.0.1');
  const j = new LabJar(),
    a = await count('lab_attempts'),
    s = await count('lab_sessions'),
    r = await lab.call(j, '/lab/bootstrap', 'POST');
  expect(r.status).toBe(204);
  expect(r.headers.getSetCookie()).toEqual([
    expect.stringMatching(
      /^__Host-lab-context=.+; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=900$/,
    ),
  ]);
  expect(await count('lab_attempts')).toBe(a);
  expect(await count('lab_sessions')).toBe(s);
  for (const path of ['/lab/bootstrap', '/lab/proof?action=start']) {
    const bad = await lab.call(j, path, 'POST', true, { Origin: 'https://foreign.invalid' });
    expect(bad.status).toBe(403);
    expect(bad.headers.getSetCookie()).toEqual([]);
  }
  expect((await lab.call(j, '/lab/bootstrap', 'POST')).status).toBe(409);
  expect((await lab.call(j, '/lab/start', 'POST')).status).toBe(403);
});
it('cannot start without established context, or promote an invented context to authentication', async () => {
  const j = new LabJar();
  expect((await lab.call(j, '/lab/proof?action=start', 'POST')).status).toBe(409);
  j.values.set('__Host-lab-context', { value: crypto.randomUUID(), expires: LAB_NOW + 100000 });
  const supplied = j.value('__Host-lab-context');
  await lab.bootstrap(j);
  expect(j.value('__Host-lab-context')).not.toBe(supplied);
  expect((await lab.inspect(j)).status).toBe(401);
});
it('serializes distinct same-epoch start commands and binds only the winner generation', async () => {
  const j = await lab.bootstrap(),
    a = await lab.proof(j),
    b = await lab.proof(j);
  const rs = await Promise.all([lab.start(j, a, false), lab.start(j, b, false)]);
  expect(rs.map((x) => x.response.status).sort()).toEqual([303, 409]);
  expect(await epoch(j)).toBe(1);
  const winner = rs.find((x) => x.response.status === 303)!;
  expect(
    await lab.db.prepare('SELECT epoch FROM lab_attempts WHERE id=?').bind(winner.state).first(),
  ).toEqual({ epoch: 1 });
});
it('same command replay is acknowledged without new generation, attempt or Cookie, even after B', async () => {
  const j = await lab.bootstrap(),
    cmd = await lab.proof(j),
    first = await lab.start(j, cmd);
  const rs = await Promise.all(Array.from({ length: 6 }, () => lab.start(j, cmd, false)));
  expect(
    rs.every((r) => r.response.status === 200 && r.response.headers.getSetCookie().length === 0),
  ).toBe(true);
  expect(await epoch(j)).toBe(1);
  await lab.callback(j, first.state, 'A');
  await lab.login(j, 'B');
  const before = await epoch(j);
  expect((await lab.start(j, cmd)).response.status).toBe(200);
  expect(await epoch(j)).toBe(before);
  expect((await lab.inspect(j)).body.actor).toBe('B');
});
it('rolls back command consumption, epoch and attempt when a later batch statement fails', async () => {
  const j = await lab.bootstrap(),
    cmd = await lab.proof(j),
    before = await count('lab_attempts');
  const r = await lab.start(j, cmd, true, { 'X-Lab-Fault': 'command' });
  expect(r.response.status).toBe(503);
  expect(r.response.headers.getSetCookie()).toEqual([]);
  expect(await epoch(j)).toBe(0);
  expect(await count('lab_attempts')).toBe(before);
  expect(
    await lab.db.prepare('SELECT completed FROM lab_commands WHERE id=?').bind(cmd).first(),
  ).toEqual({ completed: 0 });
  expect((await lab.start(j, cmd)).response.status).toBe(303);
  expect(await epoch(j)).toBe(1);
});
it('does not repeat a committed command after an uncertain acknowledgement', async () => {
  const j = await lab.bootstrap(),
    cmd = await lab.proof(j);
  expect((await lab.start(j, cmd, true, { 'X-Lab-Fault': 'after-command' })).response.status).toBe(
    503,
  );
  expect(await epoch(j)).toBe(1);
  const retry = await lab.start(j, cmd);
  expect(retry.response.status).toBe(200);
  expect(retry.response.headers.getSetCookie()).toEqual([]);
  expect(await epoch(j)).toBe(1);
  expect((await lab.inspect(j)).status).toBe(401);
  await lab.login(j, 'B');
  expect((await lab.inspect(j)).body.actor).toBe('B');
});
it('claims only once under concurrent callbacks and creates only one session', async () => {
  const j = await lab.bootstrap(),
    a = await lab.start(j),
    before = await count('lab_sessions');
  const rs = await Promise.all(
    Array.from({ length: 8 }, () => lab.callback(j, a.state, 'A', false)),
  );
  expect(rs.filter((r) => r.headers.getSetCookie().length === 1)).toHaveLength(1);
  expect(lab.exchangeCounts.get(a.state)).toBe(1);
  expect(await count('lab_sessions')).toBe(before + 1);
});
it('consumes provider failure and never lets a repeated callback exchange again', async () => {
  const j = await lab.bootstrap(),
    a = await lab.start(j);
  expect((await lab.callback(j, a.state, 'fail')).headers.getSetCookie()).toEqual([]);
  expect((await lab.callback(j, a.state, 'A')).headers.getSetCookie()).toEqual([]);
  expect(lab.exchangeCounts.get(a.state)).toBe(1);
  expect((await lab.inspect(j)).status).toBe(401);
});
it('rejects A completion after B starts while the already claimed A waits', async () => {
  const j = await lab.bootstrap(),
    a = await lab.start(j),
    p = lab.pause('claim-A'),
    pending = lab.callback(j, a.state, 'A', false, { 'X-Lab-Pause-claim': 'claim-A' });
  let late: Response;
  try {
    await p.ready;
    expect(
      await lab.db
        .prepare('SELECT owner IS NOT NULL claimed FROM lab_attempts WHERE id=?')
        .bind(a.state)
        .first(),
    ).toEqual({ claimed: 1 });
    await lab.login(j, 'B');
  } finally {
    p.release();
    late = await pending;
  }
  expect(late!.headers.getSetCookie()).toEqual([]);
  expect((await lab.inspect(j)).body.actor).toBe('B');
});
it('rejects late A session Cookie after B and requires explicit verified recovery', async () => {
  const j = await lab.bootstrap(),
    a = await lab.start(j),
    late = await lab.callback(j, a.state, 'A', false);
  await lab.login(j, 'B');
  expect((await lab.inspect(j)).body.actor).toBe('B');
  j.apply(late);
  expect((await lab.inspect(j)).status).toBe(401);
  expect((await lab.call(j, '/lab/read')).status).toBe(401);
  await lab.login(j, 'B');
  expect((await lab.inspect(j)).body.actor).toBe('B');
});
it('a late old start header can lose the new attempt, but cannot issue an old identity', async () => {
  const j = await lab.bootstrap(),
    old = await lab.start(j, undefined, false),
    newer = await lab.start(j);
  j.apply(old.response);
  expect((await lab.callback(j, old.state, 'A')).headers.getSetCookie()).toEqual([]);
  expect((await lab.callback(j, newer.state, 'B')).headers.getSetCookie()).toEqual([]);
  expect(lab.exchangeCounts.get(old.state)).toBeUndefined();
  expect((await lab.inspect(j)).status).toBe(401);
});
it('rechecks last SQL for private read and write after another tab starts', async () => {
  for (const action of ['read', 'write']) {
    const j = await lab.bootstrap();
    await lab.login(j, 'A');
    const { body } = await lab.inspect(j),
      p = lab.pause('final-' + action),
      version = await lab.db.prepare("SELECT version FROM lab_records WHERE actor='A'").first();
    const pending = lab.call(j, '/lab/' + action, action === 'write' ? 'POST' : 'GET', true, {
      'X-Lab-Session-CSRF': body.csrf!,
      ['X-Lab-Pause-' + action]: 'final-' + action,
    });
    let r: Response;
    try {
      await p.ready;
      await lab.start(j);
    } finally {
      p.release();
      r = await pending;
    }
    expect(r!.status).toBe(401);
    expect(await r!.text()).not.toContain('fictional-A');
    expect(await lab.db.prepare("SELECT version FROM lab_records WHERE actor='A'").first()).toEqual(
      version,
    );
  }
});
it('logout with an obsolete session blocks pending and late successful callbacks', async () => {
  const j = await lab.bootstrap(),
    a = await lab.start(j),
    late = await lab.callback(j, a.state, 'A', false),
    b = await lab.start(j),
    p = lab.pause('logout-claim'),
    pending = lab.callback(j, b.state, 'B', false, { 'X-Lab-Pause-claim': 'logout-claim' });
  j.apply(late);
  let r: Response;
  try {
    await p.ready;
    const cmd = await lab.proof(j, 'logout'),
      out = await lab.call(j, '/lab/logout', 'POST', true, { 'X-Lab-Command': cmd });
    expect(out.status).toBe(200);
    expect(out.headers.getSetCookie()).toEqual([]);
  } finally {
    p.release();
    r = await pending;
  }
  expect(r!.headers.getSetCookie()).toEqual([]);
  j.apply(late);
  expect((await lab.inspect(j)).status).toBe(401);
});
it('logout replay does not kill B; stale unexecuted logout proof rejects instead of adopting B epoch', async () => {
  const j = await lab.bootstrap(),
    cmd = await lab.proof(j, 'logout');
  expect((await lab.call(j, '/lab/logout', 'POST', true, { 'X-Lab-Command': cmd })).status).toBe(
    200,
  );
  await lab.login(j, 'B');
  const before = await epoch(j);
  expect((await lab.call(j, '/lab/logout', 'POST', true, { 'X-Lab-Command': cmd })).status).toBe(
    200,
  );
  expect(await epoch(j)).toBe(before);
  expect((await lab.inspect(j)).body.actor).toBe('B');
  const stale = await lab.proof(j, 'logout');
  await lab.login(j, 'B');
  expect((await lab.call(j, '/lab/logout', 'POST', true, { 'X-Lab-Command': stale })).status).toBe(
    409,
  );
  expect((await lab.inspect(j)).body.actor).toBe('B');
});
it('cannot replay a proof across actions or browser contexts, and isolates another device', async () => {
  const a = await lab.bootstrap(),
    b = await lab.bootstrap(),
    cmd = await lab.proof(a);
  expect((await lab.call(a, '/lab/logout', 'POST', true, { 'X-Lab-Command': cmd })).status).toBe(
    409,
  );
  expect((await lab.start(b, cmd)).response.status).toBe(409);
  await lab.login(a, 'A');
  await lab.login(b, 'B');
  const logout = await lab.proof(a, 'logout');
  await lab.call(a, '/lab/logout', 'POST', true, { 'X-Lab-Command': logout });
  expect((await lab.inspect(a)).status).toBe(401);
  expect((await lab.inspect(b)).body.actor).toBe('B');
});
it('late unused bootstrap mismatches B; established context is never reissued', async () => {
  const empty = new LabJar(),
    held = await lab.call(empty, '/lab/bootstrap', 'POST', false),
    j = await lab.bootstrap();
  await lab.login(j, 'B');
  const ctx = j.value('__Host-lab-context');
  expect((await lab.call(j, '/lab/bootstrap', 'POST')).headers.getSetCookie()).toEqual([]);
  const cmd = await lab.proof(j, 'logout');
  expect(
    (
      await lab.call(j, '/lab/logout', 'POST', true, { 'X-Lab-Command': cmd })
    ).headers.getSetCookie(),
  ).toEqual([]);
  await lab.login(j, 'B');
  expect(j.value('__Host-lab-context')).toBe(ctx);
  j.apply(held);
  expect((await lab.inspect(j)).status).toBe(401);
  await lab.login(j, 'B');
  expect((await lab.inspect(j)).body.actor).toBe('B');
});
it('guards expiry at final issue/read/write, not only request preflight', async () => {
  const j = await lab.bootstrap(),
    a = await lab.start(j);
  expect(
    (
      await lab.callback(j, a.state, 'A', true, { 'X-Lab-After-Now': String(LAB_NOW + 60001) })
    ).headers.getSetCookie(),
  ).toEqual([]);
  await lab.login(j, 'A');
  const { body } = await lab.inspect(j);
  for (const path of ['read', 'write']) {
    const r = await lab.call(j, '/lab/' + path, path === 'write' ? 'POST' : 'GET', true, {
      'X-Lab-After-Now': String(LAB_NOW + 300001),
      'X-Lab-Session-CSRF': body.csrf!,
    });
    expect(r.status).toBe(401);
  }
});
it('completion batch failure rolls back session plus completion but never unconsumes its claim', async () => {
  const j = await lab.bootstrap(),
    a = await lab.start(j),
    before = await count('lab_sessions');
  const r = await lab.callback(j, a.state, 'A', true, { 'X-Lab-Fault': 'issue' });
  expect(r.status).toBe(503);
  expect(r.headers.getSetCookie()).toEqual([]);
  expect(await count('lab_sessions')).toBe(before);
  expect(
    await lab.db
      .prepare('SELECT owner IS NOT NULL claimed,completed FROM lab_attempts WHERE id=?')
      .bind(a.state)
      .first(),
  ).toEqual({ claimed: 1, completed: 0 });
  await lab.callback(j, a.state, 'A');
  expect(lab.exchangeCounts.get(a.state)).toBe(1);
});
it('permits current final reads/writes, refuses wrong session CSRF and treats DB failure as unavailable', async () => {
  const j = await lab.bootstrap();
  await lab.login(j, 'A');
  const before = await lab.db
      .prepare("SELECT version FROM lab_records WHERE actor='A'")
      .first<{ version: number }>(),
    { body } = await lab.inspect(j);
  expect((await lab.call(j, '/lab/read')).status).toBe(200);
  expect(
    (await lab.call(j, '/lab/write', 'POST', true, { 'X-Lab-Session-CSRF': 'wrong' })).status,
  ).toBe(401);
  expect(
    (await lab.call(j, '/lab/write', 'POST', true, { 'X-Lab-Session-CSRF': body.csrf! })).status,
  ).toBe(200);
  expect(
    (await lab.db
      .prepare("SELECT version FROM lab_records WHERE actor='A'")
      .first<{ version: number }>())!.version,
  ).toBe(before!.version + 1);
  const failed = await lab.call(j, '/lab/private', 'GET', true, { 'X-Lab-Fault': 'lookup' });
  expect(failed.status).toBe(503);
  expect(failed.headers.getSetCookie()).toEqual([]);
  expect((await lab.inspect(j)).body.actor).toBe('A');
});
it('cannot finish another callback claim or recreate a session after ambiguous issue acknowledgement', async () => {
  const j = await lab.bootstrap(),
    a = await lab.start(j),
    before = await count('lab_sessions');
  const r = await lab.callback(j, a.state, 'A', true, { 'X-Lab-Fault': 'after-issue' });
  expect(r.status).toBe(503);
  expect(r.headers.getSetCookie()).toEqual([]);
  expect(await count('lab_sessions')).toBe(before + 1);
  expect((await lab.callback(j, a.state, 'B')).headers.getSetCookie()).toEqual([]);
  expect(lab.exchangeCounts.get(a.state)).toBe(1);
  expect(await count('lab_sessions')).toBe(before + 1);
  expect((await lab.inspect(j)).status).toBe(401);
});
it('refuses account epoch/status changes between verified identity snapshot and session insertion', async () => {
  for (const mode of ['epoch', 'status']) {
    const j = await lab.bootstrap(),
      a = await lab.start(j),
      p = lab.pause('account-' + mode),
      pending = lab.callback(j, a.state, 'A', false, { 'X-Lab-Pause-issue': 'account-' + mode });
    let r: Response;
    try {
      await p.ready;
      if (mode === 'epoch')
        await lab.db.prepare("UPDATE lab_accounts SET epoch=epoch+1 WHERE id='A'").run();
      else await lab.db.prepare("UPDATE lab_accounts SET status='suspended' WHERE id='A'").run();
    } finally {
      p.release();
      r = await pending;
      await lab.db.prepare("UPDATE lab_accounts SET status='active' WHERE id='A'").run();
    }
    expect(r!.headers.getSetCookie()).toEqual([]);
    expect((await lab.inspect(j)).status).toBe(401);
  }
});
it('account-wide epoch revocation invalidates existing same-account sessions on both devices', async () => {
  const a = await lab.bootstrap(),
    b = await lab.bootstrap();
  await lab.login(a, 'A');
  await lab.login(b, 'A');
  await lab.db.prepare("UPDATE lab_accounts SET epoch=epoch+1 WHERE id='A'").run();
  expect((await lab.inspect(a)).status).toBe(401);
  expect((await lab.inspect(b)).status).toBe(401);
  await lab.login(b, 'A');
  expect((await lab.inspect(b)).body.actor).toBe('A');
});
it('refuses expired proof/attempt, expired or deleted context and epoch overflow without resurrection', async () => {
  const j = await lab.bootstrap(),
    cmd = await lab.proof(j);
  j.now += 60001;
  expect((await lab.start(j, cmd)).response.status).toBe(409);
  expect(await epoch(j)).toBe(0);
  j.now = LAB_NOW;
  const a = await lab.start(j);
  j.now += 60001;
  expect((await lab.callback(j, a.state, 'A')).headers.getSetCookie()).toEqual([]);
  expect(lab.exchangeCounts.get(a.state)).toBeUndefined();
  j.now = LAB_NOW;
  const ctx = j.value('__Host-lab-context')!;
  await lab.db.prepare('UPDATE lab_contexts SET epoch=9007199254740991 WHERE id=?').bind(ctx).run();
  expect((await lab.start(j)).response.status).toBe(409);
  await lab.db.prepare('UPDATE lab_contexts SET expires=? WHERE id=?').bind(LAB_NOW, ctx).run();
  expect((await lab.call(j, '/lab/proof?action=start', 'POST')).status).toBe(409);
  expect((await lab.inspect(j)).status).toBe(401);
  const unused = new LabJar();
  await lab.bootstrap(unused);
  const deleted = unused.value('__Host-lab-context')!;
  await lab.db.prepare('DELETE FROM lab_contexts WHERE id=?').bind(deleted).run();
  expect((await lab.call(unused, '/lab/proof?action=start', 'POST')).status).toBe(409);
  expect(
    await lab.db.prepare('SELECT id FROM lab_contexts WHERE id=?').bind(deleted).first(),
  ).toBeNull();
});
it('never authenticates a copied context alone or a session combined with a different context', async () => {
  const a = await lab.bootstrap(),
    b = await lab.bootstrap();
  await lab.login(a, 'A');
  const contextOnly = new LabJar();
  contextOnly.values.set('__Host-lab-context', a.values.get('__Host-lab-context')!);
  expect((await lab.inspect(contextOnly)).status).toBe(401);
  b.values.set('__Host-lab-session', a.values.get('__Host-lab-session')!);
  expect((await lab.inspect(b)).status).toBe(401);
  const raw = a.value('__Host-lab-context')!;
  expect(
    (
      await lab.call(a, '/lab/private', 'GET', true, {
        Cookie: a.header() + '; __Host-lab-context=' + raw,
      })
    ).status,
  ).toBe(401);
});
