import { it, expect } from 'vitest';
import app from '../worker/index';
const origin = 'https://fixture.example.test';
const bindings = {
  AUTH_ORIGIN: origin,
  GOOGLE_CLIENT_ID: 'fixture.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'fictional',
  OAUTH_COOKIE_KEY: 'FxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxc',
};
const stale = JSON.stringify({
  accountId: 'retired-fixture',
  accountEpoch: 0,
  expiresAtMs: Date.now() + 600000,
});
function environment(setting: unknown) {
  return {
    ...bindings,
    OAUTH_DRAFT_TRIAL: setting,
    DB: {
      prepare() {
        throw Error('unexpected database access');
      },
    },
    ASSETS: {
      fetch() {
        throw Error('unexpected asset access');
      },
    },
  } as unknown as Env;
}
it('retired trial entry and stale assets are denied even with a formerly valid runtime setting', async () => {
  for (const setting of [undefined, '{}', 'invalid', stale])
    for (const path of [
      '/api/auth/draft-trial',
      '/api/auth/draft-trial/',
      '/api/auth/draft-trial?private=1',
      '/trial-assets',
      '/trial-assets/',
      '/trial-assets/index.html',
      '/trial-assets/assets/trial.js?private=1',
    ])
      for (const method of ['GET', 'HEAD', 'POST']) {
        const r = await app.fetch(new Request(origin + path, { method }), environment(setting));
        expect(r.status).toBe(404);
        expect(r.headers.get('Cache-Control')).toBe('private, no-store');
        expect(r.headers.get('Set-Cookie')).toBeNull();
        expect(r.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
        expect(await r.text()).not.toContain('private');
      }
});
it('stale trial configuration and old cookies cannot enable authentication or private writes', async () => {
  for (const path of [
    '/api/private/session',
    '/api/private/drafts',
    '/api/private/drafts/11111111-1111-4111-8111-111111111111',
    '/api/private/logout',
    '/api/private/logout-command',
    '/api/auth/bootstrap',
    '/api/auth/command?action=login',
    '/api/auth/start',
  ])
    for (const method of ['GET', 'POST', 'DELETE']) {
      const r = await app.fetch(
        new Request(origin + path, {
          method,
          headers: {
            Cookie:
              '__Host-kobe-session=' + 'A'.repeat(43) + '; __Host-kobe-browser=' + 'B'.repeat(43),
            Origin: origin,
          },
        }),
        environment(stale),
      );
      expect(r.status).toBe(405);
      expect(r.headers.get('Set-Cookie')).toBeNull();
      expect(r.headers.get('Cache-Control')).toBe('no-store');
    }
});
it('late callbacks discard query credentials without database, provider or Cookie operations', async () => {
  const r = await app.fetch(
    new Request(origin + '/api/auth/callback?code=private-code&state=private-state'),
    environment(stale),
  );
  expect(r.status).toBe(303);
  expect(r.headers.get('Location')).toBe(origin + '/api/auth/pilot#unavailable');
  expect(r.headers.get('Set-Cookie')).toBeNull();
  expect(await r.text()).toBe('');
  expect(r.headers.get('Cache-Control')).toBe('private, no-store');
});
it('public health keeps the write gate closed and never exposes a retired policy', async () => {
  const r = await app.fetch(new Request(origin + '/api/health'), environment(stale));
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({
    status: 'ok',
    stage: 'development-preview',
    writesEnabled: false,
  });
});
