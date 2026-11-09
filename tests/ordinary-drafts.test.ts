import { describe, it, expect } from 'vitest';
import { createOrdinaryDraftHandler } from '../worker/ordinary-drafts-http';
import app from '../worker/index';

const origin = 'https://app.example.invalid';
const forbiddenDb = new Proxy({} as D1Database, {
  get() {
    throw Error('Closed authoring touched storage');
  },
});

describe('ordinary draft release boundary', () => {
  it('leaves every request unmatched without explicit source enablement and never touches storage', async () => {
    for (const options of [undefined, {}, { enabled: false }]) {
      const handler = createOrdinaryDraftHandler(forbiddenDb, origin, options);
      for (const method of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']) {
        expect(await handler(new Request(origin + '/api/private/drafts', { method }))).toBeNull();
      }
    }
  });
  it('requires a real session and CSRF for enabled authoring despite complete-looking inputs or enable-like headers', async () => {
    const env = {
      DB: forbiddenDb,
      AUTH_ORIGIN: origin,
      GOOGLE_CLIENT_ID: 'fictional.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'synthetic-only',
      OAUTH_COOKIE_KEY: 'FxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxc',
      ORDINARY_DRAFT_HTTP_RELEASE_ENABLED: 'true',
      OAUTH_HTTP_RELEASE_ENABLED: 'true',
    } as unknown as Env;
    for (const suffix of ['', '/' + crypto.randomUUID()])
      for (const method of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']) {
        const r = await app.fetch(
          new Request(origin + '/api/private/drafts' + suffix, {
            method,
            headers: { Origin: origin, 'X-Authoring-Enabled': 'true' },
          }),
          env,
        );
        const allowed = suffix ? ['GET', 'PATCH', 'PUT', 'DELETE'] : ['GET', 'POST'];
        expect(r.status).toBe(allowed.includes(method) ? 401 : 405);
        expect(r.headers.get('Cache-Control')).toBe('private, no-store');
        expect(r.headers.has('Set-Cookie')).toBe(false);
        expect(r.headers.has('Location')).toBe(false);
        expect(await r.text()).not.toContain('synthetic-only');
      }
    const health = await app.fetch(new Request(origin + '/api/health'), env);
    expect(await health.json()).toMatchObject({ writesEnabled: true });
  });
  it('does not give unrelated or malformed routes an authoring action', async () => {
    const handler = createOrdinaryDraftHandler(forbiddenDb, origin, { enabled: true });
    expect(await handler(new Request(origin + '/api/catalog'))).toBeNull();
    for (const path of [
      '/api/private/drafts/',
      '/api/private/drafts-extra',
      '/api/private/drafts?private=synthetic',
    ]) {
      const r = await handler(new Request(origin + path));
      expect(r?.status).toBe(404);
      expect(r?.headers.get('Cache-Control')).toBe('private, no-store');
    }
  });
});
