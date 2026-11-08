import { createPrivateDraftHandler } from './draft-http';

/** Ordinary authoring composition. Runtime bindings alone never enable drafts.
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
  return createPrivateDraftHandler(db, origin, clock);
}
