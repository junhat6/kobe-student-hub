import { createPrivateDraftHandler } from './draft-http';
import { createPrivateProfileHandler } from './profile-http';
import { createPrivatePublicationHandler } from './publication-http';
import { createPrivateOwnPublicationsHandler } from './own-publications-http';
import { createPrivatePublicationStopHandler } from './publication-stops-http';
import { createPrivateLikeHandler } from './likes-http';
import { createModerationHandler } from './moderation-http';
import { createPublicArticleHandler } from './public-articles-http';

/** Ordinary authoring and publication composition. Runtime bindings alone never enable it.
 * The entry also requires the independently reviewed OAuth release gate.
 * Identity, ownership, CSRF, enrollment and final-write checks stay in the shared handler.
 */
export function createOrdinaryDraftHandler(
  db: D1Database,
  origin: string,
  options: { enabled?: boolean } = {},
  clock: () => number = Date.now,
) {
  if (options.enabled !== true) return async (_request: Request): Promise<Response | null> => null;
  const handlers = [
    createPublicArticleHandler(db, origin, clock),
    createPrivateDraftHandler(db, origin, clock),
    createPrivateProfileHandler(db, origin, clock),
    createPrivatePublicationHandler(db, origin, clock),
    createPrivateOwnPublicationsHandler(db, origin, clock),
    createPrivatePublicationStopHandler(db, origin, clock),
    createPrivateLikeHandler(db, origin, clock),
  ];
  const reports = createModerationHandler(db, origin, [], clock);
  return async (request: Request): Promise<Response | null> => {
    for (const handler of handlers) {
      const response = await handler(request);
      if (response) return response;
    }
    const path = new URL(request.url).pathname;
    // The existing report client uses this CSRF-only session response. Operator
    // queues and case reads stay unmounted until an actual allowlist is provided.
    if (path.startsWith('/api/private/reports') || path === '/api/private/moderation/session') {
      return reports(request);
    }
    return null;
  };
}
