import { proofAuthorization } from '../shared/auth-proof';
import {
  mediaId,
  privateMediaPath,
  MEDIA_MAX_BYTES,
  MEDIA_MAX_EDGE,
  MEDIA_MAX_PIXELS,
  JPEG_MAX_PIXELS,
  PNG_HIGH_RES_BYTES,
  type MediaReceipt,
} from '../shared/media';
export class MediaClientError extends Error {
  constructor() {
    super('画像の状態を確認できませんでした。');
  }
}
function receipt(v: unknown): v is MediaReceipt {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).sort().join(',') !== 'bytes,height,id,mime,width'
  )
    return false;
  const r = v as MediaReceipt;
  return (
    mediaId(r.id) &&
    (r.mime === 'image/png' || r.mime === 'image/jpeg') &&
    Number.isInteger(r.width) &&
    r.width > 0 &&
    r.width <= MEDIA_MAX_EDGE &&
    Number.isInteger(r.height) &&
    r.height > 0 &&
    r.height <= MEDIA_MAX_EDGE &&
    r.width * r.height <= (r.mime === 'image/jpeg' ? JPEG_MAX_PIXELS : MEDIA_MAX_PIXELS) &&
    Number.isInteger(r.bytes) &&
    r.bytes > 0 &&
    r.bytes <= MEDIA_MAX_BYTES &&
    (r.mime !== 'image/png' ||
      r.width * r.height <= JPEG_MAX_PIXELS ||
      r.bytes <= PNG_HIGH_RES_BYTES)
  );
}
async function bounded(response: Response, limit: number, signal?: AbortSignal) {
  const length = response.headers.get('Content-Length');
  if (
    !response.body ||
    (length !== null &&
      (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > limit))
  ) {
    void response.body?.cancel().catch(() => {});
    throw new MediaClientError();
  }
  const reader = response.body.getReader(),
    bytes = new Uint8Array(limit);
  let size = 0,
    count = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (signal?.aborted) throw new MediaClientError();
      if (next.done) break;
      if (++count > 8192 || size + next.value.length > limit) throw new MediaClientError();
      bytes.set(next.value, size);
      size += next.value.length;
    }
    if (length !== null && Number(length) !== size) throw new MediaClientError();
    return bytes.slice(0, size);
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function createMediaClient(csrfToken: string, fetcher: typeof fetch = fetch) {
  async function request(
    path: string,
    init: RequestInit,
    limit: number,
    expected: number,
    signal?: AbortSignal,
  ) {
    const controller = new AbortController(),
      abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, 8000);
    try {
      const r = await fetcher(path, {
        ...init,
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
      if (r.status !== expected) {
        void r.body?.cancel().catch(() => {});
        throw new MediaClientError();
      }
      const bytes = await bounded(r, limit, controller.signal);
      if (controller.signal.aborted) throw new MediaClientError();
      return { bytes, type: r.headers.get('Content-Type') };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
  const json = (bytes: Uint8Array) =>
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  return {
    async read(id: string, signal?: AbortSignal): Promise<Blob> {
      if (!mediaId(id)) throw new MediaClientError();
      const r = await request(
        privateMediaPath(id),
        { headers: { Accept: 'image/png, image/jpeg' } },
        MEDIA_MAX_BYTES,
        200,
        signal,
      );
      if (!r.bytes.length || (r.type !== 'image/png' && r.type !== 'image/jpeg'))
        throw new MediaClientError();
      return new Blob([r.bytes], { type: r.type });
    },
    async list(
      kind: 'articles' | 'projects',
      draftId: string,
      signal?: AbortSignal,
    ): Promise<MediaReceipt[]> {
      if (!mediaId(draftId)) throw new MediaClientError();
      const r = await request(
          `/api/private/media/${kind}/${draftId}`,
          { headers: { Accept: 'application/json' } },
          4096,
          200,
          signal,
        ),
        v = json(r.bytes);
      if (
        !r.type?.startsWith('application/json') ||
        !v ||
        typeof v !== 'object' ||
        Object.keys(v).join(',') !== 'images'
      )
        throw new MediaClientError();
      const images = (v as { images: unknown }).images;
      if (
        !Array.isArray(images) ||
        images.length > 8 ||
        !images.every(receipt) ||
        new Set(images.map((i) => i.id)).size !== images.length
      )
        throw new MediaClientError();
      return images;
    },
    async upload(
      kind: 'articles' | 'projects',
      draftId: string,
      version: number,
      id: string,
      blob: Blob,
      signal?: AbortSignal,
    ): Promise<MediaReceipt> {
      if (
        !mediaId(draftId) ||
        !mediaId(id) ||
        !Number.isSafeInteger(version) ||
        version < 1 ||
        blob.size < 1 ||
        blob.size > MEDIA_MAX_BYTES ||
        !['image/png', 'image/jpeg'].includes(blob.type)
      )
        throw new MediaClientError();
      const r = await request(
          `/api/private/media/${kind}/${draftId}/${id}`,
          {
            method: 'PUT',
            headers: {
              Accept: 'application/json',
              'Content-Type': blob.type,
              'If-Match': `"${version}"`,
              Authorization: proofAuthorization('csrf', csrfToken),
            },
            body: blob,
          },
          1024,
          201,
          signal,
        ),
        v = json(r.bytes);
      if (
        !r.type?.startsWith('application/json') ||
        !receipt(v) ||
        v.id !== id ||
        v.mime !== blob.type
      )
        throw new MediaClientError();
      return v;
    },
    async remove(id: string, signal?: AbortSignal) {
      if (!mediaId(id)) throw new MediaClientError();
      const r = await request(
          privateMediaPath(id),
          { method: 'DELETE', headers: { Authorization: proofAuthorization('csrf', csrfToken) } },
          128,
          200,
          signal,
        ),
        v = json(r.bytes);
      if (
        !v ||
        typeof v !== 'object' ||
        Object.keys(v).join(',') !== 'deleted' ||
        (v as { deleted: unknown }).deleted !== true
      )
        throw new MediaClientError();
    },
  };
}
/** Native decode/resize strips metadata; the server independently bounds and decodes every output pixel. */
export async function prepareImage(file: File): Promise<Blob> {
  if (
    !['image/png', 'image/jpeg'].includes(file.type) ||
    file.size < 1 ||
    file.size > 12 * 1024 * 1024
  )
    throw new Error('JPEG・PNGの画像（12 MiB以内）を選んでください。');
  // Inspect bounded dimensions before asking the browser to allocate a camera-size bitmap.
  const header = new Uint8Array(await file.slice(0, 262144).arrayBuffer()),
    view = new DataView(header.buffer);
  let width = 0,
    height = 0;
  if (
    file.type === 'image/png' &&
    header.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => header[i] === b)
  ) {
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (file.type === 'image/jpeg' && header[0] === 255 && header[1] === 216) {
    let offset = 2,
      count = 0;
    while (offset + 9 < header.length && ++count <= 256) {
      if (header[offset] !== 255) break;
      const marker = header[offset + 1],
        length = view.getUint16(offset + 2);
      if (length < 2 || offset + 2 + length > header.length) break;
      if ([192, 193, 194].includes(marker)) {
        height = view.getUint16(offset + 5);
        width = view.getUint16(offset + 7);
        break;
      }
      offset += length + 2;
    }
  }
  if (!width || !height || width * height > 16000000 || width > 16384 || height > 16384)
    throw new Error('元画像はJPEG・PNGの1600万画素以内にしてください。');
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    if (
      !image.width ||
      !image.height ||
      image.width * image.height > 16000000 ||
      image.width > 16384 ||
      image.height > 16384
    )
      throw new Error('元画像は1600万画素以内にしてください。');
    const pixels = file.type === 'image/jpeg' ? JPEG_MAX_PIXELS : MEDIA_MAX_PIXELS;
    let scale = Math.min(
      1,
      MEDIA_MAX_EDGE / image.width,
      MEDIA_MAX_EDGE / image.height,
      Math.sqrt(pixels / (image.width * image.height)),
    );
    for (let attempt = 0; attempt < 5; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(image.width * scale));
      canvas.height = Math.max(1, Math.floor(image.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('画像の準備ができませんでした。');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, file.type, 0.82),
      );
      canvas.width = 0;
      canvas.height = 0;
      if (
        blob &&
        blob.size > 0 &&
        blob.size <= MEDIA_MAX_BYTES &&
        (file.type !== 'image/png' ||
          Math.floor(image.width * scale) * Math.floor(image.height * scale) <= JPEG_MAX_PIXELS ||
          blob.size <= PNG_HIGH_RES_BYTES)
      )
        return blob;
      scale *= 0.75;
    }
    throw new Error('画像を512 KiB以内にできませんでした。画像を小さくして選び直してください。');
  } finally {
    image.close();
  }
}
