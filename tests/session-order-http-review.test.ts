import { beforeAll, afterAll, it, expect } from 'vitest';
import { createSessionLab, LabJar, LAB_NOW } from './helpers/session-order-http';
let lab: Awaited<ReturnType<typeof createSessionLab>>;
beforeAll(async () => {
  lab = await createSessionLab();
});
afterAll(async () => {
  await lab?.dispose();
});
const context = (j: LabJar) => j.value('__Host-lab-context')!;
const noCookie = (r: Response) => expect(r.headers.getSetCookie()).toEqual([]);

it('independent: final private SQL rechecks account status and epoch after a successful preflight', async () => {
  for (const action of ['read', 'write'])
    for (const change of ["status='suspended'", 'epoch=epoch+1']) {
      const j = await lab.bootstrap();
      await lab.login(j, 'A');
      const s = await lab.inspect(j),
        tag = action + change,
        p = lab.pause(tag);
      const before = await lab.db
        .prepare("SELECT version FROM lab_records WHERE actor='A'")
        .first();
      const pending = lab.call(j, '/lab/' + action, action === 'write' ? 'POST' : 'GET', true, {
        'X-Lab-Session-CSRF': s.body.csrf!,
        ['X-Lab-Pause-' + action]: tag,
      });
      let r: Response;
      try {
        await p.ready;
        await lab.db.prepare('UPDATE lab_accounts SET ' + change + " WHERE id='A'").run();
      } finally {
        p.release();
        r = await pending;
        await lab.db.prepare("UPDATE lab_accounts SET status='active',epoch=0 WHERE id='A'").run();
      }
      expect(r!.status).toBe(401);
      noCookie(r!);
      expect(await r!.text()).not.toContain('fictional-A');
      expect(
        await lab.db.prepare("SELECT version FROM lab_records WHERE actor='A'").first(),
      ).toEqual(before);
    }
});

it('independent: context expiry during issuance rejects even when the attempt and account remain valid', async () => {
  const j = await lab.bootstrap(),
    a = await lab.start(j),
    p = lab.pause('context-expiry');
  const pending = lab.callback(j, a.state, 'A', true, { 'X-Lab-Pause-issue': 'context-expiry' });
  let r: Response;
  try {
    await p.ready;
    await lab.db
      .prepare('UPDATE lab_contexts SET expires=? WHERE id=?')
      .bind(LAB_NOW, context(j))
      .run();
  } finally {
    p.release();
    r = await pending;
  }
  noCookie(r!);
  expect((await lab.inspect(j)).status).toBe(401);
  expect((await lab.call(j, '/lab/proof?action=logout', 'POST')).status).toBe(409);
});

it('independent: competing start and logout commands with the same expected epoch have exactly one winner', async () => {
  for (let round = 0; round < 8; round++) {
    const j = await lab.bootstrap(),
      start = await lab.proof(j),
      logout = await lab.proof(j, 'logout');
    const [a, b] = await Promise.all([
      lab.start(j, start, false),
      lab.call(j, '/lab/logout', 'POST', false, { 'X-Lab-Command': logout }),
    ]);
    expect([a.response.status, b.status].sort()).toEqual(
      a.response.status === 303 ? [303, 409] : [200, 409],
    );
    // Exactly one command can consume epoch zero; successful start is 303, logout is 200.
    expect(Number(a.response.status === 303) + Number(b.status === 200)).toBe(1);
    expect(
      await lab.db.prepare('SELECT epoch FROM lab_contexts WHERE id=?').bind(context(j)).first(),
    ).toEqual({ epoch: 1 });
    const rows = await lab.db
      .prepare('SELECT completed FROM lab_commands WHERE id IN (?,?)')
      .bind(start, logout)
      .all<{ completed: number }>();
    expect(rows.results.reduce((n, r) => n + r.completed, 0)).toBe(1);
  }
});

it('independent: logout batch rollback preserves both an existing session and a retryable command', async () => {
  const j = await lab.bootstrap();
  await lab.login(j, 'A');
  const command = await lab.proof(j, 'logout');
  const before = await lab.db
    .prepare('SELECT epoch FROM lab_contexts WHERE id=?')
    .bind(context(j))
    .first();
  const failed = await lab.call(j, '/lab/logout', 'POST', true, {
    'X-Lab-Command': command,
    'X-Lab-Fault': 'command',
  });
  expect(failed.status).toBe(503);
  noCookie(failed);
  expect((await lab.inspect(j)).body.actor).toBe('A');
  expect(
    await lab.db.prepare('SELECT epoch FROM lab_contexts WHERE id=?').bind(context(j)).first(),
  ).toEqual(before);
  expect(
    await lab.db.prepare('SELECT completed FROM lab_commands WHERE id=?').bind(command).first(),
  ).toEqual({ completed: 0 });
  const done = await lab.call(j, '/lab/logout', 'POST', true, { 'X-Lab-Command': command });
  expect(done.status).toBe(200);
  noCookie(done);
  expect((await lab.inspect(j)).status).toBe(401);
  await lab.login(j, 'B');
  const epoch = await lab.db
    .prepare('SELECT epoch FROM lab_contexts WHERE id=?')
    .bind(context(j))
    .first();
  const replay = await lab.call(j, '/lab/logout', 'POST', true, { 'X-Lab-Command': command });
  expect(replay.status).toBe(200);
  noCookie(replay);
  expect(
    await lab.db.prepare('SELECT epoch FROM lab_contexts WHERE id=?').bind(context(j)).first(),
  ).toEqual(epoch);
  expect((await lab.inspect(j)).body.actor).toBe('B');
});
