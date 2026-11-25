import { publicStudentVisible } from './public-activity';
import { publicArticleSqlBounds, publicProfileSqlBounds } from './publication';
import type { PublicReceivedLikes } from '../src/public-student-types';

/** The most-liked public articles returned; the rest are not listed (and not summed). */
const RECEIVED_LIKES_LIMIT = 20;
const confirmedLiker = publicProfileSqlBounds.replaceAll('p.', 'confirmed.');

/**
 * Likes each currently public article of a student has received, counted exactly as the home
 * page's "人気" counts them (active accounts with a confirmed public profile). Likes are public
 * already (/students/:id/likes lists who liked what), so this exposes no new fact: only the
 * public title and a count, never a liker, a timestamp or a view count. Articles without a
 * like are omitted, so a student with none gets an empty list.
 */
export async function readPublicReceivedLikes(
  db: D1Database,
  authorId: string,
): Promise<PublicReceivedLikes | null | 'missing'> {
  if (!(await publicStudentVisible(db, authorId))) return 'missing';
  const rows = await db
    .prepare(
      `SELECT c.id,c.title,COUNT(*) likes FROM content c
        JOIN article_publications publication ON publication.content_id=c.id AND publication.public_profile_id=c.author_id
        JOIN public_profiles p ON p.id=c.author_id
        JOIN article_likes l ON l.content_id=c.id
        JOIN private_accounts liker ON liker.id=l.owner_account_id AND liker.status='active'
        JOIN account_public_profiles liked_profile ON liked_profile.owner_account_id=liker.id
        JOIN public_profiles confirmed ON confirmed.id=liked_profile.public_profile_id
        WHERE c.author_id=? AND ${publicArticleSqlBounds} AND ${confirmedLiker}
          AND NOT EXISTS(SELECT 1 FROM private_accounts private_id WHERE private_id.id=confirmed.id OR private_id.google_subject=confirmed.id)
        GROUP BY c.id ORDER BY likes DESC,c.id ASC LIMIT ${RECEIVED_LIKES_LIMIT}`,
    )
    .bind(authorId)
    .all<{ id: string; title: string; likes: number }>();
  const articles: PublicReceivedLikes['articles'] = [];
  for (const row of rows.results) {
    if (
      typeof row.id !== 'string' ||
      typeof row.title !== 'string' ||
      !Number.isSafeInteger(row.likes) ||
      row.likes < 1
    )
      return null;
    articles.push({ id: row.id, title: row.title, likes: row.likes });
  }
  return { articles };
}
