import { proofAuthorization } from '../shared/auth-proof';
import { AVATAR_MAX_BYTES, AVATAR_MAX_EDGE, avatarVersion } from '../shared/avatar';
import { openImageSource } from './media-client';

export class AvatarClientError extends Error {
  constructor(message = 'アイコン画像の状態を確認できませんでした。') {
    super(message);
    this.name = 'AvatarClientError';
  }
}
const PATH = '/api/private/profile-avatar';
async function readJson(response: Response): Promise<unknown> {
  const length = response.headers.get('Content-Length');
  if (
    !response.body ||
    !/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type') ?? '') ||
    (length !== null && (!/^\d+$/.test(length) || Number(length) > 1024))
  ) {
    void response.body?.cancel().catch(() => {});
    throw new AvatarClientError();
  }
  const text = await response.text();
  if (text.length > 1024) throw new AvatarClientError();
  return JSON.parse(text) as unknown;
}
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
  async function call(init: RequestInit, expected: number) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 10000);
    try {
      const r = await fetcher(PATH, {
        ...init,
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
      if (r.status !== expected) {
        void r.body?.cancel().catch(() => {});
        throw new AvatarClientError(
          r.status === 422
            ? 'この画像はアイコンにできませんでした。別の画像を選んでください。'
            : undefined,
        );
      }
      return await readJson(r);
    } finally {
      clearTimeout(timer);
    }
  }
  const write = () => ({ Authorization: proofAuthorization('csrf', csrfToken) });
  return {
    async read(): Promise<string | null> {
      return version(await call({ headers: { Accept: 'application/json' } }, 200), true);
    },
    async upload(image: Blob): Promise<string> {
      if (!/^[A-Za-z0-9_-]{43}$/.test(csrfToken)) throw new AvatarClientError();
      if (image.type !== 'image/jpeg' || image.size < 1 || image.size > AVATAR_MAX_BYTES)
        throw new AvatarClientError();
      return version(
        await call(
          { method: 'PUT', headers: { ...write(), 'Content-Type': image.type }, body: image },
          201,
        ),
        false,
      )!;
    },
    async remove(): Promise<void> {
      if (!/^[A-Za-z0-9_-]{43}$/.test(csrfToken)) throw new AvatarClientError();
      if (version(await call({ method: 'DELETE', headers: write() }, 200), true) !== null)
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
