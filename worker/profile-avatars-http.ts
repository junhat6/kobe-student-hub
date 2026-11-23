import { SessionStore } from './auth/sessions';
import { ProfileAvatarStore } from './profile-avatars';
import { warmMediaCodec } from './media';
import {
  AVATAR_MAX_BYTES,
  PUBLIC_AVATAR_BATCH_MAX,
  PUBLIC_AVATAR_BATCH_PATH,
} from '../src/shared/avatar';
// Same response posture as /api/media: never cached, never sniffed, never framed or scripted.
const security = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};
const error = (status = 404) =>
  Response.json(
    { error: status === 401 ? 'authentication_required' : 'avatar_unavailable' },
    { status, headers: security },
  );
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { ...security, Vary: 'Cookie' } });
type Input = { bytes: Uint8Array<ArrayBuffer>; mime: string } | { status: number };
async function input(request: Request): Promise<Input> {
  const mime = request.headers.get('Content-Type');
  if (mime !== 'image/jpeg' && mime !== 'image/png') return { status: 415 };
  const encoding = request.headers.get('Content-Encoding');
  if (encoding !== null && encoding !== 'identity') return { status: 415 };
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))))
    return { status: 400 };
  if (length !== null && Number(length) > AVATAR_MAX_BYTES) {
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
      const bytes = new Uint8Array(AVATAR_MAX_BYTES);
      let size = 0,
        count = 0;
      for (;;) {
        const next = await reader.read();
        if (expired) return { status: 408 };
        if (next.done) break;
        if (++count > 4096 || size + next.value.byteLength > AVATAR_MAX_BYTES) {
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
const ownImage = /^\/api\/private\/profile-avatar\/([0-9a-f]{16})$/;
const publicImage = /^\/api\/profile-avatars\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/([0-9a-f]{16})$/;
/** Profile icon routes. Mounted only through the ordinary-authoring release gate. */
export function createProfileAvatarHandler(
  db: D1Database,
  origin: string,
  clock: () => number = Date.now,
) {
  const sessions = new SessionStore(db, origin, clock),
    store = new ProfileAvatarStore(db, origin, clock);
  void warmMediaCodec();
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url),
      own = url.pathname === '/api/private/profile-avatar',
      ownMatch = ownImage.exec(url.pathname),
      publicMatch = publicImage.exec(url.pathname);
    if (
      !own &&
      !url.pathname.startsWith('/api/private/profile-avatar/') &&
      !url.pathname.startsWith('/api/profile-avatars')
    )
      return null;
    try {
      if (new URL(origin).origin !== origin || new URL(origin).protocol !== 'https:')
        return error(503);
    } catch {
      return error(503);
    }
    if (url.pathname === PUBLIC_AVATAR_BATCH_PATH) {
      if (request.method !== 'GET') {
        const response = error(405);
        response.headers.set('Allow', 'GET');
        return response;
      }
      // Exactly one `ids` parameter: a comma-separated list of distinct public profile ids.
      const keys = [...url.searchParams.keys()];
      const raw = url.searchParams.get('ids');
      if (url.hash || keys.length !== 1 || keys[0] !== 'ids' || raw === null || raw.length > 6400)
        return error();
      const ids = raw.split(',');
      if (ids.length > PUBLIC_AVATAR_BATCH_MAX) return error();
      try {
        const avatars = await store.readPublicPaths(ids);
        return avatars ? json({ avatars }) : error();
      } catch {
        return error();
      }
    }
    if (url.search || url.hash || (!own && !ownMatch && !publicMatch)) return error();
    const allowed = own ? 'GET, PUT, DELETE' : 'GET';
    if (!allowed.split(', ').includes(request.method)) {
      const response = error(405);
      response.headers.set('Allow', allowed);
      return response;
    }
    const image = (value: { mime: string; bytes: Uint8Array<ArrayBuffer> } | null, vary = false) =>
      value
        ? new Response(value.bytes, {
            headers: {
              ...security,
              ...(vary ? { Vary: 'Cookie' } : {}),
              'Content-Type': value.mime,
              'Content-Length': String(value.bytes.length),
            },
          })
        : error();
    try {
      if (publicMatch) return image(await store.readPublic(publicMatch[1], publicMatch[2]));
      const auth =
        request.method === 'GET'
          ? await sessions.authenticate(request)
          : await sessions.authorizeMutation(request);
      if (!auth) return error(401);
      if (ownMatch) return image(await store.readOwn(request, ownMatch[1]), true);
      if (request.method === 'GET') {
        const value = await store.own(request);
        return value ? json(value) : error();
      }
      if (request.method === 'DELETE')
        return (await store.remove(request)) ? json({ avatar: null }) : error();
      if (!(await store.authorizeUpload(request))) return error();
      const body = await input(request);
      if ('status' in body) return error(body.status);
      const result = await store.replace(request, body.bytes, body.mime);
      return result ? json(result, 201) : error(422);
    } catch {
      return error();
    }
  };
}
