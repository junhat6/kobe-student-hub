import { createFixtureSession } from '../helpers/coordinated-fixture';
import { ArticlePublicationStore } from '../../worker/publication';
import { PrivateDraftStore } from '../../worker/drafts';
import { createEditorialReviewHandler } from '../../worker/editorial-reviews-http';
import { createOrdinaryDraftHandler } from '../../worker/ordinary-drafts-http';
// Test-only fictional sessions. "account-a" is the only configured operator.
export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const i = (await request.json()) as {
      action: string;
      now: number;
      who?: string;
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      input?: unknown;
      draft?: unknown;
    };
    const origin = 'https://app.example.invalid';
    const clock = () => i.now;
    const operatorIds = ['account-a'];
    if (i.action === 'session')
      return Response.json(
        await createFixtureSession(env.DB, origin, clock, {
          provider: 'google',
          subject: 'subject-' + i.who,
          email: 'fixture@st.kobedenshi.ac.jp',
        }),
      );
    const target = new Request(i.url ?? origin + '/private/x', {
      method: i.method ?? 'GET',
      headers: i.headers,
      body: i.body,
    });
    const reply = async (response: Response | null) =>
      Response.json(
        response && {
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: await response.text(),
        },
      );
    if (i.action === 'http')
      return reply(
        await createEditorialReviewHandler(
          env.DB,
          origin,
          { enabled: true, operatorIds },
          clock,
        )(target),
      );
    if (i.action === 'composed-closed')
      return reply(
        await createOrdinaryDraftHandler(
          env.DB,
          origin,
          { enabled: true, operatorIds, editorialReviews: false },
          clock,
        )(target),
      );
    if (i.action === 'create')
      return Response.json(
        await new PrivateDraftStore(env.DB, origin, clock).create(target, i.input),
      );
    if (i.action === 'publish')
      return Response.json(
        await new ArticlePublicationStore(env.DB, origin, clock).publish(target, i.draft, i.input),
      );
    return Response.json(null, { status: 400 });
  },
};
