import { createOrdinaryDraftHandler } from '../../worker/ordinary-drafts-http';
import { createFixtureSession } from '../helpers/coordinated-fixture';
const origin = 'https://app.example.invalid';
export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const now = 1800000000000;
    if (new URL(request.url).pathname === '/fixture/session')
      return Response.json(
        await createFixtureSession(env.DB, origin, () => now, {
          provider: 'google',
          subject: 'subject-' + request.headers.get('X-Test-Who'),
          email: 'fixture@st.kobedenshi.ac.jp',
        }),
      );
    let fired = false;
    const db = request.headers.has('X-Test-Revoke')
      ? new Proxy(env.DB, {
          get(target, key) {
            if (key !== 'prepare') {
              const v = Reflect.get(target, key);
              return typeof v === 'function' ? v.bind(target) : v;
            }
            return (sql: string) => {
              const wrap = (stmt: D1PreparedStatement): D1PreparedStatement =>
                new Proxy(stmt, {
                  get(s, k) {
                    if (k === 'bind') return (...v: unknown[]) => wrap(s.bind(...v));
                    if (k === 'run' && sql.startsWith('INSERT INTO project_moderation_decisions'))
                      return async () => {
                        if (!fired) {
                          fired = true;
                          await env.DB.prepare(
                            "UPDATE auth_sessions SET revoked_at_ms=? WHERE account_id='account-1'",
                          )
                            .bind(now)
                            .run();
                        }
                        return s.run();
                      };
                    const v = Reflect.get(s, k);
                    return typeof v === 'function' ? v.bind(s) : v;
                  },
                });
              return wrap(target.prepare(sql));
            };
          },
        })
      : env.DB;
    return (
      (await createOrdinaryDraftHandler(
        db,
        origin,
        {
          enabled: !request.headers.has('X-Test-Closed'),
          operatorIds: request.headers.has('X-Test-No-Operator') ? [] : ['account-1'],
        },
        () => now,
      )(request)) ?? new Response('unavailable', { status: 404 })
    );
  },
};
