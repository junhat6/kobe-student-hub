import { it, expect } from 'vitest';
import { SessionOrderModel, ModelJar, type Headers } from './fixtures/session-order-model';

function interleave(a: string[], b: string[]): string[][] {
  if (!a.length) return [b];
  if (!b.length) return [a];
  return [
    ...interleave(a.slice(1), b).map((xs) => [a[0], ...xs]),
    ...interleave(a, b.slice(1)).map((xs) => [b[0], ...xs]),
  ];
}

it('independent review: captured callback contexts preserve latest committed start across 252 schedules', () => {
  const schedules = interleave(
    ['bootA', 'startA', 'claimA', 'issueA', 'applyA'],
    ['bootB', 'startB', 'claimB', 'issueB', 'applyB'],
  );
  expect(schedules).toHaveLength(252);
  for (const schedule of schedules) {
    const m = new SessionOrderModel(),
      j = new ModelJar(),
      boots = { A: m.bootstrap(), B: m.bootstrap() };
    const calls: Record<
      string,
      { context: string; attempt: string; claimed: boolean; headers: Headers }
    > = {};
    let latestStart: string | undefined;
    for (const event of schedule) {
      const actor = event.at(-1)!;
      if (event.startsWith('boot')) j.apply(boots[actor as 'A' | 'B']);
      if (event.startsWith('start')) {
        const context = j.context!,
          attempt = m.start(context, m.proof(context)!);
        expect(attempt).not.toBeNull();
        calls[actor] = { context, attempt: attempt!, claimed: false, headers: {} };
        latestStart = actor;
      }
      // Preserve the callback's captured Cookie context while other headers arrive.
      if (event.startsWith('claim')) {
        const c = calls[actor];
        c.claimed = m.claim(c.attempt, c.context);
      }
      if (event.startsWith('issue')) {
        const c = calls[actor];
        c.headers = c.claimed ? m.issue(c.attempt, c.context, actor) : {};
      }
      if (event.startsWith('apply')) j.apply(calls[actor].headers);
      const result = m.inspect(j);
      if (result.kind === 'authenticated')
        expect(result.actor, schedule.join(',')).toBe(latestStart);
    }
  }
});

it('independent review: expired context rejects an already claimed completion and final write', () => {
  const m = new SessionOrderModel(),
    j = new ModelJar();
  j.apply(m.bootstrap());
  const context = j.context!,
    attempt = m.start(context, m.proof(context)!)!;
  expect(m.claim(attempt, context)).toBe(true);
  m.contexts.get(context)!.expires = 1;
  m.now = 1;
  expect(m.issue(attempt, context, 'A')).toEqual({});
  expect(m.commit(j)).toBe(false);
  expect(m.logout(context, m.proof(context, 'logout') ?? undefined)).toBe(false);
});

it('independent review: epoch overflow refuses start/logout without reviving or mutating state', () => {
  const m = new SessionOrderModel(),
    j = new ModelJar();
  j.apply(m.bootstrap());
  const context = j.context!,
    c = m.contexts.get(context)!;
  c.epoch = Number.MAX_SAFE_INTEGER;
  expect(m.start(context, m.proof(context)!)).toBeNull();
  expect(m.logout(context, m.proof(context, 'logout')!)).toBe(false);
  expect(c.epoch).toBe(Number.MAX_SAFE_INTEGER);
  expect(m.attempts.size).toBe(0);
  expect(m.inspect(j)).toEqual({ kind: 'signed-out' });
});

it('independent review: records unresolved completed-logout replay causing sign-in loss', () => {
  const m = new SessionOrderModel(),
    j = new ModelJar();
  j.apply(m.bootstrap());
  const context = j.context!,
    proof = m.proof(context, 'logout')!;
  expect(m.logout(context, proof)).toBe(true);
  const attempt = m.start(context, m.proof(context)!)!;
  j.apply(m.complete(attempt, context, 'B'));
  expect(m.inspect(j)).toEqual({ kind: 'authenticated', actor: 'B' });
  // Current model has no command idempotency/one-use nonce. This is a limitation.
  expect(m.logout(context, proof)).toBe(true);
  expect(m.inspect(j)).toEqual({ kind: 'signed-out' });
});
