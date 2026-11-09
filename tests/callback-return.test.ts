import { expect, it } from 'vitest';
import { EncryptJWT } from 'jose';
import { readCallbackReturn, sealCallbackReturn } from '../worker/auth/callback-return';

const config = {
  origin: 'https://return.example.test',
  clientId: 'fixture.apps.googleusercontent.com',
  cookieKey: new Uint8Array(32).fill(71),
};
const now = 1800000000000;
const params = new URLSearchParams({
  state: 's'.repeat(43),
  code: 'synthetic-code',
  iss: 'https://accounts.google.com',
});
const pair = (cookie: string) => cookie.split(';')[0];

it('uses a distinct bounded encrypted Lax return cookie and expires it after sixty seconds', async () => {
  const cookie = (await sealCallbackReturn(params, config, now))!;
  expect(cookie).toMatch(/^__Host-kobe-oauth-return=/);
  expect(cookie.length).toBeLessThanOrEqual(3800);
  for (const flag of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=60'])
    expect(cookie).toContain(flag);
  expect(cookie).not.toContain('synthetic-code');
  expect((await readCallbackReturn(pair(cookie), config, now))?.toString()).toBe(params.toString());
  expect(await readCallbackReturn(pair(cookie), config, now + 60000)).toBeNull();
  expect(await readCallbackReturn(pair(cookie), config, now - 1000)).toBeNull();
  expect(await sealCallbackReturn(params, config, -1)).toBeNull();
  expect(await sealCallbackReturn(params, config, NaN)).toBeNull();
  expect(await sealCallbackReturn(params, config, Number.MAX_SAFE_INTEGER)).toBeNull();
});

it('fails closed on tampering, duplicate cookies, foreign origins/clients and oversized envelope values', async () => {
  const cookie = pair((await sealCallbackReturn(params, config, now))!);
  for (const header of [null, '', cookie + '; ' + cookie, cookie + 'x', 'x'.repeat(16385)])
    expect(await readCallbackReturn(header, config, now)).toBeNull();
  expect(
    await readCallbackReturn(cookie, { ...config, origin: 'https://other.test' }, now),
  ).toBeNull();
  expect(
    await readCallbackReturn(
      cookie,
      { ...config, clientId: 'other.apps.googleusercontent.com' },
      now,
    ),
  ).toBeNull();
  expect(
    await readCallbackReturn(cookie, { ...config, cookieKey: new Uint8Array(32) }, now),
  ).toBeNull();
  // JSON escaping may exceed a browser's cookie budget even while the code grammar is valid.
  expect(
    await sealCallbackReturn(
      new URLSearchParams({ state: 's'.repeat(43), code: '"'.repeat(2048) }),
      config,
      now,
    ),
  ).toBeNull();
});

it('requires exact return purpose, fixed lifetime and canonical protocol claims even with valid encryption', async () => {
  const issued = now / 1000;
  const base = {
    parameters: params.toString(),
    iss: 'kobe-student-hub:oauth-callback-return',
    aud: config.clientId + '|' + config.origin + '/api/auth/callback/complete',
    iat: issued,
    exp: issued + 60,
  };
  for (const patch of [
    { iss: 'kobe-student-hub:oauth-attempt' },
    { aud: config.clientId + '|' + config.origin + '/api/auth/callback' },
    { aud: [base.aud, 'other-audience'] },
    { exp: issued + 61 },
    { iat: issued + 1, exp: issued + 61 },
    { iat: issued - 61, exp: issued - 1 },
    { extra: 'unsupported' },
    { parameters: params.toString() + '&scope=ignored' },
    { parameters: params.toString() + '&code=duplicate' },
  ]) {
    const sealed = await new EncryptJWT({ ...base, ...patch })
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', typ: 'oauth-callback-return+jwt' })
      .encrypt(config.cookieKey);
    expect(await readCallbackReturn('__Host-kobe-oauth-return=' + sealed, config, now)).toBeNull();
  }
  const wrongType = await new EncryptJWT(base)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', typ: 'JWT' })
    .encrypt(config.cookieKey);
  expect(await readCallbackReturn('__Host-kobe-oauth-return=' + wrongType, config, now)).toBeNull();
});
