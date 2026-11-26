import {
  liveStudentSessionSql as writer,
  liveStudentSessionBindings as writerBinds,
} from './auth/student-participation';
import { liveSessionSql as live, liveSessionBindings as binds } from './auth/session-guard';
import { SessionStore } from './auth/sessions';
import {
  PROFILE_LINK_SERVICES,
  validProfileLink,
  validProfileLinks,
  type ProfileLink,
} from '../src/shared/profile-links';

const slug = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
/** Fixed service order for every list and for the report snapshot JSON. */
export const profileLinkOrderSql = `CASE service WHEN 'x' THEN 1 WHEN 'github' THEN 2 WHEN 'linkedin' THEN 3 ELSE 4 END`;
/**
 * The links of profile `p` as one JSON array, in the same form the 0052 report trigger compares.
 * Used by the profile report INSERT so the snapshot is taken in the same statement.
 */
export const profileLinksJsonSql = `(SELECT COALESCE(json_group_array(json_object('service',service,'url',url)),'[]') FROM (SELECT service,url FROM public_profile_links WHERE public_profile_id=p.id ORDER BY ${profileLinkOrderSql}))`;
/** Same anonymous eligibility as /api/students and the public icon: a non-sample profile owned
 * by an active account with at least one published article or project. Otherwise no links. */
const publicVisible = `l.public_profile_id=p.id AND p.is_sample=0 AND EXISTS(SELECT 1 FROM account_public_profiles m JOIN private_accounts owner ON owner.id=m.owner_account_id AND owner.status='active' WHERE m.public_profile_id=p.id) AND NOT EXISTS(SELECT 1 FROM private_accounts identity WHERE identity.id=p.id OR identity.google_subject=p.id) AND (EXISTS(SELECT 1 FROM content c WHERE c.author_id=p.id AND c.kind='article' AND c.status='published' AND c.is_sample=0) OR EXISTS(SELECT 1 FROM project_publications r WHERE r.public_profile_id=p.id AND r.status='published'))`;
type Row = { service: unknown; url: unknown };
/** Rows that no longer fit the accepted shapes are left out rather than shown as links. */
function decode(rows: Row[]): ProfileLink[] {
  const links: ProfileLink[] = [];
  for (const row of rows) {
    const link = { service: row.service, url: row.url };
    if (validProfileLink(link) && !links.some((l) => l.service === link.service)) links.push(link);
  }
  links.sort(
    (a, b) => PROFILE_LINK_SERVICES.indexOf(a.service) - PROFILE_LINK_SERVICES.indexOf(b.service),
  );
  return links;
}
const same = (a: readonly ProfileLink[], b: readonly ProfileLink[]) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * The owner's public profile links (#313). Ownership comes only from the session's account
 * mapping; the client never names a profile. Adding or changing links needs current enrollment;
 * removing all of them needs a live session only, so a graduate can still take them down.
 */
export class ProfileLinkStore {
  private readonly sessions: SessionStore;
  constructor(
    private readonly db: D1Database,
    origin: string,
    clock: () => number = Date.now,
  ) {
    this.sessions = new SessionStore(db, origin, clock);
  }
  /** The own links; null = no profile or no live session. */
  async readOwn(request: Request): Promise<{ links: ProfileLink[] } | null> {
    if (request.method !== 'GET' && request.method !== 'PUT') return null;
    try {
      const p = await this.sessions.storageAuthorization(request);
      if (!p) return null;
      const rs = await this.db
        .prepare(
          `SELECT m.public_profile_id profile_id,l.service,l.url FROM (SELECT 1 WHERE ${live}) auth JOIN account_public_profiles m ON m.owner_account_id=? JOIN public_profiles p ON p.id=m.public_profile_id AND p.is_sample=0 LEFT JOIN public_profile_links l ON l.public_profile_id=m.public_profile_id ORDER BY l.service`,
        )
        .bind(...binds(p), p.accountId)
        .all<Row & { profile_id: unknown }>();
      if (!rs.results.length || !rs.results.every((r) => slug(r.profile_id))) return null;
      return { links: decode(rs.results.filter((r) => r.service !== null)) };
    } catch {
      return null;
    }
  }
  /** Replaces the whole set with already normalized links (at least one). */
  async replace(request: Request, links: ProfileLink[]): Promise<{ links: ProfileLink[] } | null> {
    if (request.method !== 'PUT' || !links.length || !validProfileLinks(links)) return null;
    try {
      const p = await this.sessions.storageAuthorization(request);
      if (!p || p.nowMs > 253402300799999) return null;
      const body = JSON.stringify(links);
      // One D1 transaction: the delete, the insert and the final guard either all apply or none.
      await this.db.batch([
        this.db
          .prepare(
            `DELETE FROM public_profile_links WHERE public_profile_id=(SELECT m.public_profile_id FROM account_public_profiles m JOIN public_profiles p ON p.id=m.public_profile_id AND p.is_sample=0 WHERE m.owner_account_id=?) AND ${writer}`,
          )
          .bind(p.accountId, ...writerBinds(p)),
        this.db
          .prepare(
            `INSERT INTO public_profile_links(public_profile_id,service,url,updated_at_ms) SELECT m.public_profile_id,json_extract(j.value,'$.service'),json_extract(j.value,'$.url'),? FROM account_public_profiles m JOIN public_profiles p ON p.id=m.public_profile_id AND p.is_sample=0 JOIN json_each(?) j WHERE m.owner_account_id=? AND ${writer}`,
          )
          .bind(p.nowMs, body, p.accountId, ...writerBinds(p)),
        // A SELECT cannot be skipped: anything but exactly the requested set aborts the batch.
        this.db
          .prepare(
            `SELECT CASE WHEN EXISTS(SELECT 1 FROM account_public_profiles m JOIN public_profiles p ON p.id=m.public_profile_id AND p.is_sample=0 WHERE m.owner_account_id=? AND ${profileLinksJsonSql}=json(?) AND ${writer}) THEN 1 ELSE json('') END AS guarded`,
          )
          .bind(p.accountId, body, ...writerBinds(p)),
      ]);
    } catch {
      return null;
    }
    const after = await this.readOwn(request);
    return after && same(after.links, links) ? after : null;
  }
  /** Removes every link. A live session is enough (a graduate can still take links down). */
  async clear(request: Request): Promise<{ links: ProfileLink[] } | null> {
    if (request.method !== 'PUT') return null;
    try {
      const p = await this.sessions.storageAuthorization(request);
      if (!p) return null;
      const [, after] = await this.db.batch([
        this.db
          .prepare(
            `DELETE FROM public_profile_links WHERE public_profile_id=(SELECT m.public_profile_id FROM account_public_profiles m WHERE m.owner_account_id=?) AND ${live}`,
          )
          .bind(p.accountId, ...binds(p)),
        // Success means "the owner now has no links", which is also true for a repeated clear.
        this.db
          .prepare(
            `SELECT 1 ok FROM account_public_profiles m WHERE m.owner_account_id=? AND NOT EXISTS(SELECT 1 FROM public_profile_links l WHERE l.public_profile_id=m.public_profile_id) AND ${live}`,
          )
          .bind(p.accountId, ...binds(p)),
      ]);
      return after.results.length === 1 ? { links: [] } : null;
    } catch {
      return null;
    }
  }
  /** Public projection for /api/students and the author card: registered links only. */
  async readPublic(id: string): Promise<ProfileLink[]> {
    if (!slug(id)) return [];
    const rs = await this.db
      .prepare(
        `SELECT l.service,l.url FROM public_profile_links l JOIN public_profiles p ON ${publicVisible} WHERE l.public_profile_id=? ORDER BY l.service LIMIT 4`,
      )
      .bind(id)
      .all<Row>();
    return decode(rs.results);
  }
}
