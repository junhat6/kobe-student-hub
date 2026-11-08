import { createFixtureSession } from '../helpers/coordinated-fixture';
import { SessionStore } from '../../worker/auth/sessions';
import { createPrivateSessionHandler } from '../../worker/session-http';
// Test-only sessions and fault/race injection. Never imported by production.
export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const now = Number(request.headers.get('X-Test-Now') ?? 1800000000000);
    const origin = 'https://app.example.invalid';
    if (new URL(request.url).pathname === '/fixture/session')
      return Response.json(
        await createFixtureSession(env.DB, origin, () => now, {
          provider: 'google',
          subject: 'subject-' + request.headers.get('X-Test-Who'),
          email: 'fixture@st.kobedenshi.ac.jp',
        }),
      );
    let authenticated = 0;
    const race = request.headers.get('X-Test-Race');
    const fault = request.headers.get('X-Test-Fault');
    const db =
      race || fault
        ? new Proxy(env.DB, {
            get(target, key) {
              if (key === 'batch' && fault === 'throw')
                return async () => {
                  throw Error('synthetic private failure');
                };
              if (key === 'batch' && fault === 'failed')
                return async () => [{ success: false, results: [], meta: { changes: 0 } }];
              if (key !== 'prepare') {
                const value = Reflect.get(target, key);
                return typeof value === 'function' ? value.bind(target) : value;
              }
              return (sql: string) => {
                const wrap = (stmt: D1PreparedStatement): D1PreparedStatement =>
                  new Proxy(stmt, {
                    get(statement, prop) {
                      if (prop === 'bind')
                        return (...values: unknown[]) => wrap(statement.bind(...values));
                      if (
                        prop === 'run' &&
                        sql.startsWith('UPDATE auth_sessions SET revoked_at_ms=')
                      ) {
                        if (fault === 'throw')
                          return async () => {
                            throw new Error('synthetic private failure');
                          };
                        if (fault === 'failed')
                          return async () => ({ success: false, meta: { changes: 0 } });
                      }
                      if (prop === 'first')
                        return async (...args: Parameters<D1PreparedStatement['first']>) => {
                          if (
                            fault === 'lookup' &&
                            sql.startsWith('UPDATE auth_sessions SET last_seen_ms=')
                          )
                            throw new Error('synthetic private storage failure');
                          const result = await statement.first(...args);
                          if (sql.startsWith('UPDATE auth_sessions SET last_seen_ms=')) {
                            authenticated++;
                            if (authenticated === 1) {
                              if (race === 'revoke')
                                await env.DB.prepare('UPDATE auth_sessions SET revoked_at_ms=?')
                                  .bind(now)
                                  .run();
                              if (race === 'status')
                                await env.DB.prepare(
                                  "UPDATE private_accounts SET status='suspended'",
                                ).run();
                              if (race === 'epoch')
                                await env.DB.prepare(
                                  'UPDATE private_accounts SET session_epoch=session_epoch+1',
                                ).run();
                            }
                          }
                          return result;
                        };
                      const value = Reflect.get(statement, prop);
                      return typeof value === 'function' ? value.bind(statement) : value;
                    },
                  });
                return wrap(target.prepare(sql));
              };
            },
          })
        : env.DB;
    let target = request;
    const mode = request.headers.get('X-Test-Body');
    const length = request.headers.get('X-Test-Length');
    if (mode || length !== null) {
      const h = new Headers(request.headers);
      h.delete('Content-Length');
      if (length !== null) h.set('Content-Length', length);
      const body = mode
        ? new ReadableStream<Uint8Array>(
            {
              pull() {
                throw new Error('unexpected body read');
              },
              cancel() {
                return new Promise<void>(() => {});
              },
            },
            { highWaterMark: 0 },
          )
        : request.body;
      target = new Request(request.url, { method: request.method, headers: h, body });
    }
    if (request.headers.has('X-Test-URL'))
      target = new Request(request.headers.get('X-Test-URL')!, {
        method: request.method,
        headers: request.headers,
      });
    return (
      (await createPrivateSessionHandler(
        db,
        request.headers.get('X-Test-Origin') ?? origin,
        () => now,
      )(target)) ?? new Response('unmatched', { status: 418 })
    );
  },
};
