import {
  createOAuthHttpHandler,
  parseOAuthConfig,
  type OAuthBindings,
} from '../../worker/auth/oauth-http';
import {
  readSessionRestriction,
  type SessionRestrictionReader,
} from '../../worker/auth/session-guard';
import { createPrivateDraftHandler } from '../../worker/draft-http';

/** Test-only compatibility fixture for legacy restricted sessions. Never a product entry.
 * The reader is trusted server policy for one designated pending trial account, never client input.
 * Removing policy closes access; status/epoch changes independently revoke stored authority.
 */
export function createLegacyRestrictedFixture(
  db: D1Database,
  bindings: OAuthBindings,
  restriction: SessionRestrictionReader,
  clock: () => number = Date.now,
) {
  const closed = () =>
    new Response(JSON.stringify({ error: 'limited_access_unavailable' }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store',
        Vary: 'Cookie',
        'Referrer-Policy': 'no-referrer',
        'X-Robots-Tag': 'noindex, nofollow',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url),
      config = parseOAuthConfig(bindings);
    if (url.pathname === '/api/auth/callback' && request.method === 'GET')
      return config && url.origin === config.origin
        ? await callback()
        : new Response(null, {
            status: 303,
            headers: {
              Location: '/',
              'Cache-Control': 'private, no-store',
              'Referrer-Policy': 'no-referrer',
            },
          });
    return callback();
    async function callback() {
      if (!config || url.origin !== config.origin) return closed();
      const expired = () =>
        url.pathname === '/api/auth/callback' && request.method === 'GET'
          ? new Response(null, {
              status: 303,
              headers: {
                Location: config.origin + '/',
                'Cache-Control': 'private, no-store',
                'Referrer-Policy': 'no-referrer',
                'X-Robots-Tag': 'noindex, nofollow',
              },
            })
          : closed();
      try {
        if (!readSessionRestriction(restriction, clock())) return expired();
      } catch {
        return expired();
      }
      if (url.pathname === '/api/auth/register' || url.pathname === '/api/auth/pilot')
        return closed();
      if (url.pathname.startsWith('/api/private/drafts'))
        return (
          (await createPrivateDraftHandler(db, config.origin, clock, restriction)(request)) ??
          closed()
        );
      return (
        (await createOAuthHttpHandler(
          db,
          bindings,
          { enabled: true, loginOnly: true, authorizationJson: true, restriction },
          clock,
        )(request)) ?? closed()
      );
    }
  };
}
