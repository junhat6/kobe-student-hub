import { createFixtureSession } from '../helpers/coordinated-fixture';
import { PublicationStopStore } from '../../worker/publication-stops';
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
    const race = request.headers.get('X-Test-Race'),
      discoveryFault = request.headers.has('X-Test-Discovery-Fault'),
      discoveryRace = request.headers.has('X-Test-Discovery-Race');
    const db =
      race || discoveryFault || discoveryRace
        ? new Proxy(env.DB, {
            get(t, k) {
              if (k !== 'prepare') {
                const v = Reflect.get(t, k);
                return typeof v === 'function' ? v.bind(t) : v;
              }
              return (sql: string) => {
                if (discoveryFault && sql.includes('project_publications')) throw Error('fixture');
                const wrap = (s: D1PreparedStatement): D1PreparedStatement =>
                  new Proxy(s, {
                    get(a, p) {
                      if (p === 'bind') return (...v: unknown[]) => wrap(a.bind(...v));
                      if (
                        p === 'all' &&
                        discoveryRace &&
                        sql.startsWith('SELECT id FROM project_publications')
                      )
                        return async () => {
                          const result = await a.all<{ id: string }>();
                          if (result.results[0])
                            await env.DB.prepare(
                              "UPDATE project_publications SET status='hidden' WHERE id=?",
                            )
                              .bind(result.results[0].id)
                              .run();
                          return result;
                        };
                      if (p === 'first')
                        return async (...v: Parameters<D1PreparedStatement['first']>) => {
                          const r = await a.first(...v);
                          if (sql.startsWith('UPDATE auth_sessions SET last_seen_ms='))
                            authenticated++;
                          if (
                            race &&
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
    if (u.pathname === '/public/discovery') return Response.json(await store.readRecentPublished());
    if (u.pathname.startsWith('/fixture/stop/'))
      return Response.json(
        await new PublicationStopStore(db, origin, () => now).stop(
          request,
          'project',
          u.pathname.split('/').pop(),
          await request.json(),
        ),
      );
    if (u.pathname.startsWith('/public/project/'))
      return Response.json(await store.readPublished(u.pathname.split('/').pop()));
    if (u.pathname.startsWith('/public/author/'))
      return Response.json(await store.readAuthor(u.pathname.split('/').pop()));
    let target = request;
    const mode = request.headers.get('X-Test-Body');
    if (mode) {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
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
    return (
      (await createPrivateProjectHandler(
        db,
        request.headers.get('X-Test-Origin') ?? origin,
        () => now,
      )(target)) ?? new Response('unmatched', { status: 418 })
    );
  },
};
