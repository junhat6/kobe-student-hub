import { AVATAR_MAX_BYTES, AVATAR_MAX_EDGE, avatarVersion } from '../shared/avatar';
import { boundedReadFailure, readBoundedJson } from '../shared/http-client';
import { openImageSource } from './media-client';

export class AvatarClientError extends Error {
  constructor(message = 'アイコン画像の状態を確認できませんでした。') {
    super(message);
    this.name = 'AvatarClientError';
  }
}
const PATH = '/api/private/profile-avatar';
const csrfShape = /^[A-Za-z0-9_-]{43}$/;
function version(v: unknown, nullable: boolean): string | null {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).join(',') !== 'avatar' ||
    !(
      (nullable && (v as { avatar: unknown }).avatar === null) ||
      avatarVersion((v as { avatar: unknown }).avatar)
    )
  )
    throw new AvatarClientError();
  return (v as { avatar: string | null }).avatar;
}
/** Own icon only. Every write is one explicit request; an unclear result is re-read, not resent. */
export function createAvatarClient(csrfToken: string, fetcher: typeof fetch = fetch) {
  async function call(
    write: { method: 'PUT' | 'DELETE'; body?: Blob } | undefined,
    status: number,
  ): Promise<unknown> {
    try {
      return await readBoundedJson(PATH, {
        fetcher,
        credentials: 'same-origin',
        method: write?.method ?? 'GET',
        status,
        maxBytes: 1024,
        ...(write === undefined
          ? {}
          : { csrf: csrfToken, ...(write.body === undefined ? {} : { body: write.body }) }),
      });
    } catch (error) {
      throw new AvatarClientError(
        boundedReadFailure(error) === 'rejected'
          ? 'この画像はアイコンにできませんでした。別の画像を選んでください。'
          : undefined,
      );
    }
  }
  return {
    async read(): Promise<string | null> {
      return version(await call(undefined, 200), true);
    },
    async upload(image: Blob): Promise<string> {
      if (!csrfShape.test(csrfToken)) throw new AvatarClientError();
      if (image.type !== 'image/jpeg' || image.size < 1 || image.size > AVATAR_MAX_BYTES)
        throw new AvatarClientError();
      return version(await call({ method: 'PUT', body: image }, 201), false)!;
    },
    async remove(): Promise<void> {
      if (!csrfShape.test(csrfToken)) throw new AvatarClientError();
      if (version(await call({ method: 'DELETE' }, 200), true) !== null)
        throw new AvatarClientError();
    },
  };
}
/** Center-crops to a square and redraws at 256px as JPEG, which drops EXIF and other metadata. */
export async function prepareAvatar(file: File): Promise<Blob> {
  const image = await openImageSource(file);
  try {
    const side = Math.min(image.width, image.height);
    if (side < 32)
      throw new Error('画像が小さすぎます。縦横32ピクセル以上の画像を選んでください。');
    const edge = Math.min(AVATAR_MAX_EDGE, side);
    const canvas = document.createElement('canvas');
    canvas.width = edge;
    canvas.height = edge;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('画像の準備ができませんでした。');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, edge, edge);
    context.drawImage(
      image,
      (image.width - side) / 2,
      (image.height - side) / 2,
      side,
      side,
      0,
      0,
      edge,
      edge,
    );
    try {
      for (const quality of [0.86, 0.72, 0.58, 0.44]) {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/jpeg', quality),
        );
        if (blob && blob.size > 0 && blob.size <= AVATAR_MAX_BYTES) return blob;
      }
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
    throw new Error('画像を64 KiB以内にできませんでした。別の画像を選んでください。');
  } finally {
    image.close();
  }
}
