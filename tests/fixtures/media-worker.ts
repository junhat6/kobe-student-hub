import { normalizeMedia } from '../../worker/media-codec';
import { createOrdinaryDraftHandler } from '../../worker/ordinary-drafts-http';
import { createFixtureSession } from '../helpers/coordinated-fixture';
import { ArticlePublicationStore } from '../../worker/publication';
import { ProjectStore } from '../../worker/projects';
import { PrivateDraftStore } from '../../worker/drafts';
import { ArticleModerationStore } from '../../worker/moderation';
import { PublicationStopStore } from '../../worker/publication-stops';
import {
  auditMediaObjects,
  auditMediaObjectsIfDue,
  maintainMediaObjects,
} from '../../worker/media-objects';

// Read-only views for the audit (#249): any write throws, so a passing audit proves it wrote nothing.
const readOnlyDb = (db: D1Database): D1Database =>
  ({
    prepare(sql: string) {
      if (!/^\s*SELECT\b/i.test(sql) || /\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql))
        throw Error('write refused: ' + sql.split(' ')[0]);
      return db.prepare(sql);
    },
    batch() {
      throw Error('write refused: batch');
    },
    exec() {
      throw Error('write refused: exec');
    },
  }) as unknown as D1Database;
const readOnlyBucket = (bucket: R2Bucket): R2Bucket =>
  ({
    head: (key: string) => bucket.head(key),
    get: (key: string) => bucket.get(key),
    put() {
      throw Error('write refused: put');
    },
    delete() {
      throw Error('write refused: delete');
    },
    createMultipartUpload() {
      throw Error('write refused: multipart');
    },
  }) as unknown as R2Bucket;
type Env = { DB: D1Database; MEDIA_BUCKET?: R2Bucket };
const fixture = {
  async fetch(request: Request, env: Env): Promise<Response> {
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
    if (url.pathname === '/fixture/maintain')
      return Response.json(
        await maintainMediaObjects(
          env.DB,
          env.MEDIA_BUCKET,
          () => now,
          request.headers.get('X-Test-Start') ?? undefined,
        ),
      );
    if (url.pathname === '/fixture/audit')
      return Response.json(
        await auditMediaObjects(
          readOnlyDb(env.DB),
          request.headers.has('X-Test-R2-Fail')
            ? ({
                head() {
                  throw Error('r2 unavailable');
                },
              } as unknown as R2Bucket)
            : readOnlyBucket(env.MEDIA_BUCKET!),
        ).catch((e: unknown) => ({ error: String(e) })),
      );
    if (url.pathname === '/fixture/audit-guards') {
      const refused = async (f: () => unknown) => {
        try {
          await f();
          return false;
        } catch {
          return true;
        }
      };
      const db = readOnlyDb(env.DB),
        bucket = readOnlyBucket(env.MEDIA_BUCKET!);
      return Response.json([
        await refused(() => db.prepare('UPDATE media_assets SET object_stored_at_ms=0')),
        await refused(() => db.prepare('DELETE FROM media_assets')),
        await refused(() => bucket.put('media/x', new Uint8Array([1]))),
        await refused(() => bucket.delete('media/x')),
      ]);
    }
    if (url.pathname === '/fixture/audit-if-due')
      return Response.json(await auditMediaObjectsIfDue(env.DB, env.MEDIA_BUCKET, () => now));
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
    // Same-id overlap (#12 low 1): while this upload sits between its R2 put and its D1 insert, a
    // second upload of the same id and bytes runs to the end and fails at its own insert.
    const overlap = request.headers.has('X-Test-Overlap')
      ? await request.clone().arrayBuffer()
      : null;
    const db = new Proxy(env.DB, {
      get(target, key) {
        if (key === 'prepare')
          return (sql: string) => {
            count++;
            if (
              sql.startsWith('INSERT INTO media_assets') &&
              request.headers.has('X-Test-Insert-Fail')
            )
              throw Error('fixture d1 failure');
            if (sql.startsWith('INSERT INTO media_assets') && overlap) {
              const statement = target.prepare(sql);
              return {
                bind: (...values: unknown[]) => {
                  const bound = statement.bind(...values);
                  return {
                    run: async () => {
                      const headers = new Headers(request.headers);
                      headers.delete('X-Test-Overlap');
                      headers.set('X-Test-Insert-Fail', '1');
                      const failed = await fixture.fetch(
                        new Request(request.url, {
                          method: request.method,
                          headers,
                          body: overlap,
                        }),
                        env,
                      );
                      if (failed.status !== 404) throw Error('overlapping upload did not fail');
                      return bound.run();
                    },
                  };
                },
              };
            }
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
    // R2 failure injection: the put is refused after nothing was stored.
    const bucket =
      env.MEDIA_BUCKET && request.headers.has('X-Test-R2-Fail')
        ? new Proxy(env.MEDIA_BUCKET, {
            get(target, key) {
              if (key === 'put')
                return request.headers.get('X-Test-R2-Fail') === 'size'
                  ? // R2 stores the object but reports another size than the normalized bytes.
                    async (...args: Parameters<R2Bucket['put']>) => {
                      const stored = await target.put(...args);
                      return stored && { ...stored, size: stored.size + 1 };
                    }
                  : async () => Promise.reject(Error('fixture r2 failure'));
              const v = Reflect.get(target, key);
              return typeof v === 'function' ? v.bind(target) : v;
            },
          })
        : env.MEDIA_BUCKET;
    const result = await createOrdinaryDraftHandler(
      db,
      origin,
      {
        enabled: !request.headers.has('X-Test-Closed'),
        // The Worker before the #12 contract kept every image in D1; without a bucket this one does too.
        mediaBucket: request.headers.has('X-Test-Previous-Worker') ? undefined : bucket,
      },
      () => now,
    )(target);
    if (result) {
      result.headers.set('X-Fixture-Queries', String(count));
      return result;
    }
    return Response.json({ unhandled: true, queries: count }, { status: 404 });
  },
};
export default fixture;
