import { mediaId, publicMediaPath } from './media';

/**
 * The picture a public card shows (#311, C26 condition 5): only the public media path of an image
 * the article or project already publishes. The card reads it through the existing public media
 * route, which answers 404 once the publication is stopped or hidden.
 */
export const CARD_IMAGE_PATH = /^\/api\/media\/([0-9a-f-]{36})$/;
export function isCardImage(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = CARD_IMAGE_PATH.exec(value);
  return !!match && mediaId(match[1]) && publicMediaPath(match[1]) === value;
}
/**
 * The exact key list a public DTO validator expects: `image` is optional (an older Worker, the
 * sample catalog and cards without an image have none), and when present it must be a card image.
 * Returns null when the key is present with any other value, so the whole DTO is refused.
 */
export function withCardImageKey(value: unknown, keys: string[]): string[] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return keys;
  if (!Object.hasOwn(value, 'image')) return keys;
  return isCardImage((value as Record<string, unknown>).image) ? [...keys, 'image'] : null;
}
/** The owner's choice as the private API returns it: an attached image id, or null for the default. */
export type CardImageChoice = { mediaId: string | null };
export const validCardImageChoice = (value: unknown): value is CardImageChoice =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === 1 &&
  Object.hasOwn(value, 'mediaId') &&
  ((value as CardImageChoice).mediaId === null || mediaId((value as CardImageChoice).mediaId));
/**
 * Runs a DTO's exact-key check with the optional `image` added when present and valid. A present
 * but invalid `image` fails the check.
 */
export function cardKeys(
  value: unknown,
  keys: string[],
  check: (value: unknown, keys: string[]) => boolean,
): value is Record<string, unknown> {
  const expected = withCardImageKey(value, keys);
  return expected !== null && check(value, expected);
}
