import { publicProfileSqlBounds } from './publication';
import type { PublicStudentActivity } from '../src/public-student-types';

const DAY_MS = 86400000;
const JAPAN_OFFSET_MS = 9 * 60 * 60 * 1000;
/** 26 whole weeks ending today (Japan calendar). Half a school year fits a phone width. */
export const ACTIVITY_DAYS = 26 * 7;

/** A student is public while their profile is valid and at least one article or project is public. */
export async function publicStudentVisible(db: D1Database, authorId: string) {
  const visible = await db
    .prepare(
      `SELECT 1 ok FROM public_profiles p WHERE p.id=? AND ${publicProfileSqlBounds} AND NOT EXISTS(SELECT 1 FROM private_accounts a WHERE a.id=p.id OR a.google_subject=p.id) AND (EXISTS(SELECT 1 FROM content c JOIN article_publications r ON r.content_id=c.id AND r.public_profile_id=c.author_id WHERE c.author_id=p.id AND c.kind='article' AND c.status='published' AND c.is_sample=0) OR EXISTS(SELECT 1 FROM project_publications j WHERE j.public_profile_id=p.id AND j.status='published'))`,
    )
    .bind(authorId)
    .first<{ ok: number }>();
  return visible !== null;
}

const japanDay = (ms: number) => Math.floor((ms + JAPAN_OFFSET_MS) / DAY_MS);
const isoDay = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/**
 * Public "grass": how many public things (an article publication or public revision,
 * a project publication) happened on each Japan calendar day. Only items that are public
 * right now count, so a stopped article leaves no trace. Drafts, reading and likes never
 * count: they are private or would turn the grass into a vanity counter.
 */
export async function readPublicActivity(
  db: D1Database,
  authorId: string,
  nowMs: number,
): Promise<PublicStudentActivity | null | 'missing'> {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return null;
  const today = japanDay(nowMs);
  const first = today - ACTIVITY_DAYS + 1;
  const fromMs = first * DAY_MS - JAPAN_OFFSET_MS;
  const toMs = nowMs;
  if (!(await publicStudentVisible(db, authorId))) return 'missing';
  const rows = await db
    .prepare(
      `SELECT day,COUNT(*) n FROM (
        SELECT (v.published_at_ms+${JAPAN_OFFSET_MS})/${DAY_MS} day FROM article_publication_revisions v
          JOIN article_publications r ON r.content_id=v.content_id
          JOIN content c ON c.id=r.content_id AND c.author_id=r.public_profile_id
          WHERE r.public_profile_id=? AND c.kind='article' AND c.status='published' AND c.is_sample=0
          AND v.published_at_ms BETWEEN ? AND ?
        UNION ALL
        SELECT (j.published_at_ms+${JAPAN_OFFSET_MS})/${DAY_MS} day FROM project_publications j
          WHERE j.public_profile_id=? AND j.status='published' AND j.published_at_ms BETWEEN ? AND ?
      ) GROUP BY day ORDER BY day LIMIT ${ACTIVITY_DAYS + 1}`,
    )
    .bind(authorId, fromMs, toMs, authorId, fromMs, toMs)
    .all<{ day: number; n: number }>();
  const days: PublicStudentActivity['days'] = [];
  for (const row of rows.results) {
    if (!Number.isSafeInteger(row.day) || row.day < first || row.day > today) return null;
    if (!Number.isSafeInteger(row.n) || row.n < 1) return null;
    days.push({ date: isoDay(row.day), count: Math.min(row.n, 99) });
  }
  return { from: isoDay(first), to: isoDay(today), days };
}
