import { SessionStore } from './auth/sessions';
import { ProjectStore } from './projects';
import { canonicalOrigin, readBoundedJson } from './http-boundary';
const PREFIX = '/api/private/project-';
const LIMIT = 32 * 1024;
// Transport work bound, including zero-byte chunks; distinct from the content byte limit.
const MAX_CHUNKS = 4096;
const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Type': 'application/json; charset=utf-8',
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers });
const error = (status: number, code: string) => json({ error: code }, status);
const unavailable = () => error(404, 'project_unavailable');
const input = (request: Request) => readBoundedJson(request, { bytes: LIMIT, chunks: MAX_CHUNKS });
/** Local-only HTTP boundary; production routes remain unconnected. */
export function createPrivateProjectHandler(
  db: D1Database,
  origin: string,
  clock: () => number = Date.now,
) {
  const sessions = new SessionStore(db, origin, clock),
    store = new ProjectStore(db, origin, clock);
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(PREFIX)) return null;
    if (!canonicalOrigin(origin)) return error(503, 'project_unavailable');
    const match =
      /^\/api\/private\/project-(drafts|publications|journal)(?:\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}))?$/.exec(
        url.pathname,
      );
    if (!match || url.search || url.hash || (match[1] !== 'drafts' && !match[2]))
      return unavailable();
    const id = match[2],
      publication = match[1] === 'publications',
      // #273: the journal links of an own published project, addressed by its draft id like the receipt.
      journal = match[1] === 'journal',
      allowed = publication ? ['GET', 'POST', 'PUT'] : id ? ['GET', 'PUT'] : ['GET', 'POST'];
    if (!allowed.includes(request.method)) {
      const r = error(405, 'method_not_allowed');
      r.headers.set('Allow', allowed.join(', '));
      return r;
    }
    try {
      const auth =
        request.method === 'GET'
          ? await sessions.authenticate(request)
          : await sessions.authorizeMutation(request);
      if (!auth) return error(401, 'authentication_required');
      let result: unknown;
      if (request.method === 'GET')
        result = journal
          ? await store.readJournal(request, id)
          : publication
            ? await store.getOwnReceipt(request, id)
            : id
              ? await store.getDraft(request, id)
              : await store.listDrafts(request);
      else {
        const body = await input(request);
        if (!body.ok) return error(body.status, 'invalid_request');
        result = journal
          ? await store.setJournalLink(request, id, body.value)
          : publication
            ? request.method === 'PUT'
              ? await store.setStage(request, id, body.value)
              : await store.publish(request, id, body.value)
            : id
              ? await store.saveDraft(request, id, body.value)
              : await store.createDraft(request, body.value);
      }
      if (result === null) return unavailable();
      if (
        new TextEncoder().encode(JSON.stringify(result)).length >
        (request.method === 'GET' && !id ? 262144 : 65536)
      )
        return unavailable();
      return json(result, request.method === 'POST' ? 201 : 200);
    } catch {
      return unavailable();
    }
  };
}
