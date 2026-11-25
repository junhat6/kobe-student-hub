import type { PublicReceivedLikes } from '../public-student-types';

/** Like counts per article as last shown on this device; null before the first visit. */
export type SeenLikes = Record<string, number> | null;

interface ReceivedRow {
  id: string;
  title: string;
  likes: number;
  /** Likes added since the last visit on this device (0 when nothing new or first visit). */
  added: number;
}

/**
 * What arrived since the last time one's own page was shown. The first visit is the baseline,
 * so nothing is marked new; a count that went down (an unlike) is simply not new. Nothing is
 * ranked against anyone else: these are one's own articles only.
 */
export function receivedLikes(value: PublicReceivedLikes, seen: SeenLikes) {
  const rows: ReceivedRow[] = value.articles.map((article) => ({
    ...article,
    added: seen ? Math.max(0, article.likes - (seen[article.id] ?? 0)) : 0,
  }));
  return {
    rows,
    total: rows.reduce((sum, row) => sum + row.likes, 0),
    added: rows.reduce((sum, row) => sum + row.added, 0),
  };
}

const storageKey = (profileId: string) => 'ksh.receivedLikes.' + profileId;

/**
 * Kept in this browser only: the counts are public anyway, and the "last seen" moment is a
 * per-device convenience, so it is not stored on the server. Storage may be unavailable
 * (private window, blocked site data); then every visit is a first visit.
 */
export function readSeenLikes(profileId: string): SeenLikes {
  try {
    const raw = window.localStorage.getItem(storageKey(profileId));
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const seen: Record<string, number> = {};
    for (const [id, count] of Object.entries(value))
      if (Number.isSafeInteger(count) && (count as number) >= 0) seen[id] = count as number;
    return seen;
  } catch {
    return null;
  }
}

export function writeSeenLikes(profileId: string, value: PublicReceivedLikes) {
  try {
    window.localStorage.setItem(
      storageKey(profileId),
      JSON.stringify(Object.fromEntries(value.articles.map((a) => [a.id, a.likes]))),
    );
  } catch {
    // Not remembered: the next visit starts from a fresh baseline.
  }
}
