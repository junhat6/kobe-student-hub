import {
  ArticlePublicationStore,
  publicArticleSqlBounds,
  publicProfileSqlBounds,
} from './publication';
import { ProjectStore } from './projects';
import type { PublicDiscoveryCard } from '../src/types';
import type { OrdinaryDiscovery, RelatedDiscovery } from '../src/community/discovery-types';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const activeAuthor = `EXISTS(SELECT 1 FROM account_public_profiles mapping JOIN private_accounts owner ON owner.id=mapping.owner_account_id AND owner.status='active' WHERE mapping.public_profile_id=p.id)`;
const articleSource = `FROM content c JOIN article_publications publication ON publication.content_id=c.id AND publication.public_profile_id=c.author_id JOIN public_profiles p ON p.id=c.author_id`;
const eligible = `${publicArticleSqlBounds} AND ${activeAuthor} AND EXISTS(SELECT 1 FROM account_public_profiles provenance WHERE provenance.owner_account_id=publication.owner_account_id AND provenance.public_profile_id=p.id)`;
const projectSource = `FROM project_publications r JOIN public_profiles p ON p.id=r.public_profile_id`;
const eligibleProject = `r.status='published' AND ${publicProfileSqlBounds} AND ${activeAuthor} AND EXISTS(SELECT 1 FROM account_public_profiles provenance WHERE provenance.owner_account_id=r.owner_account_id AND provenance.public_profile_id=p.id) AND NOT EXISTS(SELECT 1 FROM private_accounts private_id WHERE private_id.id=p.id OR private_id.google_subject=p.id) AND length(CAST(r.title AS BLOB))<=800 AND length(CAST(r.description AS BLOB))<=16384 AND length(CAST(r.github_url AS BLOB))<=2048 AND length(CAST(r.demo_url AS BLOB))<=2048`;
const confirmedLiker = publicProfileSqlBounds.replaceAll('p.', 'confirmed.');
// Aggregate actual likes once rather than scanning the likes table for every article.
const articleSelection = `c.id,publication.source_version sourceVersion,publication.published_at_ms publishedAt,c.tags_json tagsJson`;
const popularitySql = `WITH ranked_likes AS (SELECT likes.content_id,COUNT(*) likeCount FROM article_likes likes JOIN private_accounts liker ON liker.id=likes.owner_account_id AND liker.status='active' JOIN account_public_profiles liked_profile ON liked_profile.owner_account_id=liker.id JOIN public_profiles confirmed ON confirmed.id=liked_profile.public_profile_id WHERE ${confirmedLiker} AND NOT EXISTS(SELECT 1 FROM private_accounts private_id WHERE private_id.id=confirmed.id OR private_id.google_subject=confirmed.id) GROUP BY likes.content_id) SELECT ${articleSelection},ranked_likes.likeCount ${articleSource} JOIN ranked_likes ON ranked_likes.content_id=c.id WHERE ${eligible} ORDER BY ranked_likes.likeCount DESC,publication.published_at_ms DESC,c.id ASC LIMIT 6`;
type ArticleSelection = {
  id: string;
  sourceVersion: number;
  publishedAt: number;
  tagsJson: string;
};
type RankedArticle = ArticleSelection & { likeCount: number };
type ArticleSnapshot = ArticleSelection & { card: PublicDiscoveryCard };
type ProjectSelection = { id: string; sourceVersion: number; publishedAt: number };
type ProjectSnapshot = ProjectSelection & {
  value: NonNullable<Awaited<ReturnType<ProjectStore['readPublished']>>>;
};
const validSelection = (row: ProjectSelection) =>
  UUID.test(row.id) &&
  Number.isSafeInteger(row.sourceVersion) &&
  row.sourceVersion > 0 &&
  Number.isSafeInteger(row.publishedAt) &&
  row.publishedAt >= 0 &&
  row.publishedAt <= 253402300799999;
const articleCardMatches = [
  ['c.author_id', 'author.id'],
  ['c.title', 'entry.title'],
  ['c.summary', 'entry.summary'],
  ['c.audience', 'entry.audience'],
  ['c.prerequisite', 'entry.prerequisite'],
  ['c.outcome', 'entry.outcome'],
  ['c.updated_at', 'entry.updatedAt'],
  ['c.minutes', 'entry.minutes'],
  ['p.display_name', 'author.name'],
  ['p.department', 'author.department'],
  ['p.year_label', 'author.year'],
  ['p.initials', 'author.initials'],
]
  .map(([column, path]) => `${column}=json_extract(expected.value,'$.card.${path}')`)
  .join(' AND ');
const projectMatches = [
  ['r.public_profile_id', 'author.id'],
  ['r.title', 'project.title'],
  ['r.description', 'project.description'],
  ['r.github_url', 'project.githubUrl'],
  ['r.demo_url', 'project.demoUrl'],
  ['p.display_name', 'author.name'],
  ['p.department', 'author.department'],
  ['p.year_label', 'author.year'],
  ['p.initials', 'author.initials'],
]
  .map(([column, path]) => `${column}=json_extract(expected.value,'$.value.${path}')`)
  .join(' AND ');
const card = ({
  entry,
  author,
}: NonNullable<
  Awaited<ReturnType<ArticlePublicationStore['readPublished']>>
>): PublicDiscoveryCard => {
  return {
    entry: {
      id: entry.id,
      title: entry.title,
      summary: entry.summary,
      tags: entry.tags,
      audience: entry.audience,
      prerequisite: entry.prerequisite,
      outcome: entry.outcome,
      updatedAt: entry.updatedAt,
      minutes: entry.minutes,
    },
    author: {
      id: author.id,
      name: author.name,
      department: author.department,
      year: author.year,
      initials: author.initials,
    },
  };
};
const bounded = <T>(value: T): T | null =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength <= 262144 ? value : null;

/** Anonymous deterministic discovery. No visitor identifiers, history or inferred preferences. */
export class OrdinaryDiscoveryStore {
  private articles: ArticlePublicationStore;
  private projects: ProjectStore;
  constructor(
    private db: D1Database,
    origin: string,
    clock: () => number = Date.now,
  ) {
    this.articles = new ArticlePublicationStore(db, origin, clock);
    this.projects = new ProjectStore(db, origin, clock);
  }
  private async articleCards(selected: ArticleSelection[]): Promise<ArticleSnapshot[] | null> {
    const ids = selected.map((row) => row.id);
    if (selected.some((row) => !validSelection(row)) || new Set(ids).size !== ids.length)
      return null;
    const rows = await this.articles.readPublishedSelection(ids);
    if (!rows) return null;
    const byId = new Map(rows.map((row) => [row.entry.id, card(row)]));
    const result = selected.map((row) => ({
      id: row.id,
      sourceVersion: row.sourceVersion,
      publishedAt: row.publishedAt,
      tagsJson: row.tagsJson,
      card: byId.get(row.id)!,
    }));
    return result.some(
      (row) =>
        !row.card ||
        JSON.stringify(row.card.entry.tags) !== JSON.stringify(JSON.parse(row.tagsJson)),
    )
      ? null
      : result;
  }
  /** One final statement checks every returned projection and its selected publication revision. */
  private async finalSnapshot(
    articles: ArticleSnapshot[],
    projects: ProjectSnapshot[],
    ranking?: RankedArticle[],
  ): Promise<boolean> {
    const unique = new Map<string, ArticleSnapshot>();
    for (const snapshot of articles) {
      const existing = unique.get(snapshot.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(snapshot)) return false;
      unique.set(snapshot.id, snapshot);
    }
    const expectedArticles = [...unique.values()];
    if (!bounded({ articles: expectedArticles, projects, ranking })) return false;
    const values: (string | number)[] = [
      JSON.stringify(expectedArticles),
      JSON.stringify(projects),
    ];
    if (ranking) values.push(JSON.stringify(ranking));
    values.push(expectedArticles.length, projects.length);
    const final = await this.db
      .prepare(
        `WITH expected_articles AS MATERIALIZED(SELECT value FROM json_each(?)),
          accepted_articles AS MATERIALIZED(
            SELECT c.id ${articleSource} JOIN expected_articles expected ON c.id=json_extract(expected.value,'$.id')
            WHERE ${eligible}
              AND publication.source_version=json_extract(expected.value,'$.sourceVersion')
              AND publication.published_at_ms=json_extract(expected.value,'$.publishedAt')
              AND c.tags_json=json_extract(expected.value,'$.tagsJson') AND ${articleCardMatches}
          ), expected_projects AS MATERIALIZED(SELECT value FROM json_each(?)),
          accepted_projects AS MATERIALIZED(
            SELECT r.id ${projectSource} JOIN expected_projects expected ON r.id=json_extract(expected.value,'$.id')
            WHERE ${eligibleProject}
              AND r.source_version=json_extract(expected.value,'$.sourceVersion')
              AND r.published_at_ms=json_extract(expected.value,'$.publishedAt') AND ${projectMatches}
          )${
            ranking
              ? `, expected_ranking AS MATERIALIZED(SELECT value FROM json_each(?)),
                  current_ranking AS MATERIALIZED(${popularitySql})`
              : ''
          }
          SELECT (SELECT COUNT(*) FROM accepted_articles)=?
            AND (SELECT COUNT(*) FROM accepted_projects)=?${
              ranking
                ? ` AND (SELECT COUNT(*) FROM current_ranking)=(SELECT COUNT(*) FROM expected_ranking)
                    AND NOT EXISTS(
                      SELECT 1 FROM expected_ranking expected LEFT JOIN current_ranking current
                        ON current.id=json_extract(expected.value,'$.id')
                      WHERE current.id IS NULL OR current.likeCount<>json_extract(expected.value,'$.likeCount')
                        OR current.sourceVersion<>json_extract(expected.value,'$.sourceVersion')
                        OR current.publishedAt<>json_extract(expected.value,'$.publishedAt')
                    )`
                : ''
            } accepted`,
      )
      .bind(...values)
      .first<{ accepted: number }>();
    return final?.accepted === 1;
  }
  async home(): Promise<OrdinaryDiscovery | null> {
    try {
      const recent = await this.db
        .prepare(
          `SELECT ${articleSelection} ${articleSource} WHERE ${eligible} ORDER BY publication.published_at_ms DESC,c.id ASC LIMIT 20`,
        )
        .all<ArticleSelection>();
      const ranked = await this.db.prepare(popularitySql).all<RankedArticle>();
      if (ranked.results.some((row) => !Number.isSafeInteger(row.likeCount) || row.likeCount < 1))
        return null;
      const recentCards = await this.articleCards(recent.results);
      const popularCards = await this.articleCards(ranked.results);
      if (!recentCards || !popularCards) return null;
      if (!(await this.finalSnapshot([...recentCards, ...popularCards], [], ranked.results)))
        return null;
      return bounded({
        recent: recentCards.map((value) => value.card),
        popular: popularCards.map((value, i) => ({
          ...value.card,
          likeCount: ranked.results[i].likeCount,
        })),
      });
    } catch {
      return null;
    }
  }
  async related(id: string): Promise<RelatedDiscovery | null> {
    if (!UUID.test(id)) return null;
    try {
      const selectedSource = await this.db
        .prepare(`SELECT ${articleSelection} ${articleSource} WHERE c.id=? AND ${eligible}`)
        .bind(id)
        .first<ArticleSelection>();
      const source = selectedSource && (await this.articleCards([selectedSource]));
      if (!source) return null;
      const tags = source[0].card.entry.tags;
      if (!tags.length)
        return (await this.finalSnapshot(source, [])) ? { articles: [], projects: [] } : null;
      const candidates = await this.db
        .prepare(
          `SELECT ${articleSelection} ${articleSource} WHERE c.id<>? AND ${eligible} AND EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(c.tags_json) THEN c.tags_json ELSE '[]' END) tag WHERE tag.value IN (${tags.map(() => '?').join(',')})) ORDER BY publication.published_at_ms DESC,c.id ASC LIMIT 4`,
        )
        .bind(id, ...tags)
        .all<ArticleSelection>();
      const values = await this.articleCards(candidates.results);
      if (!values) return null;
      const articles = values.map((value) => ({
        ...value.card,
        matchingTag: tags.find((tag) => value.card.entry.tags.includes(tag))!,
      }));
      if (articles.some((value) => !value.matchingTag)) return null;
      // Projects have no tag field. Match explicitly against their public title/description instead.
      const works = await this.db
        .prepare(
          `SELECT r.id,r.source_version sourceVersion,r.published_at_ms publishedAt ${projectSource} WHERE ${eligibleProject} AND (${tags.map(() => `instr(lower(r.title||char(10)||r.description),lower(?))>0`).join(' OR ')}) ORDER BY r.published_at_ms DESC,r.id ASC LIMIT 3`,
        )
        .bind(...tags)
        .all<ProjectSelection>();
      const projects: RelatedDiscovery['projects'] = [];
      const projectSnapshots: ProjectSnapshot[] = [];
      for (const selected of works.results) {
        if (!validSelection(selected)) return null;
        const value = await this.projects.readPublished(selected.id);
        if (!value) return null;
        const matchingTag = tags.find((tag) =>
          (value.project.title + '\n' + value.project.description)
            .toLocaleLowerCase('ja')
            .includes(tag.toLocaleLowerCase('ja')),
        );
        if (!matchingTag) return null;
        projectSnapshots.push({ ...selected, value });
        const author = {
          id: value.author.id,
          name: value.author.name,
          department: value.author.department,
          year: value.author.year,
          initials: value.author.initials,
        };
        projects.push({
          project: {
            id: value.project.id,
            title: value.project.title,
            descriptionPreview: Array.from(value.project.description).slice(0, 300).join(''),
            publishedOn: value.project.publishedOn,
          },
          author,
          matchingTag,
        });
      }
      if (!(await this.finalSnapshot([...source, ...values], projectSnapshots))) return null;
      return bounded({ articles, projects });
    } catch {
      return null;
    }
  }
}
