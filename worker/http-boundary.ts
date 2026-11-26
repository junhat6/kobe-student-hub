// The one copy of the request-boundary checks shared by the private JSON APIs (#283).
// Before this module each `*-http.ts` carried its own copy, so a fix in one (Content-Type,
// Origin normalisation, chunk bound) silently missed the others — the #240 shape.
// The binary upload reader (`readBoundedImage`, shared by media and profile avatars since #295)
// is separate from `readBoundedJson`: it takes image bytes, not JSON, and has its own type rules.

/** True only for an `https:` origin already in canonical form (no path, default port elided). */
export function canonicalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.origin === origin;
  } catch {
    return false;
  }
}

export type BoundedJsonBody = { ok: true; value: unknown } | { ok: false; status: number };

export type BodyLimits = {
  /** Content byte limit of the JSON text. */
  bytes: number;
  /** Transport work bound, including zero-byte chunks; distinct from the content byte limit. */
  chunks: number;
  /** Whole-read deadline; a slow body answers 408. */
  timeoutMs?: number;
};

const JSON_TYPE = /^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i;

/**
 * Reads a JSON request body within explicit bounds.
 * 415: not `application/json` (utf-8 only) or a non-identity Content-Encoding.
 * 400: malformed or mismatched Content-Length, missing body, invalid UTF-8 or JSON.
 * 413: declared or actual size over `bytes`, or more than `chunks` chunks.
 * 408: the read did not finish within `timeoutMs`.
 */
export async function readBoundedJson(
  request: Request,
  limits: BodyLimits,
): Promise<BoundedJsonBody> {
  const { bytes: limit, chunks: maxChunks, timeoutMs = 5000 } = limits;
  const type = request.headers.get('Content-Type');
  if (!type || !JSON_TYPE.test(type)) return { ok: false, status: 415 };
  const encoding = request.headers.get('Content-Encoding');
  if (encoding !== null && encoding.toLowerCase() !== 'identity') return { ok: false, status: 415 };
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))))
    return { ok: false, status: 400 };
  if (length !== null && Number(length) > limit) {
    void request.body?.cancel().catch(() => {});
    return { ok: false, status: 413 };
  }
  if (!request.body) return { ok: false, status: 400 };
  const reader = request.body.getReader();
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  const read = (async (): Promise<BoundedJsonBody> => {
    try {
      const bytes = new Uint8Array(limit);
      let size = 0;
      let count = 0;
      for (;;) {
        const chunk = await reader.read();
        if (expired) return { ok: false, status: 408 };
        if (chunk.done) break;
        if (++count > maxChunks) {
          cancel();
          return { ok: false, status: 413 };
        }
        if (chunk.value.byteLength === 0) continue;
        const next = size + chunk.value.byteLength;
        if (next > limit) {
          cancel();
          return { ok: false, status: 413 };
        }
        bytes.set(chunk.value, size);
        size = next;
      }
      if (length !== null && Number(length) !== size) return { ok: false, status: 400 };
      return {
        ok: true,
        value: JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)),
        ),
      };
    } catch {
      return { ok: false, status: 400 };
    } finally {
      reader.releaseLock();
    }
  })();
  const deadline = new Promise<BoundedJsonBody>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      cancel();
      resolve({ ok: false, status: 408 });
    }, timeoutMs);
  });
  try {
    return await Promise.race([read, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export type BoundedImageBody =
  { bytes: Uint8Array<ArrayBuffer>; mime: 'image/jpeg' | 'image/png' } | { status: number };

/** Transport work bound of an image upload, including zero-byte chunks. */
export const IMAGE_BODY_MAX_CHUNKS = 4096;
/** Whole-read deadline of an image upload; a slow body answers 408. */
const IMAGE_BODY_TIMEOUT_MS = 5000;

/**
 * Reads an image upload body (the one copy for /api/private/media and the profile icon, #295).
 * 415: not exactly `image/jpeg`/`image/png`, or a Content-Encoding other than `identity`.
 * 400: malformed or mismatched Content-Length, missing or empty body, a failed read.
 * 413: declared or actual size over `maxBytes`, or more than 4096 chunks.
 * 408: the read did not finish within 5 seconds.
 * The bytes are not decoded here; the stores check the image itself.
 */
export async function readBoundedImage(
  request: Request,
  maxBytes: number,
): Promise<BoundedImageBody> {
  const mime = request.headers.get('Content-Type');
  if (mime !== 'image/jpeg' && mime !== 'image/png') return { status: 415 };
  const encoding = request.headers.get('Content-Encoding');
  if (encoding !== null && encoding !== 'identity') return { status: 415 };
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))))
    return { status: 400 };
  if (length !== null && Number(length) > maxBytes) {
    void request.body?.cancel().catch(() => {});
    return { status: 413 };
  }
  if (!request.body) return { status: 400 };
  const reader = request.body.getReader();
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  const read = (async (): Promise<BoundedImageBody> => {
    try {
      const bytes = new Uint8Array(maxBytes);
      let size = 0;
      let count = 0;
      for (;;) {
        const next = await reader.read();
        if (expired) return { status: 408 };
        if (next.done) break;
        if (++count > IMAGE_BODY_MAX_CHUNKS || size + next.value.byteLength > maxBytes) {
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
  const deadline = new Promise<BoundedImageBody>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      cancel();
      resolve({ status: 408 });
    }, IMAGE_BODY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([read, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
