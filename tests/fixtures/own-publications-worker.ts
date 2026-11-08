import { createFixtureSession } from '../helpers/coordinated-fixture';
import { SessionStore } from '../../worker/auth/sessions';
import { PublicProfileStore } from '../../worker/public-profile';
import { PrivateDraftStore } from '../../worker/drafts';
import { ArticlePublicationStore } from '../../worker/publication';
import { ArticleModerationStore } from '../../worker/moderation';
import { ProjectStore } from '../../worker/projects';
import { ProjectReportStore } from '../../worker/project-reports';
import { createPrivateOwnPublicationsHandler } from '../../worker/own-publications-http';
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
      fault = request.headers.has('X-Test-Fault'),
      finalRace = request.headers.has('X-Test-Final-Race');
    const db =
      race || fault || finalRace
        ? new Proxy(env.DB, {
            get(t, k) {
              if (k !== 'prepare') {
                const v = Reflect.get(t, k);
                return typeof v === 'function' ? v.bind(t) : v;
              }
              return (sql: string) => {
                if (fault && sql.startsWith('WITH authorized')) throw Error('fixture');
                const wrap = (s: D1PreparedStatement): D1PreparedStatement =>
                  new Proxy(s, {
                    get(a, p) {
                      if (p === 'bind') return (...v: unknown[]) => wrap(a.bind(...v));
                      if (p === 'all' && finalRace && sql.startsWith('WITH authorized'))
                        return async () => {
                          await env.DB.prepare('UPDATE auth_sessions SET revoked_at_ms=?')
                            .bind(now)
                            .run();
                          return a.all();
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
                            if (race === 'status')
                              await env.DB.prepare(
                                "UPDATE private_accounts SET status='suspended'",
                              ).run();
                            else if (race === 'context')
                              await env.DB.prepare(
                                'UPDATE auth_browser_contexts SET generation=generation+1 WHERE context_hash IN(SELECT context_hash FROM auth_sessions WHERE account_id=?)',
                              )
                                .bind((r as { account_id?: string } | null)?.account_id ?? '')
                                .run();
                            else if (race === 'epoch')
                              await env.DB.prepare(
                                'UPDATE private_accounts SET session_epoch=session_epoch+1',
                              ).run();
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
    if (u.pathname === '/fixture/action') {
      const i = (await request.json()) as { action: string; input?: unknown; id?: string };
      const target = new Request(origin + '/private', { method: 'POST', headers: request.headers });
      let result: unknown;
      const projects = new ProjectStore(db, origin, () => now);
      switch (i.action) {
        case 'profile':
          result = await new PublicProfileStore(db, origin, () => now).create(target, i.input);
          break;
        case 'article-draft':
          result = await new PrivateDraftStore(db, origin, () => now).create(target, i.input);
          break;
        case 'article-publish':
          result = await new ArticlePublicationStore(db, origin, () => now).publish(
            target,
            i.id,
            i.input,
          );
          break;
        case 'article-report':
          result = await new ArticleModerationStore(db, origin, [], () => now).report(
            target,
            i.id,
            i.input,
          );
          break;
        case 'project-draft':
          result = await projects.createDraft(target, i.input);
          break;
        case 'project-publish':
          result = await projects.publish(target, i.id, i.input);
          break;
        case 'project-report':
          result = await new ProjectReportStore(db, origin, [], () => now).report(
            target,
            i.id,
            i.input,
          );
      }
      return Response.json(result);
    }
    return (
      (await createPrivateOwnPublicationsHandler(
        db,
        request.headers.get('X-Test-Origin') ?? origin,
        () => now,
      )(request)) ?? new Response('unmatched', { status: 418 })
    );
  },
};
