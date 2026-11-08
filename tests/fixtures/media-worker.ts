import { normalizeMedia } from '../../worker/media-codec';
import { createOrdinaryDraftHandler } from '../../worker/ordinary-drafts-http';
import { createFixtureSession } from '../helpers/coordinated-fixture';
import { ArticlePublicationStore } from '../../worker/publication';
import { ProjectStore } from '../../worker/projects';
import { PrivateDraftStore } from '../../worker/drafts';
import { ArticleModerationStore } from '../../worker/moderation';
import { PublicationStopStore } from '../../worker/publication-stops';
export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const origin = 'https://app.example.invalid',
      url = new URL(request.url),
      now = Number(request.headers.get('X-Test-Now') ?? 1800000000000);
    if (url.pathname === '/fixture/codec') {
      const result = await normalizeMedia(
        new Uint8Array(await request.arrayBuffer()),
        request.headers.get('Content-Type') ?? '',
      );
      return result
        ? new Response(result.bytes, {
            headers: {
              'Content-Type': result.mime,
              'X-Fixture-Width': String(result.width),
              'X-Fixture-Height': String(result.height),
            },
          })
        : new Response('unavailable', { status: 415 });
    }
    if (url.pathname === '/fixture/session')
      return Response.json(
        await createFixtureSession(env.DB, origin, () => now, {
          provider: 'google',
          subject: 'subject-' + request.headers.get('X-Test-Who'),
          email: 'fixture@st.kobedenshi.ac.jp',
        }),
      );
    if (url.pathname === '/fixture/draft')
      return Response.json(
        await new PrivateDraftStore(env.DB, origin, () => now).create(
          request,
          await request.json(),
        ),
      );
    if (url.pathname === '/fixture/article-publish') {
      const v = (await request.json()) as { id: string; input: unknown };
      return Response.json(
        await new ArticlePublicationStore(env.DB, origin, () => now).publish(
          request,
          v.id,
          v.input,
        ),
      );
    }
    if (url.pathname === '/fixture/project-draft')
      return Response.json(
        await new ProjectStore(env.DB, origin, () => now).createDraft(
          request,
          await request.json(),
        ),
      );
    if (url.pathname === '/fixture/project-publish') {
      const v = (await request.json()) as { id: string; input: unknown };
      return Response.json(
        await new ProjectStore(env.DB, origin, () => now).publish(request, v.id, v.input),
      );
    }
    if (url.pathname === '/fixture/report') {
      const v = (await request.json()) as { id: string; input: unknown };
      return Response.json(
        await new ArticleModerationStore(env.DB, origin, [], () => now).report(
          request,
          v.id,
          v.input,
        ),
      );
    }
    if (url.pathname === '/fixture/stop') {
      const v = (await request.json()) as {
        kind: 'article' | 'project';
        id: string;
        input: unknown;
      };
      return Response.json(
        await new PublicationStopStore(env.DB, origin, () => now).stop(
          request,
          v.kind,
          v.id,
          v.input,
        ),
      );
    }
    let count = 0;
    const db = new Proxy(env.DB, {
      get(target, key) {
        if (key === 'prepare')
          return (sql: string) => {
            count++;
            if (sql.startsWith('INSERT INTO media_assets') && request.headers.has('X-Test-Race')) {
              const statement = target.prepare(sql);
              return new Proxy(statement, {
                get(s, k) {
                  if (k === 'bind')
                    return (...values: unknown[]) => {
                      const bound = s.bind(...values);
                      return {
                        run: async () => {
                          await target
                            .prepare(
                              "UPDATE private_accounts SET status='suspended' WHERE id='account-0'",
                            )
                            .run();
                          return bound.run();
                        },
                      };
                    };
                  const v = Reflect.get(s, k);
                  return typeof v === 'function' ? v.bind(s) : v;
                },
              });
            }
            return target.prepare(sql);
          };
        const v = Reflect.get(target, key);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const target = request.headers.has('X-Test-Transport')
      ? new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: await request.arrayBuffer(),
        })
      : request;
    const result = await createOrdinaryDraftHandler(
      db,
      origin,
      { enabled: !request.headers.has('X-Test-Closed') },
      () => now,
    )(target);
    if (result) {
      result.headers.set('X-Fixture-Queries', String(count));
      return result;
    }
    return Response.json({ unhandled: true, queries: count }, { status: 404 });
  },
};
