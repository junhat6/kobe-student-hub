import { MediaStore, warmMediaCodec } from './media';
import { mediaId, MEDIA_MAX_BYTES } from '../src/shared/media';
const security = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};
const error = (status = 404) =>
  Response.json(
    { error: status === 401 ? 'authentication_required' : 'media_unavailable' },
    { status, headers: security },
  );
type Input = { bytes: Uint8Array<ArrayBuffer>; mime: string } | { status: number };
async function input(request: Request): Promise<Input> {
  const mime = request.headers.get('Content-Type');
  if (mime !== 'image/jpeg' && mime !== 'image/png') return { status: 415 };
  const encoding = request.headers.get('Content-Encoding');
  if (encoding !== null && encoding !== 'identity') return { status: 415 };
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))))
    return { status: 400 };
  if (length !== null && Number(length) > MEDIA_MAX_BYTES) {
    void request.body?.cancel().catch(() => {});
    return { status: 413 };
  }
  if (!request.body) return { status: 400 };
  const reader = request.body.getReader();
  let expired = false,
    timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  const read = (async (): Promise<Input> => {
    try {
      const bytes = new Uint8Array(MEDIA_MAX_BYTES);
      let size = 0,
        count = 0;
      for (;;) {
        const next = await reader.read();
        if (expired) return { status: 408 };
        if (next.done) break;
        if (++count > 4096 || size + next.value.byteLength > MEDIA_MAX_BYTES) {
          cancel();
          return { status: 413 };
        }
        bytes.set(next.value, size);
        size += next.value.byteLength;
      }
      if (!size || (length !== null && Number(length) !== size)) return { status: 400 };
      return { bytes: bytes.slice(0, size), mime };
    } catch {
      return { status: 400 };
    } finally {
      reader.releaseLock();
    }
  })();
  try {
    return await Promise.race([
      read,
      new Promise<Input>((resolve) => {
        timer = setTimeout(() => {
          expired = true;
          cancel();
          resolve({ status: 408 });
        }, 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
/** Mounted only by the existing ordinary participation source gate. No URL proxy or cookie fallback. */
export function createMediaHandler(db: D1Database, origin: string, clock: () => number = Date.now) {
  const store = new MediaStore(db, origin, clock);
  void warmMediaCodec();
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url),
      privatePath = url.pathname.startsWith('/api/private/media'),
      publicPath = url.pathname.startsWith('/api/media');
    if (!privatePath && !publicPath) return null;
    if (url.search || url.hash) return error();
    try {
      if (new URL(origin).origin !== origin || new URL(origin).protocol !== 'https:')
        return error(503);
    } catch {
      return error(503);
    }
    const suffix = url.pathname.slice(
      privatePath ? '/api/private/media'.length : '/api/media'.length,
    );
    const collection = /^\/(articles|projects)\/([0-9a-f-]+)$/.exec(suffix);
    const upload = /^\/(articles|projects)\/([0-9a-f-]+)\/([0-9a-f-]+)$/.exec(suffix);
    const single = suffix.startsWith('/') && mediaId(suffix.slice(1)) ? suffix.slice(1) : null;
    if ((!privatePath && !single) || (privatePath && !single && !collection && !upload))
      return error();
    if (
      (collection && !mediaId(collection[2])) ||
      (upload && (!mediaId(upload[2]) || !mediaId(upload[3])))
    )
      return error();
    const allowed = !privatePath ? 'GET' : upload ? 'PUT' : collection ? 'GET' : 'GET, DELETE';
    if (!allowed.split(', ').includes(request.method)) {
      const response = error(405);
      response.headers.set('Allow', allowed);
      return response;
    }
    try {
      if (!privatePath && single) {
        const value = await store.readPublic(single);
        return value
          ? new Response(value.bytes, {
              headers: {
                ...security,
                'Content-Type': value.receipt.mime,
                'Content-Length': String(value.bytes.length),
              },
            })
          : error();
      }
      if (upload) {
        const header = request.headers.get('If-Match'),
          version = header && /^"[1-9]\d{0,15}"$/.test(header) ? Number(header.slice(1, -1)) : NaN;
        const kind = upload[1] as 'articles' | 'projects';
        if (!(await store.authorizeUpload(request, kind, upload[2], version))) return error();
        const value = await input(request);
        if ('status' in value) return error(value.status);
        const result = await store.upload(
          request,
          kind,
          upload[2],
          upload[3],
          version,
          value.bytes,
          value.mime,
        );
        return result
          ? Response.json(result, { status: 201, headers: { ...security, Vary: 'Cookie' } })
          : error();
      }
      if (collection) {
        const result = await store.list(
          request,
          collection[1] as 'articles' | 'projects',
          collection[2],
        );
        return result
          ? Response.json({ images: result }, { headers: { ...security, Vary: 'Cookie' } })
          : error();
      }
      if (single && request.method === 'DELETE')
        return (await store.remove(request, single))
          ? Response.json({ deleted: true }, { headers: { ...security, Vary: 'Cookie' } })
          : error();
      if (single) {
        const value = await store.readOwn(request, single);
        return value
          ? new Response(value.bytes, {
              headers: {
                ...security,
                Vary: 'Cookie',
                'Content-Type': value.receipt.mime,
                'Content-Length': String(value.bytes.length),
              },
            })
          : error();
      }
      return error();
    } catch {
      return error();
    }
  };
}
