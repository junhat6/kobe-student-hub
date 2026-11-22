// Profile icon bounds shared by the browser preparation and the worker check (#198).
export const AVATAR_MAX_BYTES = 64 * 1024;
export const AVATAR_MAX_EDGE = 256;
export const AVATAR_MIN_EDGE = 32;
/** The version is the first 16 hex digits of the stored image's SHA-256. */
export const avatarVersion = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{16}$/.test(value);
const profileId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
export const publicAvatarPath = (id: string, version: string) =>
  `/api/profile-avatars/${id}/${version}`;
export const ownAvatarPath = (version: string) => `/api/private/profile-avatar/${version}`;
/** A public avatar URL is only ever this exact versioned same-origin path. */
export function validPublicAvatar(value: unknown, id: string): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || !profileId(id)) return false;
  const match = /^\/api\/profile-avatars\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/([0-9a-f]{16})$/.exec(
    value,
  );
  return !!match && match[1] === id;
}
