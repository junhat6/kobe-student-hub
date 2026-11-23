import { createFixtureSession } from '../helpers/coordinated-fixture';
import { ArticlePublicationStore } from '../../worker/publication';
import { PrivateDraftStore } from '../../worker/drafts';
import { createAgentHandler } from '../../worker/agent/http';
// Test-only fictional sessions. The agent handler is composed exactly as production does, enabled.
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
      enrollment?: boolean;
      taste?: boolean;
    };
    const origin = 'https://app.example.invalid';
    const clock = () => i.now;
    if (i.action === 'session')
      return Response.json(
        await createFixtureSession(
          env.DB,
          origin,
          clock,
          { provider: 'google', subject: 'subject-' + i.who, email: 'fixture@st.kobedenshi.ac.jp' },
          { enrollment: i.enrollment },
        ),
      );
    const target = new Request(i.url ?? origin + '/private/x', {
      method: i.method ?? 'GET',
      headers: i.headers,
      body: i.body,
    });
    if (i.action === 'http') {
      const response = await createAgentHandler(
        env.DB,
        origin,
        { enabled: true, tasteEnabled: i.taste !== false },
        clock,
      )(target);
      if (!response) return Response.json(null);
      return Response.json({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      });
    }
    if (i.action === 'disabled')
      return Response.json((await createAgentHandler(env.DB, origin, {}, clock)(target)) === null);
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
