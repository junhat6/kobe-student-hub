import { createFixtureSession } from '../helpers/coordinated-fixture';
import { createPrivateProjectReportHandler } from '../../worker/project-reports-http';
import { SessionStore } from '../../worker/auth/sessions';
import { PublicProfileStore } from '../../worker/public-profile';
import { ProjectStore } from '../../worker/projects';
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
    let fired = false,
      authenticated = 0;
    const raceAt = Number(request.headers.get('X-Test-Race-At') ?? 1);
    const race = request.headers.get('X-Test-Race');
    const db = race
      ? new Proxy(env.DB, {
          get(t, k) {
            if (k !== 'prepare') {
              const v = Reflect.get(t, k);
              return typeof v === 'function' ? v.bind(t) : v;
            }
            return (sql: string) => {
              const wrap = (s: D1PreparedStatement): D1PreparedStatement =>
                new Proxy(s, {
                  get(a, p) {
                    if (p === 'bind') return (...v: unknown[]) => wrap(a.bind(...v));
                    if (p === 'first')
                      return async (...v: Parameters<D1PreparedStatement['first']>) => {
                        const r = await a.first(...v);
                        if (sql.startsWith('UPDATE auth_sessions SET last_seen_ms='))
                          authenticated++;
                        if (
                          !fired &&
                          authenticated === raceAt &&
                          sql.startsWith('UPDATE auth_sessions SET last_seen_ms=')
                        ) {
                          fired = true;
                          if (race === 'context')
                            await env.DB.prepare(
                              'UPDATE auth_browser_contexts SET generation=generation+1 WHERE context_hash IN(SELECT context_hash FROM auth_sessions WHERE account_id=?)',
                            )
                              .bind((r as { account_id?: string } | null)?.account_id ?? '')
                              .run();
                          else
                            await env.DB.prepare('UPDATE auth_sessions SET revoked_at_ms=?')
                              .bind(now)
                              .run();
                        }
                        return r;
                      };
                    const v = Reflect.get(a, p);
                    return typeof v === 'function' ? v.bind(a) : v;
                  },
                });
              return wrap(t.prepare(sql));
            };
          },
        })
      : env.DB;
    if (u.pathname === '/fixture/profile')
      return Response.json(
        await new PublicProfileStore(db, origin, () => now).create(request, await request.json()),
      );
    const store = new ProjectStore(db, origin, () => now);
    if (u.pathname.startsWith('/public/project/'))
      return Response.json(await store.readPublished(u.pathname.split('/').pop()));
    if (u.pathname.startsWith('/public/author/'))
      return Response.json(await store.readAuthor(u.pathname.split('/').pop()));
    let target = request;
    const mode = request.headers.get('X-Test-Body');
    if (mode) {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          if (mode === 'utf8') {
            c.enqueue(new Uint8Array([255]));
            c.close();
          }
          if (mode === 'late')
            setTimeout(() => {
              try {
                c.enqueue(
                  new TextEncoder().encode(
                    JSON.stringify({
                      title: 'late',
                      description: 'late',
                      githubUrl: '',
                      demoUrl: '',
                    }),
                  ),
                );
                c.close();
              } catch {}
            }, 5500);
        },
        pull(c) {
          if (mode === 'empty') c.enqueue(new Uint8Array(0));
        },
        cancel() {
          return new Promise<void>(() => {});
        },
      });
      target = new Request(request.url, { method: request.method, headers: request.headers, body });
    }
    const reports = await createPrivateProjectReportHandler(
      db,
      origin,
      request.headers.has('X-Test-No-Operator') ? [] : ['account-1'],
      () => now,
    )(target);
    if (reports) return reports;
    return (
      (await createPrivateProjectHandler(
        db,
        request.headers.get('X-Test-Origin') ?? origin,
        () => now,
      )(target)) ?? new Response('unmatched', { status: 418 })
    );
  },
};
