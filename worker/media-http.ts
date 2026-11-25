import { readBoundedImage } from './http-boundary';
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
/** Mounted only by the existing ordinary participation source gate. No URL proxy or cookie fallback. */
export function createMediaHandler(
  db: D1Database,
  origin: string,
  clock: () => number = Date.now,
  bucket?: R2Bucket,
) {
  const store = new MediaStore(db, origin, clock, bucket);
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
        const value = await readBoundedImage(request, MEDIA_MAX_BYTES);
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
        if (typeof result === 'string')
          // Only the authorized owner reaches this: the draft and session were checked first.
          return Response.json(
            { error: 'media_limit', limit: result },
            { status: 409, headers: { ...security, Vary: 'Cookie' } },
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
