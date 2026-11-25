import { readBoundedBytes, readBoundedJson, readBoundedJsonResponse } from '../shared/http-client';
import {
  mediaId,
  privateMediaPath,
  MEDIA_MAX_BYTES,
  MEDIA_MAX_EDGE,
  MEDIA_MAX_PIXELS,
  JPEG_MAX_PIXELS,
  PNG_HIGH_RES_BYTES,
  MEDIA_PER_DRAFT,
  MEDIA_LIMIT_MESSAGE,
  mediaLimit,
  type MediaLimit,
  type MediaReceipt,
} from '../shared/media';
export class MediaClientError extends Error {
  constructor() {
    super('画像の状態を確認できませんでした。');
  }
}
/** The server definitively refused the upload because a storage limit was reached; nothing was saved. */
export class MediaLimitError extends Error {
  constructor(readonly limit: MediaLimit) {
    super(MEDIA_LIMIT_MESSAGE[limit]);
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
/** Image bytes are not JSON, but take the same bounded transport (no-store, no redirect, caps, deadline). */
const IMAGE_TYPES = ['image/png', 'image/jpeg'] as const;
const LIST_MAX_BYTES = 4096,
  RECEIPT_MAX_BYTES = 1024,
  REMOVE_MAX_BYTES = 128,
  MAX_CHUNKS = 8192;
const exact = (v: unknown, fields: string): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === fields;
export function createMediaClient(csrfToken: string, fetcher: typeof fetch = fetch) {
  const common = {
    fetcher,
    credentials: 'same-origin',
    maxChunks: MAX_CHUNKS,
    exactLength: true,
  } as const;
  /** Every transport failure becomes the one opaque MediaClientError; no request is resent. */
  async function guarded<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch {
      throw new MediaClientError();
    }
  }
  return {
    async read(id: string, signal?: AbortSignal): Promise<Blob> {
      if (!mediaId(id)) throw new MediaClientError();
      const r = await guarded(() =>
        readBoundedBytes(privateMediaPath(id), {
          ...common,
          types: IMAGE_TYPES,
          maxBytes: MEDIA_MAX_BYTES,
          ...(signal ? { signal } : {}),
        }),
      );
      if (!r.bytes.length) throw new MediaClientError();
      return new Blob([r.bytes], { type: r.type });
    },
    async list(
      kind: 'articles' | 'projects',
      draftId: string,
      signal?: AbortSignal,
    ): Promise<MediaReceipt[]> {
      if (!mediaId(draftId)) throw new MediaClientError();
      const v = await guarded(() =>
        readBoundedJson(`/api/private/media/${kind}/${draftId}`, {
          ...common,
          maxBytes: LIST_MAX_BYTES,
          ...(signal ? { signal } : {}),
        }),
      );
      if (!exact(v, 'images')) throw new MediaClientError();
      const images = v.images;
      if (
        !Array.isArray(images) ||
        images.length > MEDIA_PER_DRAFT ||
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
      // 201 is the receipt; 409 is a definite refusal that names the reached limit (nothing saved).
      const r = await guarded(() =>
        readBoundedJsonResponse(`/api/private/media/${kind}/${draftId}/${id}`, {
          ...common,
          method: 'PUT',
          body: blob,
          csrf: csrfToken,
          ifMatch: version,
          statuses: [201, 409],
          maxBytes: RECEIPT_MAX_BYTES,
          ...(signal ? { signal } : {}),
        }),
      );
      const v = r.value;
      if (r.status === 409) {
        if (exact(v, 'error,limit') && v.error === 'media_limit' && mediaLimit(v.limit))
          throw new MediaLimitError(v.limit);
        throw new MediaClientError();
      }
      if (!receipt(v) || v.id !== id || v.mime !== blob.type) throw new MediaClientError();
      return v;
    },
    async remove(id: string, signal?: AbortSignal) {
      if (!mediaId(id)) throw new MediaClientError();
      const v = await guarded(() =>
        readBoundedJson(privateMediaPath(id), {
          ...common,
          method: 'DELETE',
          csrf: csrfToken,
          maxBytes: REMOVE_MAX_BYTES,
          ...(signal ? { signal } : {}),
        }),
      );
      if (!exact(v, 'deleted') || v.deleted !== true) throw new MediaClientError();
    },
  };
}
const MEDIA_SOURCE_MAX_BYTES = 12 * 1024 * 1024;
/** Bounded source checks shared by article images and profile icons; returns a decoded bitmap. */
export async function openImageSource(file: File): Promise<ImageBitmap> {
  // Each refusal names its own reason so the author knows what to change before choosing again.
  if (!['image/png', 'image/jpeg'].includes(file.type))
    throw new Error(
      'この形式の画像は添付できません。JPEGかPNGの画像を選んでください（GIF・WebP・HEIC・SVGなどは不可）。',
    );
  if (file.size < 1) throw new Error('空のファイルは添付できません。別の画像を選んでください。');
  if (file.size > MEDIA_SOURCE_MAX_BYTES)
    throw new Error(
      `画像が大きすぎます（${(file.size / 1048576).toFixed(1)} MiB）。12 MiB以内の画像を選んでください。`,
    );
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
  if (!width || !height)
    throw new Error(
      '画像の中身をJPEG・PNGとして読み取れませんでした。拡張子と実際の形式が合っているか確かめてください。',
    );
  if (width * height > 16000000 || width > 16384 || height > 16384)
    throw new Error(
      `画像の画素数が大きすぎます（${width} × ${height}）。1600万画素以内の画像を選んでください。`,
    );
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
  if (
    !image.width ||
    !image.height ||
    image.width * image.height > 16000000 ||
    image.width > 16384 ||
    image.height > 16384
  ) {
    image.close();
    throw new Error('元画像は1600万画素以内にしてください。');
  }
  return image;
}
/** Native decode/resize strips metadata; the server independently bounds and decodes every output pixel. */
export async function prepareImage(file: File): Promise<Blob> {
  const image = await openImageSource(file);
  try {
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
