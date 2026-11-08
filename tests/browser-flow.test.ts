import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import { jwtDecrypt, EncryptJWT } from 'jose';
import { pkceChallenge, isSameOriginPost } from '../worker/auth/browser-flow';
const ORIGIN = 'https://app.example.invalid';
const NOW = 1_800_000_000_000;
const CLIENT = 'fixture.apps.googleusercontent.com';
const key = crypto.getRandomValues(new Uint8Array(32));
let mf: Miniflare;
type Start = { location: string; setCookie: string; contextCookie: string };
type Claim = {
  kind: string;
  code?: string;
  verifier?: string;
  nonce?: string;
  clearCookie: string;
};
async function call<T>(input: Record<string, unknown>): Promise<T> {
  const r = await mf.dispatchFetch('https://fixture.test', {
    method: 'POST',
    body: JSON.stringify({ now: NOW, key: Array.from(key), ...input }),
  });
  return (await r.json()) as T;
}
const start = (extra = {}) =>
  call<Start | null>({
    action: 'start',
    url: ORIGIN + '/api/auth/start',
    method: 'POST',
    headers: { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' },
    ...extra,
  });
const cookie = (a: Start) => [a.setCookie, a.contextCookie].map((v) => v.split(';')[0]).join('; ');
const state = (a: Start) => new URL(a.location).searchParams.get('state')!;
const callback = (a: Start, query = 'code=synthetic-code') =>
  ORIGIN + '/api/auth/callback?state=' + state(a) + '&' + query;
const claim = (a: Start, extra = {}) =>
  call<Claim | null>({
    action: 'claim',
    url: callback(a),
    headers: { Cookie: cookie(a) },
    ...extra,
  });
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: '.worker/browser-flow-test.js',
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
    }),
  );
  const db = await mf.getD1Database('DB');
  for (const s of readFileSync('migrations/0003_oauth_attempts.sql', 'utf8')
    .replace(/^--.*$/gm, '')
    .split(/;\s*(?:\n|$)/)
    .filter((x) => x.trim()))
    await db.prepare(s).run();
});
afterAll(async () => {
  await mf?.dispose();
});
describe('PKCE and server-only browser-bound attempt flow', () => {
  it('uses the RFC7636 S256 vector and rejects non-verifiers', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
    for (const v of ['short', 'x'.repeat(129), 'x'.repeat(42) + ' '])
      expect(await pkceChallenge(v)).toBeNull();
  });
  it('creates a fresh encrypted Host cookie and a minimal fixed-provider authorization request', async () => {
    const a = (await start())!;
    const b = (await start())!;
    const url = new URL(a.location);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe('openid email');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(ORIGIN + '/api/auth/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(state(a)).not.toBe(state(b));
    expect(a.setCookie).toMatch(/^__Host-kobe-oauth=/);
    for (const attr of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=600'])
      expect(a.setCookie).toContain(attr);
    expect(a.setCookie).not.toContain('Domain=');
    const sealed = a.setCookie.split(';')[0].split('=')[1];
    const { payload } = await jwtDecrypt(sealed, key, { currentDate: new Date(NOW) });
    expect(payload.state).toBe(state(a));
    expect(url.searchParams.get('code_challenge')).toBe(
      await pkceChallenge(payload.verifier as string),
    );
    expect(a.location).not.toContain(payload.verifier);
    expect(sealed).not.toContain(payload.browserBinding);
    const db = await mf.getD1Database('DB');
    const row = await db
      .prepare('SELECT * FROM oauth_attempts WHERE nonce=?')
      .bind(url.searchParams.get('nonce'))
      .first();
    expect(JSON.stringify(row)).not.toContain(payload.verifier);
    expect(JSON.stringify(row)).not.toContain(payload.browserBinding);
  });
  it('fails closed before a DB write when trusted configuration is missing or invalid', async () => {
    const db = await mf.getD1Database('DB');
    const count = async () =>
      Number(
        (await db.prepare('SELECT COUNT(*) AS n FROM oauth_attempts').first<{ n: number }>())!.n,
      );
    const before = await count();
    for (const config of [
      { key: [] },
      { key: Array(31).fill(1) },
      { origin: 'http://app.example.invalid' },
      { origin: ORIGIN + '/' },
      { origin: ORIGIN + '/path' },
      { clientId: 'attacker.invalid' },
    ])
      expect(await start(config)).toBeNull();
    expect(await count()).toBe(before);
  });
  it('requires same-origin POST for start and does not turn Origin into authentication', async () => {
    for (const extra of [
      { method: 'GET' },
      { headers: {} },
      { headers: { Origin: 'https://other.invalid' } },
      { headers: { Origin: 'null' } },
      { headers: { Origin: ORIGIN, 'Sec-Fetch-Site': 'cross-site' } },
      { url: 'https://other.invalid/api/auth/start' },
      { url: ORIGIN + '/api/auth/other' },
    ])
      expect(await start(extra)).toBeNull();
    expect(
      isSameOriginPost(
        new Request(ORIGIN + '/action', { method: 'POST', headers: { Origin: ORIGIN } }),
        ORIGIN,
      ),
    ).toBe(true);
  });
  it('claims the private code/verifier/nonce once, and provides a clearing Host cookie', async () => {
    const a = (await start())!;
    const result = (await claim(a))!;
    expect(result.kind).toBe('code');
    expect(result.code).toBe('synthetic-code');
    expect(result.nonce).toBe(new URL(a.location).searchParams.get('nonce'));
    expect(await pkceChallenge(result.verifier!)).toBe(
      new URL(a.location).searchParams.get('code_challenge'),
    );
    expect(result.clearCookie).toContain('Max-Age=0');
    expect(result.clearCookie).toContain('HttpOnly; Secure; SameSite=Lax');
    expect(await claim(a)).toBeNull();
  });
  it('allows exactly one of twenty concurrent callback claims', async () => {
    const a = (await start())!;
    const results = await Promise.all(Array.from({ length: 20 }, () => claim(a)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it('rejects another browser/cookie, duplicate cookies and missing cookie without burning the attempt', async () => {
    const a = (await start())!;
    const b = (await start())!;
    for (const header of [
      '',
      cookie(b),
      cookie(a) + '; ' + cookie(a),
      '__Host-kobe-oauth=' + 'x'.repeat(5000),
    ])
      expect(await claim(a, { headers: { Cookie: header } })).toBeNull();
    expect((await claim(a))?.kind).toBe('code');
  });
  it('rejects malformed/tampered tokens and incorrect cookie context', async () => {
    const a = (await start())!;
    const token = cookie(a).split('=')[1];
    const parts = token.split('.');
    parts[3] = (parts[3][0] === 'a' ? 'b' : 'a') + parts[3].slice(1);
    expect(
      await claim(a, { headers: { Cookie: '__Host-kobe-oauth=' + parts.join('.') } }),
    ).toBeNull();
    expect(
      await claim(a, { key: Array.from(crypto.getRandomValues(new Uint8Array(32))) }),
    ).toBeNull();
    expect(await claim(a, { clientId: 'other.apps.googleusercontent.com' })).toBeNull();
    expect((await claim(a))?.kind).toBe('code');
  });
  it('rejects future/expired cookie times and wrong signed payload fields', async () => {
    const a = (await start())!;
    expect(await claim(a, { now: NOW - 1000 })).toBeNull();
    expect(await claim(a, { now: NOW + 600000 })).toBeNull();
    const { payload } = await jwtDecrypt(a.setCookie.split(';')[0].split('=')[1], key, {
      currentDate: new Date(NOW),
    });
    const forged = await new EncryptJWT({ ...payload, verifier: 'short' })
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', typ: 'JWT' })
      .encrypt(key);
    expect(await claim(a, { headers: { Cookie: '__Host-kobe-oauth=' + forged } })).toBeNull();
    expect((await claim(a))?.kind).toBe('code');
  });
  it('rejects duplicate, ambiguous, malformed and oversized callback parameters', async () => {
    const a = (await start())!;
    for (const query of [
      'code=x&code=y',
      'code=x&error=access_denied',
      'error=x&error=y',
      'code=',
      'code=x&state=' + state(a),
      'code=%00bad',
      'code=' + 'x'.repeat(2049),
      'other=' + 'x'.repeat(8200),
    ])
      expect(await claim(a, { url: callback(a, query) })).toBeNull();
    expect(await claim(a, { method: 'POST' })).toBeNull();
    expect(await claim(a, { url: callback(a).replace('/callback', '/other') })).toBeNull();
    expect((await claim(a))?.kind).toBe('code');
  });
  it('burns a bound provider denial once without reflecting provider details', async () => {
    const a = (await start())!;
    const result = await claim(a, {
      url: callback(a, 'error=access_denied&error_description=DO_NOT_REFLECT'),
    });
    expect(result).toEqual({ kind: 'denied', clearCookie: expect.stringContaining('Max-Age=0') });
    expect(JSON.stringify(result)).not.toContain('DO_NOT_REFLECT');
    expect(await claim(a)).toBeNull();
  });
  it('rejects expiry or clock rollback while encrypting/decrypting instead of using the old instant', async () => {
    expect(await start({ times: [NOW, NOW + 600000] })).toBeNull();
    expect(await start({ times: [NOW, NOW - 1] })).toBeNull();
    const a = (await start())!;
    for (const times of [
      [NOW, NOW + 600000],
      [NOW, NOW - 1],
    ])
      expect(await claim(a, { times })).toBeNull();
    const db = await mf.getD1Database('DB');
    expect(
      (
        await db
          .prepare('SELECT consumed_at_ms FROM oauth_attempts WHERE nonce=?')
          .bind(new URL(a.location).searchParams.get('nonce'))
          .first<{ consumed_at_ms: number | null }>()
      )?.consumed_at_ms,
    ).toBeNull();
    expect((await claim(a))?.kind).toBe('code');
    const fractional = (await start({ now: NOW + 999 }))!;
    expect(
      await claim(fractional, { now: NOW + 599999, times: [NOW + 599999, NOW + 600000] }),
    ).toBeNull();
  });
  it('fails closed for bad trusted clocks', async () => {
    for (const now of [-1, 1.2, Number.MAX_SAFE_INTEGER]) expect(await start({ now })).toBeNull();
  });
});
