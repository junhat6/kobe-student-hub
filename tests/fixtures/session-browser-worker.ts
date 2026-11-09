import productionApp from '../../worker/index';
import type { ServiceInfoBindings } from '../../worker/service-info';
import { createEnrollmentHandler } from '../../worker/enrollment-http';
import { createOrdinaryDraftHandler } from '../../worker/ordinary-drafts-http';
import { createPrivateProfileHandler } from '../../worker/profile-http';
import { createPrivateProjectHandler } from '../../worker/projects-http';
import { createPrivateOwnPublicationsHandler } from '../../worker/own-publications-http';
import { createOAuthHttpHandler } from '../../worker/auth/oauth-http';
import { SessionStore } from '../../worker/auth/sessions';
const origin = 'https://127.0.0.1:8790';
export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const u = new URL(request.url);
    if (u.pathname.startsWith('/__control/'))
      return fetch('https://fixture-control.invalid' + u.pathname + u.search, {
        method: request.method,
      });
    const result = await createOAuthHttpHandler(
      env.DB,
      {
        AUTH_ORIGIN: origin,
        GOOGLE_CLIENT_ID: 'fixture-web-client.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'synthetic-browser-only',
        OAUTH_COOKIE_KEY: 'FxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxc',
      },
      { enabled: true, authorizationJson: true, accountLanding: true },
    )(request);
    if (result) {
      const hold =
        (u.pathname === '/api/auth/callback' && request.method === 'POST') ||
        (u.pathname === '/api/auth/callback/complete' && request.method === 'GET')
          ? request.headers.get('X-Test-Callback-Hold')
          : null;
      if (hold && result.headers.has('Set-Cookie'))
        await fetch('https://fixture-control.invalid/pause?tag=' + encodeURIComponent(hold));
      return result;
    }
    if (u.pathname === '/fixture/private') {
      const s = await new SessionStore(env.DB, origin).inspect(request);
      return s.kind === 'authenticated'
        ? Response.json({ actor: s.actor.accountId, privateMarker: 'PRIVATE-' + s.actor.accountId })
        : Response.json({ error: 'authentication_required' }, { status: 401 });
    }
    const ordinaryDraft = await createOrdinaryDraftHandler(env.DB, origin, { enabled: true })(
      request,
    );
    if (ordinaryDraft) return ordinaryDraft;
    for (const handler of [
      createEnrollmentHandler,
      createPrivateProfileHandler,
      createPrivateProjectHandler,
      createPrivateOwnPublicationsHandler,
    ]) {
      const r = await handler(env.DB, origin)(request);
      if (r) return r;
    }
    if (u.pathname === '/api/service-info') {
      const bindings: Env & ServiceInfoBindings = {
        ...(env as Env),
        PUBLIC_CONTACT_URL: request.headers.get('X-Test-Public-Contact') ?? undefined,
      };
      return productionApp.fetch(request, bindings);
    }
    if (u.pathname === '/api/catalog' || u.pathname === '/api/health')
      return productionApp.fetch(request, env as Env);
    if (u.pathname.startsWith('/api/'))
      return Response.json({ error: 'unavailable' }, { status: 404 });
    if (
      [
        '/',
        '/search',
        '/signup',
        '/login',
        '/account',
        '/drafts',
        '/works',
        '/works/new',
        '/moderation',
        '/guide',
        '/about',
        '/lab/account',
      ].includes(u.pathname) ||
      /^\/(?:(?:articles|projects)\/[0-9a-f-]{36}|students\/[A-Za-z0-9_-]{1,128}(?:\/(?:likes|works))?)$/.test(
        u.pathname,
      ) ||
      u.pathname.startsWith('/assets/')
    )
      return fetch('https://fixture-assets.invalid' + u.pathname);
    return new Response(
      '<!doctype html><title>Local generation QA</title><p>Bounded local HTTP fixture; production UI is not mounted.</p>',
      { headers: { 'Content-Type': 'text/html' } },
    );
  },
};
