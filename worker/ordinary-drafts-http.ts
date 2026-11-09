import { createReadingHistoryHandler } from './reading-history-http';
import { createPrivateDraftHandler } from './draft-http';
import { createPrivateProfileHandler } from './profile-http';
import { createPrivatePublicationHandler } from './publication-http';
import { createPrivateOwnPublicationsHandler } from './own-publications-http';
import { createPrivatePublicationStopHandler } from './publication-stops-http';
import { createPrivateLikeHandler } from './likes-http';
import { createModerationHandler } from './moderation-http';
import { createPublicArticleHandler } from './public-articles-http';
import { createPublicProjectHandler } from './public-projects-http';
import { createPublicStudentHandler } from './public-students-http';
import { createPrivateProjectHandler } from './projects-http';
import { createPrivateProjectReportHandler } from './project-reports-http';
import { createMediaHandler } from './media-http';

/** Ordinary authoring and publication composition. Runtime bindings alone never enable it.
 * The entry also requires the independently reviewed OAuth release gate.
 * Identity, ownership, CSRF, enrollment and final-write checks stay in the shared handler.
 */
export function createOrdinaryDraftHandler(
  db: D1Database,
  origin: string,
  options: { enabled?: boolean; operatorIds?: readonly string[] } = {},
  clock: () => number = Date.now,
) {
  if (options.enabled !== true) return async (_request: Request): Promise<Response | null> => null;
  const handlers = [
    createReadingHistoryHandler(db, origin, clock),
    createMediaHandler(db, origin, clock),
    createPublicStudentHandler(db, origin, clock),
    createPublicArticleHandler(db, origin, clock),
    createPublicProjectHandler(db, origin, clock),
    createPrivateProjectHandler(db, origin, clock),
    createPrivateDraftHandler(db, origin, clock),
    createPrivateProfileHandler(db, origin, clock),
    createPrivatePublicationHandler(db, origin, clock),
    createPrivateOwnPublicationsHandler(db, origin, clock),
    createPrivatePublicationStopHandler(db, origin, clock),
    createPrivateLikeHandler(db, origin, clock),
  ];
  const reports = createModerationHandler(db, origin, options.operatorIds ?? [], clock);
  const projectReports = createPrivateProjectReportHandler(
    db,
    origin,
    options.operatorIds ?? [],
    clock,
  );
  return async (request: Request): Promise<Response | null> => {
    const path = new URL(request.url).pathname;
    // ProjectStore also owns the broader /api/private/project-* namespace.
    if (
      path.startsWith('/api/private/project-reports') ||
      path.startsWith('/api/private/project-moderation') ||
      path.startsWith('/api/private/moderation-media')
    )
      return projectReports(request);
    for (const handler of handlers) {
      const response = await handler(request);
      if (response) return response;
    }
    // The report client keeps its CSRF-only session response. Configured operator
    // routes still enforce the authenticated actor allowlist on every operation.
    if (
      path.startsWith('/api/private/reports') ||
      path.startsWith('/api/private/notifications') ||
      path === '/api/private/moderation/session' ||
      (options.operatorIds?.length &&
        (path.startsWith('/api/private/moderation/cases') ||
          path.startsWith('/api/private/moderation/notifications')))
    ) {
      return reports(request);
    }
    return null;
  };
}
