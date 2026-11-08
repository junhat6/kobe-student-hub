import { createFixtureSession } from '../helpers/coordinated-fixture';
import { SessionStore } from '../../worker/auth/sessions';
import { createPrivateDraftHandler } from '../../worker/draft-http';
import { createOrdinaryDraftHandler } from '../../worker/ordinary-drafts-http';
// Test-only session and stream controls, never production routes.
export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const now = Number(request.headers.get('X-Test-Now') ?? 1800000000000);
    const origin = request.headers.get('X-Test-Origin') ?? 'https://app.example.invalid';
    if (new URL(request.url).pathname === '/fixture/session')
      return Response.json(
        await createFixtureSession(env.DB, 'https://app.example.invalid', () => now, {
          provider: 'google',
          subject: request.headers.get('X-Test-Subject') ?? 'subject-a',
          email: 'fixture@st.kobedenshi.ac.jp',
        }),
      );
    let authenticated: () => void = () => {};
    const authReady = new Promise<void>((resolve) => {
      authenticated = resolve;
    });
    const failing = request.headers.get('X-Test-Fail-Store') === 'yes';
    const db = failing
      ? new Proxy(env.DB, {
          get(target, key) {
            if (key === 'prepare')
              return (sql: string) => {
                if (sql.includes('private_article_drafts'))
                  throw new Error('synthetic private storage failure');
                return target.prepare(sql);
              };
            const value = Reflect.get(target, key);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        })
      : env.DB;
    const tracked = new Proxy(db, {
      get(target, key) {
        if (key === 'prepare')
          return (sql: string) => {
            const wrap = (stmt: D1PreparedStatement): D1PreparedStatement =>
              new Proxy(stmt, {
                get(statement, prop) {
                  if (prop === 'bind')
                    return (...values: unknown[]) => wrap(statement.bind(...values));
                  if (prop === 'first')
                    return async (...args: Parameters<D1PreparedStatement['first']>) => {
                      const result = await statement.first(...args);
                      if (sql.startsWith('UPDATE auth_sessions SET last_seen_ms=')) authenticated();
                      return result;
                    };
                  const value = Reflect.get(statement, prop);
                  return typeof value === 'function' ? value.bind(statement) : value;
                },
              });
            return wrap(target.prepare(sql));
          };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    let target = request;
    const declared = request.headers.get('X-Test-Length');
    if (declared !== null) {
      const h = new Headers(request.headers);
      h.set('Content-Length', declared);
      target = new Request(request.url, { method: request.method, headers: h, body: request.body });
    }
    const mode = request.headers.get('X-Test-Body');
    if (mode) {
      let offset = 0;
      const small = new TextEncoder().encode('{"title":"small","body":""}');
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (mode === 'epoch') {
            await authReady;
            await env.DB.prepare(
              "UPDATE private_accounts SET session_epoch=session_epoch+1 WHERE id='account-a'",
            ).run();
            controller.enqueue(small);
            controller.close();
          } else if (mode === 'small') {
            if (offset < small.length) controller.enqueue(small.subarray(offset, ++offset));
            else controller.close();
          } else if (mode === 'empty-flood') controller.enqueue(new Uint8Array(0));
        },
        start(controller) {
          if (mode === 'oversize') controller.enqueue(new Uint8Array(2097153));
          else if (mode === 'utf8') {
            controller.enqueue(new Uint8Array([255]));
            controller.close();
          } else if (mode === 'late')
            setTimeout(() => {
              try {
                controller.enqueue(new TextEncoder().encode('{"title":"late","body":""}'));
                controller.close();
              } catch {}
            }, 5500);
        },
        cancel() {
          if (mode === 'oversize') return new Promise<void>(() => {});
        },
      });
      const h = new Headers(target.headers);
      if (declared === null) h.delete('Content-Length');
      target = new Request(request.url, { method: request.method, headers: h, body: stream });
    }
    const ordinary = request.headers.get('X-Test-Ordinary');
    const handler =
      ordinary === null
        ? createPrivateDraftHandler(tracked, origin, () => now)
        : createOrdinaryDraftHandler(tracked, origin, { enabled: ordinary === 'open' }, () => now);
    return (await handler(target)) ?? new Response('unmatched', { status: 418 });
  },
};
