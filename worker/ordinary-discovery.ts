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
const popularitySql = `WITH ranked_likes AS (SELECT likes.content_id,COUNT(*) likeCount FROM article_likes likes JOIN private_accounts liker ON liker.id=likes.owner_account_id AND liker.status='active' JOIN account_public_profiles liked_profile ON liked_profile.owner_account_id=liker.id JOIN public_profiles confirmed ON confirmed.id=liked_profile.public_profile_id WHERE ${confirmedLiker} AND NOT EXISTS(SELECT 1 FROM private_accounts private_id WHERE private_id.id=confirmed.id OR private_id.google_subject=confirmed.id) GROUP BY likes.content_id) SELECT c.id,ranked_likes.likeCount ${articleSource} JOIN ranked_likes ON ranked_likes.content_id=c.id WHERE ${eligible} ORDER BY ranked_likes.likeCount DESC,publication.published_at_ms DESC,c.id ASC LIMIT 6`;
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
  private async articleCards(ids: string[]): Promise<PublicDiscoveryCard[] | null> {
    if (ids.some((id) => !UUID.test(id)) || new Set(ids).size !== ids.length) return null;
    const rows = await this.articles.readPublishedSelection(ids);
    if (!rows) return null;
    if (ids.length) {
      const final = await this.db
        .prepare(
          `SELECT c.id ${articleSource} WHERE c.id IN (${ids.map(() => '?').join(',')}) AND ${eligible}`,
        )
        .bind(...ids)
        .all<{ id: string }>();
      if (final.results.length !== ids.length) return null;
    }
    const byId = new Map(rows.map((row) => [row.entry.id, card(row)]));
    return ids.map((id) => byId.get(id)!);
  }
  async home(): Promise<OrdinaryDiscovery | null> {
    try {
      const recent = await this.db
        .prepare(
          `SELECT c.id ${articleSource} WHERE ${eligible} ORDER BY publication.published_at_ms DESC,c.id ASC LIMIT 20`,
        )
        .all<{ id: string }>();
      const ranked = await this.db.prepare(popularitySql).all<{ id: string; likeCount: number }>();
      if (ranked.results.some((row) => !Number.isSafeInteger(row.likeCount) || row.likeCount < 1))
        return null;
      const recentCards = await this.articleCards(recent.results.map((row) => row.id));
      const popularCards = await this.articleCards(ranked.results.map((row) => row.id));
      if (!recentCards || !popularCards) return null;
      // Count and ordering are read again after public projection, so a changed ranking is retried by the reader.
      const final = await this.db.prepare(popularitySql).all<{ id: string; likeCount: number }>();
      if (JSON.stringify(final.results) !== JSON.stringify(ranked.results)) return null;
      if (recentCards.length) {
        const finalRecent = await this.db
          .prepare(
            `SELECT c.id ${articleSource} WHERE c.id IN (${recentCards.map(() => '?').join(',')}) AND ${eligible}`,
          )
          .bind(...recentCards.map((value) => value.entry.id))
          .all<{ id: string }>();
        if (finalRecent.results.length !== recentCards.length) return null;
      }
      return bounded({
        recent: recentCards,
        popular: popularCards.map((value, i) => ({
          ...value,
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
      const source = await this.articles.readPublished(id);
      if (!source || !(await this.articleCards([id]))) return null;
      const tags = source.entry.tags;
      if (!tags.length) return { articles: [], projects: [] };
      const candidates = await this.db
        .prepare(
          `SELECT c.id ${articleSource} WHERE c.id<>? AND ${eligible} AND EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(c.tags_json) THEN c.tags_json ELSE '[]' END) tag WHERE tag.value IN (${tags.map(() => '?').join(',')})) ORDER BY publication.published_at_ms DESC,c.id ASC LIMIT 4`,
        )
        .bind(id, ...tags)
        .all<{ id: string }>();
      const values = await this.articleCards(candidates.results.map((row) => row.id));
      if (!values) return null;
      const articles = values.map((value) => ({
        ...value,
        matchingTag: tags.find((tag) => value.entry.tags.includes(tag))!,
      }));
      if (articles.some((value) => !value.matchingTag)) return null;
      // Projects have no tag field. Match explicitly against their public title/description instead.
      const works = await this.db
        .prepare(
          `SELECT r.id ${projectSource} WHERE ${eligibleProject} AND (${tags.map(() => `instr(lower(r.title||char(10)||r.description),lower(?))>0`).join(' OR ')}) ORDER BY r.published_at_ms DESC,r.id ASC LIMIT 3`,
        )
        .bind(...tags)
        .all<{ id: string }>();
      const projects: RelatedDiscovery['projects'] = [];
      for (const selected of works.results) {
        if (!UUID.test(selected.id)) return null;
        const value = await this.projects.readPublished(selected.id);
        if (!value) return null;
        const matchingTag = tags.find((tag) =>
          (value.project.title + '\n' + value.project.description)
            .toLocaleLowerCase('ja')
            .includes(tag.toLocaleLowerCase('ja')),
        );
        if (!matchingTag) return null;
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
      // One final SQL snapshot checks the source, article and project public states together.
      const articleIds = [id, ...articles.map((value) => value.entry.id)];
      const projectIds = projects.map((value) => value.project.id);
      const final = await this.db
        .prepare(
          `WITH accepted_articles AS MATERIALIZED(SELECT c.id ${articleSource} WHERE c.id IN (${articleIds.map(() => '?').join(',')}) AND ${eligible} AND (c.id<>? OR c.tags_json=?)), accepted_projects AS MATERIALIZED(SELECT r.id ${projectSource} WHERE ${projectIds.length ? `r.id IN (${projectIds.map(() => '?').join(',')})` : '0'} AND ${eligibleProject}) SELECT (SELECT COUNT(*) FROM accepted_articles)=? AND (SELECT COUNT(*) FROM accepted_projects)=? accepted`,
        )
        .bind(
          ...articleIds,
          id,
          JSON.stringify(tags),
          ...projectIds,
          articleIds.length,
          projectIds.length,
        )
        .first<{ accepted: number }>();
      if (final?.accepted !== 1) return null;
      return bounded({ articles, projects });
    } catch {
      return null;
    }
  }
}
