import { createFixtureSession } from '../helpers/coordinated-fixture';
import { createPrivateProfileReportHandler } from '../../worker/profile-reports-http';
import { createOrdinaryDraftHandler } from '../../worker/ordinary-drafts-http';
import { PublicProfileStore } from '../../worker/public-profile';
import { createPrivateProjectHandler } from '../../worker/projects-http';
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
    // The production composition proves /api/private/profile-* is not swallowed by /api/private/profile.
    if (request.headers.has('X-Test-Composed'))
      return (
        (await createOrdinaryDraftHandler(
          env.DB,
          origin,
          {
            enabled: true,
            operatorIds: ['account-1'],
          },
          () => now,
        )(request)) ?? new Response('unmatched', { status: 418 })
      );
    const reports = await createPrivateProfileReportHandler(
      env.DB,
      origin,
      request.headers.has('X-Test-No-Operator') ? [] : ['account-1'],
      () => now,
    )(request);
    if (reports) return reports;
    return (
      (await createPrivateProjectHandler(env.DB, origin, () => now)(request)) ??
      new Response('unmatched', { status: 418 })
    );
  },
};
