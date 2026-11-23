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
    if (i.action !== 'http' && i.action !== 'closed' && i.action !== 'race')
      return Response.json(null, { status: 400 });
    // "race": the student's agent replaces the ledger (same lines, next version) after the
    // handler has read it and just before its delete batch runs.
    const db: D1Database =
      i.action === 'race'
        ? new Proxy(env.DB, {
            get(target, key) {
              if (key !== 'batch') {
                const value = Reflect.get(target, key) as unknown;
                return typeof value === 'function' ? value.bind(target) : value;
              }
              return async (statements: D1PreparedStatement[]) => {
                await target
                  .prepare(
                    "UPDATE agent_taste_ledgers SET version=version+1 WHERE account_id='account-r'",
                  )
                  .run();
                return target.batch(statements);
              };
            },
          })
        : env.DB;
    const target = new Request(i.url ?? origin + '/private/x', {
      method: i.method ?? 'GET',
      headers: i.headers,
      body: i.body,
    });
    const response = await createOrdinaryDraftHandler(
      db,
      origin,
      { enabled: true, operatorIds: ['account-a'], tasteSharing: i.action !== 'closed' },
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
