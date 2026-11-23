export const MEDIA_MAX_BYTES = 512 * 1024;
export const MEDIA_MAX_EDGE = 1600;
export const MEDIA_MAX_PIXELS = 1_000_000;
export const JPEG_MAX_PIXELS = 524_288;
// Larger PNG diagrams are accepted only when the compressed work is also small.
export const PNG_HIGH_RES_BYTES = 64 * 1024;
/**
 * Storage limits. The `media_assets_insert` trigger (migrations/0020) enforces the same values
 * atomically; tests/media-limits.test.ts fails if the two drift. Raising a value needs a migration (#195).
 */
export const MEDIA_PER_DRAFT = 8;
export const MEDIA_OWNER_COUNT = 128;
export const MEDIA_OWNER_BYTES = 8 * 1024 * 1024;
export const MEDIA_GLOBAL_COUNT = 4096;
export const MEDIA_GLOBAL_BYTES = 64 * 1024 * 1024;
/** Why an authorized upload was refused by a storage limit. Only sent to the draft's owner. */
export type MediaLimit = 'draft' | 'owner' | 'site';
export const mediaLimit = (value: unknown): value is MediaLimit =>
  value === 'draft' || value === 'owner' || value === 'site';
export const MEDIA_LIMIT_MESSAGE: Record<MediaLimit, string> = {
  draft: `この下書きの画像は${MEDIA_PER_DRAFT}枚までです。使わない画像を本文から外して保存し、削除してから追加してください。`,
  owner: `あなたが保存できる画像の合計（${MEDIA_OWNER_COUNT}枚・${MEDIA_OWNER_BYTES / 1048576} MiB）に達しました。使っていない下書きの画像を削除してから追加してください。`,
  site: 'サイト全体の画像の保存容量がいっぱいです。今は画像を追加できません。時間をおいて試してください。',
};
export const mediaId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export const publicMediaPath = (id: string) => '/api/media/' + id;
export const privateMediaPath = (id: string) => '/api/private/media/' + id;
export interface MediaReceipt {
  id: string;
  mime: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  bytes: number;
}
export function validMediaIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MEDIA_PER_DRAFT &&
    value.every(mediaId) &&
    new Set(value).size === value.length
  );
}
/** The explicit publication preview shows every referenced attachment, including literal links. */
export function referencedMediaIds(body: string): string[] {
  return [
    ...new Set(
      [
        ...body.matchAll(
          /\/api\/media\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?![A-Za-z0-9_-])/g,
        ),
      ].map((match) => match[1]),
    ),
  ];
}
