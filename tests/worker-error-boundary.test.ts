import { afterEach, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import worker from '../worker';
const marker = 'synthetic-untrusted-binding-value-never-return';
const fixed = { error: '読み込みに失敗しました。時間をおいて再度お試しください。' };
function environment(
  value: unknown,
  mode: 'throw' | 'reject',
): { env: Env; prepare: ReturnType<typeof vi.fn> } {
  const fail = (): never => {
    throw value;
  };
  const statement: D1PreparedStatement = {
    bind() {
      return statement;
    },
    first: async () => fail(),
    run: async () => fail(),
    all: async () => fail(),
    raw: async () => fail(),
  };
  const prepare = vi.fn(() => {
    if (mode === 'throw') return fail();
    return statement;
  });
  const DB: D1Database = {
    prepare,
    batch: async () => fail(),
    exec: async () => fail(),
    withSession: () => fail(),
    dump: async () => fail(),
  };
  return {
    env: {
      DB,
      get ASSETS(): Fetcher {
        throw new Error('Unexpected fixture asset access');
      },
    },
    prepare,
  };
}
function captureLogs() {
  return ['error', 'warn', 'log', 'info', 'debug', 'trace'].map((name) =>
    vi.spyOn(console, name as 'error').mockImplementation(() => {}),
  );
}
afterEach(() => vi.restoreAllMocks());
const cases = [
  { name: 'string', value: () => marker },
  { name: 'object', value: () => ({ message: marker, stack: marker, token: marker }) },
  { name: 'null', value: () => null },
  { name: 'undefined', value: () => undefined },
  {
    name: 'cross-realm Error',
    value: () => runInNewContext('new Error(' + JSON.stringify(marker) + ')') as unknown,
  },
];
const securityHeaders = [
  'content-security-policy',
  'cross-origin-resource-policy',
  'cross-origin-opener-policy',
  'origin-agent-cluster',
  'referrer-policy',
  'strict-transport-security',
  'x-content-type-options',
  'x-dns-prefetch-control',
  'x-download-options',
  'x-frame-options',
  'x-permitted-cross-domain-policies',
  'x-xss-protection',
  'x-robots-tag',
];
describe('actual exported Worker fetch error boundary', () => {
  for (const mode of ['throw', 'reject'] as const)
    for (const entry of cases)
      it(`contains a ${mode} with ${entry.name} from the storage binding`, async () => {
        const logs = captureLogs();
        const value = entry.value();
        if (entry.name === 'cross-realm Error') expect(value instanceof Error).toBe(false);
        const { env, prepare } = environment(value, mode);
        const response = await worker.fetch(
          new Request('https://test/api/catalog?private=' + marker, {
            headers: { Authorization: 'Bearer ' + marker, Cookie: 'synthetic=' + marker },
          }),
          env,
        );
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual(fixed);
        expect(prepare).toHaveBeenCalledTimes(1);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(response.headers.get('vary')).toBe('Cookie');
        expect(response.headers.get('content-type')).toBe('application/json; charset=UTF-8');
        expect(response.headers.get('referrer-policy')).toBe('no-referrer');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
        expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
        expect(response.headers.has('set-cookie')).toBe(false);
        expect(response.headers.has('location')).toBe(false);
        expect(JSON.stringify([...response.headers])).not.toContain(marker);
        for (const log of logs) expect(log).not.toHaveBeenCalled();
      });
  it('never coerces, serializes or reads an adversarial caught object', async () => {
    const logs = captureLogs();
    let inspected = 0;
    const fail = () => {
      inspected++;
      throw new Error(marker);
    };
    const hostile = {
      get message() {
        return fail();
      },
      get stack() {
        return fail();
      },
      get cause() {
        return fail();
      },
      get toJSON() {
        return fail();
      },
      toString: fail,
      [Symbol.toPrimitive]: fail,
    };
    const { env } = environment(hostile, 'reject');
    const response = await worker.fetch(new Request('https://test/api/catalog'), env);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(fixed);
    expect(inspected).toBe(0);
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
  it('preserves Hono Error handling and matches its security policy on the outer fallback', async () => {
    const logs = captureLogs();
    const handled = await worker.fetch(
      new Request('https://test/api/catalog'),
      environment(new Error(marker), 'reject').env,
    );
    const outer = await worker.fetch(
      new Request('https://test/api/catalog'),
      environment(marker, 'reject').env,
    );
    expect(handled.status).toBe(503);
    expect(await handled.json()).toEqual(fixed);
    expect(handled.headers.get('cache-control')).toBe('no-store');
    for (const name of securityHeaders)
      expect(outer.headers.get(name), name).toBe(handled.headers.get(name));
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
  it('isolates concurrent failures and does not reuse mutable fallback response headers', async () => {
    const logs = captureLogs();
    const a = environment({ message: marker + '-a' }, 'reject'),
      b = environment(marker + '-b', 'throw');
    const responses = await Promise.all([
      worker.fetch(new Request('https://test/api/catalog'), a.env),
      worker.fetch(new Request('https://test/api/catalog'), b.env),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual(fixed);
    }
    responses[0].headers.set('X-Untrusted-Response', marker);
    expect(responses[1].headers.has('X-Untrusted-Response')).toBe(false);
    const next = await worker.fetch(new Request('https://test/api/catalog'), a.env);
    expect(next.headers.has('X-Untrusted-Response')).toBe(false);
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
  it('fails account routes closed without config and preserves closed authoring, health and retired paths without storage', async () => {
    const logs = captureLogs();
    const { env, prepare } = environment(marker, 'throw');
    const health = await worker.fetch(new Request('https://test/api/health'), env);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({
      status: 'ok',
      stage: 'development-preview',
      writesEnabled: false,
    });
    for (const [path, method, status] of [
      ['/api/auth/start', 'POST', 503],
      ['/api/auth/callback', 'GET', 303],
      ['/api/auth/register', 'POST', 503],
      ['/api/private/enrollment', 'PUT', 503],
      ['/api/private/drafts', 'POST', 405],
      ['/api/private/session', 'GET', 503],
      ['/api/auth/pilot', 'GET', 404],
      ['/api/auth/draft-trial/start', 'POST', 404],
      ['/trial-assets/retired.js', 'GET', 404],
    ] as const) {
      const r = await worker.fetch(new Request('https://test' + path, { method }), env);
      expect(r.status, path).toBe(status);
      expect(r.headers.has('set-cookie')).toBe(false);
      expect(r.headers.get('location')).toBe(
        path === '/api/auth/callback' ? '/account#authentication-failed' : null,
      );
      expect(await r.text()).not.toContain(marker);
    }
    expect(prepare).not.toHaveBeenCalled();
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
});
