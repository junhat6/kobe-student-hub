import { createFixtureSession } from '../helpers/coordinated-fixture';
import { createOrdinaryDraftHandler } from '../../worker/ordinary-drafts-http';
import { PublicProfileStore } from '../../worker/public-profile';
const origin = 'https://app.example.invalid';
export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const u = new URL(request.url),
      now = Number(request.headers.get('X-Test-Now') ?? 1800000000000);
    if (u.pathname === '/fixture/session')
      return Response.json(
        await createFixtureSession(env.DB, origin, () => now, {
          provider: 'google',
          subject: 'subject-' + request.headers.get('X-Test-Who'),
          email: 'fixture@st.kobedenshi.ac.jp',
        }),
      );
    if (u.pathname === '/fixture/profile')
      return Response.json(
        await new PublicProfileStore(env.DB, origin, () => now).create(
          request,
          await request.json(),
        ),
      );
    // The production composition, so routing order against /api/private/profile* is covered.
    return (
      (await createOrdinaryDraftHandler(
        env.DB,
        origin,
        { enabled: true, operatorIds: ['account-1'] },
        () => now,
      )(request)) ?? new Response('unmatched', { status: 418 })
    );
  },
};
