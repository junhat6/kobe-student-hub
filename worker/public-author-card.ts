import { publicStudentVisible } from './public-activity';
import { publicArticleSqlBounds } from './publication';
import { publicProjectSqlBounds } from './projects';
import type { PublicAuthorCard } from '../src/public-student-types';

/**
 * One more than the card shows, so the page can drop the article or project being read and still
 * list three of the author's other works without a second request.
 */
const AUTHOR_CARD_RECENT = 4;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/**
 * The author card beside an article or project (#312): how many articles and projects are public
 * right now, and the newest few by title. It counts with the same public predicates as the lists
 * and the student page, so a stopped, hidden or invalid item, and a hidden profile, are neither
 * counted nor listed. Only id, kind and title leave the server: no likes, views or followers
 * (the card is about what the person made, not a popularity score).
 */
export async function readPublicAuthorCard(
  db: D1Database,
  authorId: string,
): Promise<PublicAuthorCard | null | 'missing'> {
  if (!ID.test(authorId)) return 'missing';
  if (!(await publicStudentVisible(db, authorId))) return 'missing';
  const articleFrom = `FROM content c JOIN article_publications publication ON publication.content_id=c.id AND publication.public_profile_id=c.author_id JOIN public_profiles p ON p.id=c.author_id WHERE c.author_id=? AND ${publicArticleSqlBounds}`;
  const projectFrom = `FROM project_publications r JOIN public_profiles p ON p.id=r.public_profile_id WHERE r.public_profile_id=? AND ${publicProjectSqlBounds}`;
  // One predicate per statement: both public bounds in one expression exceed D1's depth limit.
  const [articleCount, projectCount, articleRecent, projectRecent] = await db.batch([
    db.prepare(`SELECT COUNT(*) n ${articleFrom}`).bind(authorId),
    db.prepare(`SELECT COUNT(*) n ${projectFrom}`).bind(authorId),
    db
      .prepare(
        `SELECT 'article' kind,c.id id,c.title title,publication.published_at_ms at ${articleFrom} ORDER BY at DESC,c.id ASC LIMIT ${AUTHOR_CARD_RECENT}`,
      )
      .bind(authorId),
    db
      .prepare(
        `SELECT 'project' kind,r.id id,r.title title,r.published_at_ms at ${projectFrom} ORDER BY at DESC,r.id ASC LIMIT ${AUTHOR_CARD_RECENT}`,
      )
      .bind(authorId),
  ]);
  const count = (result: D1Result) => {
    const n = (result.results as { n: unknown }[])[0]?.n;
    return Number.isSafeInteger(n) && (n as number) >= 0 ? (n as number) : null;
  };
  const articles = count(articleCount),
    projects = count(projectCount);
  if (articles === null || projects === null) return null;
  const rows = [...articleRecent.results, ...projectRecent.results] as {
    kind: unknown;
    id: unknown;
    title: unknown;
    at: unknown;
  }[];
  const items: (PublicAuthorCard['recent'][number] & { at: number })[] = [];
  for (const row of rows) {
    if (row.kind !== 'article' && row.kind !== 'project') return null;
    if (typeof row.id !== 'string' || typeof row.title !== 'string') return null;
    if (!Number.isSafeInteger(row.at)) return null;
    const title = row.title.trim();
    if (!title || title.length > 200) return null;
    items.push({ kind: row.kind, id: row.id, title, at: row.at as number });
  }
  items.sort((a, b) => b.at - a.at || a.kind.localeCompare(b.kind) || (a.id < b.id ? -1 : 1));
  const recent = items
    .slice(0, AUTHOR_CARD_RECENT)
    .map(({ kind, id, title }) => ({ kind, id, title }));
  return { articles, projects, recent };
}
