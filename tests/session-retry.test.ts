import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SESSION_IDLE_MS } from '../worker/auth/sessions';

const T = 1800000000000;
let mf: Miniflare;
const gates = new Map<string, ReturnType<typeof gate>>();
function gate() {
  let entered!: () => void, release!: () => void;
  return {
    ready: new Promise<void>((resolve) => {
      entered = resolve;
    }),
    done: new Promise<void>((resolve) => {
      release = resolve;
    }),
    entered: () => entered(),
    release: () => release(),
  };
}
function latch(tag: string) {
  const value = gate();
  gates.set(tag, value);
  return value;
}
const db = () => mf.getD1Database('DB');
const request = (times: number | number[], cookie = '', holds?: string[], action?: string) =>
  mf.dispatchFetch('https://fixture.invalid', {
    method: 'POST',
    body: JSON.stringify({ times: Array.isArray(times) ? times : [times], cookie, holds, action }),
  });
async function session() {
  const created = (await (await request(T, '', undefined, 'create')).json()) as {
    setCookie: string;
    contextCookie: string;
  };
  expect(created).toBeTruthy();
  const raw = created.setCookie.split(';')[0].split('=')[1];
  return {
    cookie: [created.setCookie, created.contextCookie]
      .map((value) => value.split(';')[0])
      .join('; '),
    hash: createHash('sha256')
      .update('session-v1:' + raw)
      .digest('hex'),
  };
}
async function lastSeen(hash: string) {
  return (await (
    await db()
  )
    .prepare('SELECT last_seen_ms FROM auth_sessions WHERE token_hash=?')
    .bind(hash)
    .first<{ last_seen_ms: number }>())!.last_seen_ms;
}
beforeAll(async () => {
  await build({
    entryPoints: ['tests/fixtures/session-retry-worker.ts'],
    outfile: '.worker/session-retry-test.js',
    bundle: true,
    format: 'esm',
    platform: 'browser',
    loader: { '.sql': 'text' },
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: '.worker/session-retry-test.js',
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
      outboundService: async (request) => {
        const url = new URL(request.url);
        expect(url.origin).toBe('https://session-retry-control.invalid');
        const current = gates.get(url.searchParams.get('tag')!);
        expect(current).toBeDefined();
        current!.entered();
        await current!.done;
        return new Response('released');
      },
    }),
  );
  for (const name of ['0003_oauth_attempts.sql', '0004_private_sessions.sql'])
    for (const sql of readFileSync('migrations/' + name, 'utf8')
      .replace(/^--.*$/gm, '')
      .split(/;\s*(?:\n|$)/)
      .filter((value) => value.trim()))
      await (await db()).prepare(sql).run();
  await (
    await db()
  )
    .prepare('INSERT INTO private_accounts VALUES(?,?,?,?,?,?)')
    .bind(
      'session-retry-account',
      'session-retry-fixture',
      'session-retry-fixture@st.kobedenshi.ac.jp',
      'active',
      0,
      T,
    )
    .run();
});
beforeEach(async () => {
  await (
    await db()
  )
    .prepare(
      "UPDATE private_accounts SET status='active',session_epoch=0 WHERE id='session-retry-account'",
    )
    .run();
});
afterAll(async () => {
  for (const current of gates.values()) current.release();
  await mf?.dispose();
});

it('retries a reordered lookup once with a fresh clock and the full atomic predicate', async () => {
  const current = await session(),
    hold = latch('one-retry');
  const older = request([T + 10, T + 21], current.cookie, ['one-retry']);
  await hold.ready;
  expect((await request(T + 20, current.cookie)).status).toBe(200);
  hold.release();
  const result = await older;
  expect(result.status).toBe(200);
  expect(Object.keys((await result.json()) as object)).toEqual(['csrfToken']);
  expect(result.headers.get('X-Fixture-Lookups')).toBe('2');
  expect(result.headers.get('X-Fixture-Ahead-Reads')).toBe('0');
  expect(await lastSeen(current.hash)).toBe(T + 21);
});

it('bounds repeated reordering to one retry and reports unavailable without a third touch or actor', async () => {
  const current = await session(),
    first = latch('twice-first'),
    second = latch('twice-second');
  const older = request([T + 10, T + 30], current.cookie, ['twice-first', 'twice-second']);
  await first.ready;
  expect((await request(T + 20, current.cookie)).status).toBe(200);
  first.release();
  await second.ready;
  expect((await request(T + 40, current.cookie)).status).toBe(200);
  second.release();
  const result = await older;
  expect(result.status).toBe(503);
  expect(await result.json()).toEqual({ error: 'session_unavailable' });
  expect(result.headers.get('X-Fixture-Lookups')).toBe('2');
  expect(result.headers.get('X-Fixture-Ahead-Reads')).toBe('1');
  expect(result.headers.getSetCookie()).toEqual([]);
  expect(await lastSeen(current.hash)).toBe(T + 40);
});

it('keeps genuine rollback unavailable with no actor, cookie write or activity regression', async () => {
  const current = await session();
  expect((await request(T + 100, current.cookie)).status).toBe(200);
  const rollback = await request(T + 90, current.cookie);
  expect(rollback.status).toBe(503);
  expect(await rollback.json()).toEqual({ error: 'session_unavailable' });
  expect(rollback.headers.getSetCookie()).toEqual([]);
  expect(
    await (await request(T + 90, current.cookie, undefined, 'authenticate')).json(),
  ).toBeNull();
  expect((await request([T + 95, T + 94], current.cookie)).status).toBe(503);
  expect(await lastSeen(current.hash)).toBe(T + 100);
});

for (const changed of [
  'revoked',
  'epoch',
  'status',
  'context-generation',
  'context-expiry',
  'absolute-expiry',
] as const)
  it(`rechecks ${changed} on retry and timing classification instead of returning an actor`, async () => {
    const current = await session(),
      hold = latch('changed-' + changed);
    const older = request([T + 10, T + (changed === 'absolute-expiry' ? 30 : 15)], current.cookie, [
      'changed-' + changed,
    ]);
    await hold.ready;
    expect((await request(T + 20, current.cookie)).status).toBe(200);
    const database = await db();
    if (changed === 'revoked')
      await database
        .prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
        .bind(T + 20, current.hash)
        .run();
    else if (changed === 'epoch')
      await database
        .prepare(
          "UPDATE private_accounts SET session_epoch=session_epoch+1 WHERE id='session-retry-account'",
        )
        .run();
    else if (changed === 'status')
      await database
        .prepare("UPDATE private_accounts SET status='suspended' WHERE id='session-retry-account'")
        .run();
    else if (changed === 'absolute-expiry')
      await database
        .prepare('UPDATE auth_sessions SET expires_at_ms=? WHERE token_hash=?')
        .bind(T + 25, current.hash)
        .run();
    else
      await database
        .prepare(
          changed === 'context-generation'
            ? 'UPDATE auth_browser_contexts SET generation=generation+1 WHERE context_hash=(SELECT context_hash FROM auth_sessions WHERE token_hash=?)'
            : 'UPDATE auth_browser_contexts SET expires_at_ms=created_at_ms+1 WHERE context_hash=(SELECT context_hash FROM auth_sessions WHERE token_hash=?)',
        )
        .bind(current.hash)
        .run();
    hold.release();
    const result = await older;
    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ error: 'authentication_required' });
    expect(result.headers.get('X-Fixture-Lookups')).toBe('2');
    expect(result.headers.get('X-Fixture-Ahead-Reads')).toBe('1');
    expect(await lastSeen(current.hash)).toBe(T + 20);
  });

it('does not renew an idle-expired session during the fresh-clock retry', async () => {
  const current = await session(),
    hold = latch('idle-expiry');
  const older = request([T + 10, T + SESSION_IDLE_MS + 21], current.cookie, ['idle-expiry']);
  await hold.ready;
  expect((await request(T + 20, current.cookie)).status).toBe(200);
  hold.release();
  const result = await older;
  expect(result.status).toBe(401);
  expect(await lastSeen(current.hash)).toBe(T + 20);
});
