import app from '../../worker/index';
// Test-only stale setting and static files must never re-enable the retired product feature.
export default {
  async fetch(r: Request, env: Env) {
    if (!(await fetch('https://retired-readiness.invalid/')).ok)
      return new Response('', { status: 503 });
    return app.fetch(r, {
      ...env,
      AUTH_ORIGIN: 'https://127.0.0.1:8792',
      GOOGLE_CLIENT_ID: 'fixture.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'synthetic-only',
      OAUTH_COOKIE_KEY: 'FxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxc',
      OAUTH_DRAFT_TRIAL: JSON.stringify({
        accountId: 'retired-fixture',
        accountEpoch: 0,
        expiresAtMs: Date.now() + 600000,
      }),
    } as Env);
  },
};
