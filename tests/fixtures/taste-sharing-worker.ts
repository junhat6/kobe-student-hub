import { createFixtureSession } from '../helpers/coordinated-fixture';
import { createOrdinaryDraftHandler } from '../../worker/ordinary-drafts-http';
// Test-only fictional sessions. "account-a" is the only configured operator. The taste sharing
// handler is reached through the production composition, with its flag either open or closed.
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
      enrollment?: boolean;
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
    if (i.action !== 'http' && i.action !== 'closed') return Response.json(null, { status: 400 });
    const target = new Request(i.url ?? origin + '/private/x', {
      method: i.method ?? 'GET',
      headers: i.headers,
      body: i.body,
    });
    const response = await createOrdinaryDraftHandler(
      env.DB,
      origin,
      { enabled: true, operatorIds: ['account-a'], tasteSharing: i.action === 'http' },
      clock,
    )(target);
    return Response.json(
      response && {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      },
    );
  },
};
