import { createFixtureSession } from '../helpers/coordinated-fixture';
import { OrdinaryDiscoveryStore } from '../../worker/ordinary-discovery';
import { createOrdinaryDiscoveryHandler } from '../../worker/ordinary-discovery-http';
import { ProjectStore } from '../../worker/projects';
import { ArticleLikeStore } from '../../worker/likes';
import { PublicProfileStore } from '../../worker/public-profile';
import { PrivateDraftStore } from '../../worker/drafts';
import { ArticlePublicationStore } from '../../worker/publication';
// Test-only fictional sessions and query failure/race controls; never production routes.
export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const origin = 'https://app.example.invalid';
    if (new URL(request.url).pathname.startsWith('/api/discovery'))
      return (await createOrdinaryDiscoveryHandler(env.DB, origin)(request))!;
    const i = (await request.json()) as {
      action: string;
      who?: string;
      headers?: Record<string, string>;
      input?: unknown;
      target?: unknown;
      draft?: string;
      fault?: boolean;
      hideAfterSelection?: boolean;
      source?: string;
      finalMutation?: {
        kind:
          | 'hide'
          | 'tags'
          | 'source-version'
          | 'title'
          | 'project-description'
          | 'profile-name'
          | 'unlike';
        target: string;
      };
    };
    const now = 1800000000000;
    if (i.action === 'session')
      return Response.json(
        await createFixtureSession(env.DB, origin, () => now, {
          provider: 'google',
          subject: 'subject-' + i.who,
          email: 'fictional@st.kobedenshi.ac.jp',
        }),
      );
    let mutationApplied = false;
    let rankingReads = 0;
    const mutate = async () => {
      const change = i.finalMutation;
      if (!change || mutationApplied || !/^[A-Za-z0-9_-]{1,128}$/.test(change.target)) return;
      if (change.kind === 'hide')
        await env.DB.prepare("UPDATE content SET status='hidden' WHERE id=?")
          .bind(change.target)
          .run();
      else if (change.kind === 'tags')
        await env.DB.prepare('UPDATE content SET tags_json=? WHERE id=?')
          .bind('["別のタグ"]', change.target)
          .run();
      else if (change.kind === 'source-version')
        await env.DB.prepare(
          'UPDATE article_publications SET source_version=source_version+1 WHERE content_id=?',
        )
          .bind(change.target)
          .run();
      else if (change.kind === 'title')
        await env.DB.prepare("UPDATE content SET title='変更後の公開題名' WHERE id=?")
          .bind(change.target)
          .run();
      else if (change.kind === 'project-description')
        await env.DB.prepare(
          "UPDATE project_publications SET description='変更後の別テーマ' WHERE id=?",
        )
          .bind(change.target)
          .run();
      else if (change.kind === 'profile-name')
        await env.DB.prepare("UPDATE public_profiles SET display_name='変更後の公開名' WHERE id=?")
          .bind(change.target)
          .run();
      else
        await env.DB.prepare(
          "DELETE FROM article_likes WHERE content_id=? AND owner_account_id='private-c'",
        )
          .bind(change.target)
          .run();
      mutationApplied = true;
    };
    const db =
      i.fault || i.hideAfterSelection || i.finalMutation
        ? new Proxy(env.DB, {
            get(target, key) {
              if (key !== 'prepare') {
                const value = Reflect.get(target, key);
                return typeof value === 'function' ? value.bind(target) : value;
              }
              return (sql: string) => {
                const wrap = (stmt: D1PreparedStatement): D1PreparedStatement =>
                  new Proxy(stmt, {
                    get(statement, property) {
                      if (property === 'bind')
                        return (...values: unknown[]) => wrap(statement.bind(...values));
                      if (property === 'all' || property === 'first')
                        return async (...args: unknown[]) => {
                          if (i.fault) throw new Error('synthetic storage failure');
                          // The fallback recognizes the old recent-only guard, so this regression
                          // also injects before the vulnerable final read on the previous implementation.
                          if (
                            sql.includes('WITH expected_articles AS MATERIALIZED') ||
                            sql.includes('WITH accepted_articles AS MATERIALIZED') ||
                            (rankingReads >= 2 &&
                              sql.startsWith('SELECT c.id ') &&
                              sql.includes('WHERE c.id IN'))
                          )
                            await mutate();
                          const result =
                            property === 'all'
                              ? await statement.all()
                              : typeof args[0] === 'string'
                                ? await statement.first(args[0])
                                : await statement.first();
                          if (sql.startsWith('WITH ranked_likes AS')) rankingReads++;
                          if (
                            property === 'all' &&
                            i.hideAfterSelection &&
                            sql.includes('ORDER BY c.id ASC') &&
                            (result as D1Result<{ id: string }>).results.length
                          ) {
                            const id = (result as D1Result<{ id: string }>).results[0].id;
                            await env.DB.prepare("UPDATE content SET status='hidden' WHERE id=?")
                              .bind(id)
                              .run();
                          }
                          return result;
                        };
                      const value = Reflect.get(statement, property);
                      return typeof value === 'function' ? value.bind(statement) : value;
                    },
                  });
                return wrap(target.prepare(sql));
              };
            },
          })
        : env.DB;
    const target = new Request(origin + '/fixture', { method: 'POST', headers: i.headers });
    const store = new ArticlePublicationStore(db, origin, () => now);
    const result =
      i.action === 'home'
        ? await new OrdinaryDiscoveryStore(db, origin, () => now).home()
        : i.action === 'related'
          ? await new OrdinaryDiscoveryStore(db, origin, () => now).related(String(i.target))
          : i.action === 'projectdraft'
            ? await new ProjectStore(db, origin, () => now).createDraft(target, i.input)
            : i.action === 'projectpublish'
              ? await new ProjectStore(db, origin, () => now).publish(target, i.draft, i.input)
              : i.action === 'like'
                ? await new ArticleLikeStore(db, origin, () => now).setOwn(
                    new Request(origin + '/fixture', { method: 'PUT', headers: i.headers }),
                    i.target,
                    i.input,
                  )
                : i.action === 'recent'
                  ? await store.readRecentPublished()
                  : i.action === 'author'
                    ? await store.readPublishedAuthor(i.target)
                    : i.action === 'read'
                      ? await store.readPublished(i.target)
                      : i.action === 'profile'
                        ? await new PublicProfileStore(db, origin, () => now).create(
                            target,
                            i.input,
                          )
                        : i.action === 'draft'
                          ? await new PrivateDraftStore(db, origin, () => now).create(
                              target,
                              i.input,
                            )
                          : await store.publish(target, i.draft, i.input);
    return Response.json(i.finalMutation ? { value: result, mutationApplied } : result);
  },
};
