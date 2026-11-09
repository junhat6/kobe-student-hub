import { createFixtureSession } from '../helpers/coordinated-fixture';
import { createReadingHistoryHandler } from '../../worker/reading-history-http';
import { createOrdinaryDraftHandler } from '../../worker/ordinary-drafts-http';
import { PublicProfileStore } from '../../worker/public-profile';
import { PrivateDraftStore } from '../../worker/drafts';
import { ArticlePublicationStore } from '../../worker/publication';
import { ProjectStore } from '../../worker/projects';
// Native D1 and fictional identities only. Never deployed or mounted in production.
export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const origin = 'https://app.example.invalid';
    const now = Number(request.headers.get('X-Test-Now') ?? 1800000000000);
    const url = new URL(request.url);
    if (url.pathname === '/fixture/session')
      return Response.json(
        await createFixtureSession(env.DB, origin, () => now, {
          provider: 'google',
          subject: 'history-subject-' + request.headers.get('X-Test-Who'),
          email: 'fictional@st.kobedenshi.ac.jp',
        }),
      );
    if (url.pathname === '/fixture/publish') {
      const i = (await request.json()) as { headers: Record<string, string>; kind: string };
      const target = new Request(origin + '/fixture/publish', {
        method: 'POST',
        headers: i.headers,
      });
      await new PublicProfileStore(env.DB, origin, () => now).create(target, {
        displayName: 'Fictional history author',
        department: '',
        yearLabel: '',
        bio: '',
        confirmPublic: true,
      });
      if (i.kind === 'article') {
        const d = await new PrivateDraftStore(env.DB, origin, () => now).create(target, {
          title: 'Ordinary history article',
          body: '# Public body',
        });
        return Response.json(
          await new ArticlePublicationStore(env.DB, origin, () => now).publish(target, d?.id, {
            expectedVersion: 1,
            confirmPublic: true,
            summary: 'Public summary',
            tags: [],
            minutes: 1,
          }),
        );
      }
      const s = new ProjectStore(env.DB, origin, () => now);
      const d = await s.createDraft(target, {
        title: 'Ordinary history project',
        description: 'Public description',
        githubUrl: '',
        demoUrl: '',
      });
      return Response.json(
        await s.publish(target, d?.id, { expectedVersion: 1, confirmPublic: true }),
      );
    }
    let injected = false;
    const race = request.headers.get('X-Test-Race');
    const raceAccount = 'history-account-' + (request.headers.get('X-Test-Who') ?? '0');
    const db = race
      ? new Proxy(env.DB, {
          get(target, key) {
            if (key !== 'prepare') {
              const v = Reflect.get(target, key);
              return typeof v === 'function' ? v.bind(target) : v;
            }
            return (sql: string) => {
              if (
                !injected &&
                (sql.includes('INSERT INTO private_reading_history(') ||
                  sql.includes('WITH page AS MATERIALIZED') ||
                  sql.startsWith('DELETE FROM private_reading_history') ||
                  sql.includes('INSERT INTO private_reading_history_settings'))
              ) {
                injected = true;
                const wrap = (stmt: D1PreparedStatement): D1PreparedStatement =>
                  new Proxy(stmt, {
                    get(s, k) {
                      if (k === 'bind') return (...args: unknown[]) => wrap(s.bind(...args));
                      if (['first', 'all', 'run'].includes(String(k)))
                        return async (...args: unknown[]) => {
                          if (race === 'hide')
                            await target
                              .prepare(
                                "UPDATE content SET status='hidden' WHERE id='learning-notes'",
                              )
                              .run();
                          else if (race === 'context')
                            await target
                              .prepare(
                                'UPDATE auth_browser_contexts SET generation=generation+1 WHERE context_hash IN(SELECT context_hash FROM auth_sessions WHERE account_id=?)',
                              )
                              .bind(raceAccount)
                              .run();
                          else if (race === 'epoch')
                            await target
                              .prepare(
                                'UPDATE private_accounts SET session_epoch=session_epoch+1 WHERE id=?',
                              )
                              .bind(raceAccount)
                              .run();
                          else
                            await target
                              .prepare("UPDATE private_accounts SET status='suspended' WHERE id=?")
                              .bind(raceAccount)
                              .run();
                          return (Reflect.get(s, k) as (...args: unknown[]) => unknown).apply(
                            s,
                            args,
                          );
                        };
                      const v = Reflect.get(s, k);
                      return typeof v === 'function' ? v.bind(s) : v;
                    },
                  });
                return wrap(target.prepare(sql));
              }
              return target.prepare(sql);
            };
          },
        })
      : env.DB;
    if (request.headers.get('X-Test-Disabled') === 'true')
      return (
        (await createOrdinaryDraftHandler(db, origin, { enabled: false }, () => now)(request)) ??
        new Response('unmatched', { status: 418 })
      );
    return (
      (await createReadingHistoryHandler(db, origin, () => now)(request)) ??
      new Response('unmatched', { status: 418 })
    );
  },
};
