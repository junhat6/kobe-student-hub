import { createFixtureSession } from '../helpers/coordinated-fixture';
import { SessionStore } from '../../worker/auth/sessions';
import { createPrivateSessionHandler } from '../../worker/session-http';

const origin = 'https://session-retry.example.test';
export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const input = (await request.json()) as {
      action?: 'create' | 'authenticate';
      cookie?: string;
      times: number[];
      holds?: string[];
    };
    let clockReads = 0,
      lookups = 0,
      aheadReads = 0;
    const clock = () => input.times[Math.min(clockReads++, input.times.length - 1)];
    if (input.action === 'create')
      return Response.json(
        await createFixtureSession(env.DB, origin, clock, {
          provider: 'google',
          subject: 'session-retry-fixture',
          email: 'session-retry-fixture@st.kobedenshi.ac.jp',
        }),
      );
    const db = new Proxy(env.DB, {
      get(target, key) {
        if (key === 'prepare')
          return (sql: string) => {
            const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
              new Proxy(statement, {
                get(value, property) {
                  if (property === 'bind') return (...args: unknown[]) => wrap(value.bind(...args));
                  if (
                    property === 'first' &&
                    sql.startsWith('UPDATE auth_sessions SET last_seen_ms=')
                  )
                    return async (...args: unknown[]) => {
                      const hold = input.holds?.[lookups++];
                      if (hold)
                        await fetch(
                          'https://session-retry-control.invalid/hold?tag=' +
                            encodeURIComponent(hold),
                        );
                      return value.first(...(args as []));
                    };
                  if (
                    property === 'first' &&
                    sql.startsWith('SELECT 1 AS present FROM auth_sessions')
                  )
                    return async (...args: unknown[]) => {
                      aheadReads++;
                      return value.first(...(args as []));
                    };
                  const result = Reflect.get(value, property);
                  return typeof result === 'function' ? result.bind(value) : result;
                },
              });
            return wrap(target.prepare(sql));
          };
        const result = Reflect.get(target, key);
        return typeof result === 'function' ? result.bind(target) : result;
      },
    });
    const target = new Request(origin + '/api/private/session', {
      headers: { Cookie: input.cookie ?? '' },
    });
    const response =
      input.action === 'authenticate'
        ? Response.json(await new SessionStore(db, origin, clock).authenticate(target))
        : (await createPrivateSessionHandler(db, origin, clock)(target))!;
    response.headers.set('X-Fixture-Lookups', String(lookups));
    response.headers.set('X-Fixture-Ahead-Reads', String(aheadReads));
    return response;
  },
};
