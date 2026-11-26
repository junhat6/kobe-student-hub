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
// Fault injection for the erase UPDATE of #12, run just before it: another run erased the row
// first, the payload was swapped for other bytes (triggers set aside, as no app path can), or the
// first erase throws. The others pass through.
const ERASE = 'UPDATE media_assets SET payload=NULL';
const eraseFaultDb = (db: D1Database, fault: string): D1Database => {
  let calls = 0;
  return new Proxy(db, {
    get(target, prop) {
      if (prop !== 'prepare') return Reflect.get(target, prop);
      return (sql: string) => {
        const statement = target.prepare(sql);
        if (!sql.startsWith(ERASE)) return statement;
        return {
          bind: (...args: unknown[]) => ({
            async run() {
              const image = args[0] as string;
              if (fault === 'throw-first' && calls++ === 0) throw Error('injected erase failure');
              if (fault === 'erased')
                await target
                  .prepare(ERASE + ' WHERE id=?')
                  .bind(image)
                  .run();
              if (fault === 'swap') {
                const trigger = (await target
                  .prepare(
                    "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='media_assets_content_immutable'",
                  )
                  .first<{ sql: string }>())!.sql;
                await target.batch([
                  target.prepare('DROP TRIGGER media_assets_content_immutable'),
                  target
                    .prepare(
                      'UPDATE media_assets SET payload=CAST(zeroblob(length(payload)) AS BLOB) WHERE id=?',
                    )
                    .bind(image),
                  target.prepare(trigger),
                ]);
              }
              return statement.bind(...args).run();
            },
          }),
        };
      };
    },
  }) as D1Database;
};
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
          request.headers.has('X-Test-Erase-Fault')
            ? eraseFaultDb(env.DB, request.headers.get('X-Test-Erase-Fault')!)
            : env.DB,
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
    // Same-id overlap (#12): while this upload sits between its R2 put and its D1 insert, a second
    // upload of the same id runs to the end: with the same bytes it fails at its own insert, with
    // 'other' bytes it wins the insert.
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
                      // 'other': the second upload carries other bytes and wins the insert instead.
                      const other = request.headers.get('X-Test-Overlap') === 'other';
                      if (other) {
                        headers.set('Content-Type', request.headers.get('X-Test-Other-Type')!);
                        headers.delete('Content-Length');
                      } else headers.set('X-Test-Insert-Fail', '1');
                      const second = await fixture.fetch(
                        new Request(request.url, {
                          method: request.method,
                          headers,
                          body: other
                            ? Uint8Array.from(
                                atob(request.headers.get('X-Test-Other-Body')!),
                                (c) => c.charCodeAt(0),
                              )
                            : overlap,
                        }),
                        env,
                      );
                      if (second.status !== (other ? 201 : 404))
                        throw Error('overlapping upload ended unexpectedly');
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
