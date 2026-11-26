import { workerModules } from './helpers/worker-modules';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { ProfileLinkStore } from '../worker/profile-links';
import type { PublicAuthorCard, PublicStudent } from '../src/public-student-types';
import type { ProfileReportCase } from '../src/profile-report-types';

// #313: the owner's X・GitHub・LinkedIn・website links, on the real Worker composition and D1.
const ORIGIN = 'https://app.example.invalid';
const NOW = 1800000000000;
const OPERATOR = 'private-account-4';
type Session = { setCookie: string; contextCookie: string; csrfToken: string };
let mf: Miniflare;
let db: D1Database;
const users: Session[] = [];
const authors: string[] = [];
let article0 = '';
function credentials(index: number, csrf = true) {
  const session = users[index];
  return {
    Cookie: [session.setCookie, session.contextCookie].map((v) => v.split(';')[0]).join('; '),
    Origin: ORIGIN,
    ...(csrf ? { Authorization: 'Bearer csrf.' + session.csrfToken } : {}),
    'Content-Type': 'application/json',
  };
}
async function request(
  path: string,
  method = 'GET',
  who?: number,
  body?: unknown,
  extra: Record<string, string> = {},
) {
  return mf.dispatchFetch(ORIGIN + path, {
    method,
    headers: {
      'X-Test-Ordinary': 'enabled',
      'X-Test-Operators': JSON.stringify([OPERATOR]),
      ...(who === undefined ? {} : credentials(who)),
      ...extra,
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}
const LINKS = '/api/private/profile/links';
const put = (who: number, links: unknown) => request(LINKS, 'PUT', who, { links });
async function own(who: number) {
  const response = await request(LINKS, 'GET', who);
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  return ((await response.json()) as { links: unknown }).links;
}
async function publicStudent(index: number) {
  const response = await request('/api/students/' + authors[index]);
  return { status: response.status, body: (await response.json()) as PublicStudent };
}
async function card(index: number) {
  const response = await request('/api/students/' + authors[index] + '/card');
  return { status: response.status, body: (await response.json()) as PublicAuthorCard };
}
const all = {
  x: 'https://twitter.com/kobe_student',
  github: 'github.com/kobe-student',
  linkedin: 'https://www.linkedin.com/in/kobe-student/',
  website: 'https://Example.com/works',
};
const stored = [
  { service: 'x', url: 'https://x.com/kobe_student' },
  { service: 'github', url: 'https://github.com/kobe-student' },
  { service: 'linkedin', url: 'https://www.linkedin.com/in/kobe-student' },
  { service: 'website', url: 'https://example.com/works' },
];
async function article(who: number) {
  const draft = await request('/api/private/drafts', 'POST', who, {
    title: 'Public article',
    body: '# Public saved body',
  });
  expect(draft.status).toBe(201);
  const { id } = (await draft.json()) as { id: string };
  const published = await request('/api/private/publications/' + id, 'POST', who, {
    expectedVersion: 1,
    confirmPublic: true,
    summary: 'Public summary',
    tags: [],
    minutes: 1,
  });
  expect(published.status).toBe(201);
  return ((await published.json()) as { contentId: string }).contentId;
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: workerModules('.worker/publication-http-test.js'),
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
      outboundService: () => {
        throw Error('Unexpected provider call');
      },
    }),
  );
  db = await mf.getD1Database('DB');
  for (const name of readdirSync('migrations')
    .filter((v) => v.endsWith('.sql'))
    .sort()) {
    const raw = readFileSync('migrations/' + name, 'utf8');
    const statements = raw.includes('-- @statement')
      ? raw.split(/^-- @statement\s*$/m)
      : raw.split(/;\s*(?:\n|$)/);
    for (const statement of statements.map((v) => v.replace(/^--.*$/gm, '').trim()).filter(Boolean))
      await db.prepare(statement).run();
  }
  for (let index = 0; index < 5; index++) {
    await db
      .prepare("INSERT INTO private_accounts VALUES(?,?,?,'active',0,?)")
      .bind('private-account-' + index, 'subject-' + index, index + '@st.kobedenshi.ac.jp', NOW)
      .run();
    const session = await mf.dispatchFetch(ORIGIN + '/fixture/session', {
      headers: { 'X-Test-Who': String(index) },
    });
    users.push((await session.json()) as Session);
    // Account 3 never makes a profile.
    if (index === 3) continue;
    const profile = await request('/api/private/profile', 'POST', index, {
      displayName: 'Link student ' + index,
      bio: 'Explicit public biography',
      confirmPublic: true,
    });
    expect(profile.status).toBe(201);
    authors[index] = ((await profile.json()) as { profile: { id: string } }).profile.id;
  }
  // Author 0 is public (one article). Authors 1 and 2 have a profile but nothing public.
  article0 = await article(0);
});
afterAll(async () => mf?.dispose());

describe('profile links: owner only, accepted shapes only (#313)', () => {
  it('needs a session and an own profile; starts empty; only GET and PUT on the exact path', async () => {
    expect((await request(LINKS)).status).toBe(401);
    expect((await request(LINKS, 'PUT', undefined, { links: {} })).status).toBe(401);
    expect((await request(LINKS, 'GET', 3)).status).toBe(404);
    expect((await put(3, { x: 'x.com/abc' })).status).toBe(404);
    expect(await own(0)).toEqual([]);
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const response = await request(LINKS, method, 0, { links: {} });
      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('GET, PUT');
    }
    for (const path of [LINKS + '?x=1', LINKS + '/x', LINKS + '/'])
      expect((await request(path, 'GET', 0)).status).toBe(404);
    // A write without the CSRF proof is refused before anything is read or stored.
    const noCsrf = await mf.dispatchFetch(ORIGIN + LINKS, {
      method: 'PUT',
      headers: { 'X-Test-Ordinary': 'enabled', ...credentials(0, false) },
      body: JSON.stringify({ links: { x: 'x.com/abc' } }),
    });
    expect([401, 403]).toContain(noCsrf.status);
    expect(await own(0)).toEqual([]);
  });

  it('stores the normalized form of each service and replaces the whole set', async () => {
    const saved = await put(0, all);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ links: stored });
    expect(await own(0)).toEqual(stored);
    // Leaving a service out removes it; the rest are kept as sent.
    const fewer = await put(0, { github: 'https://github.com/kobe-student' });
    expect(await fewer.json()).toEqual({ links: [stored[1]] });
    // An empty set clears everything, and clearing twice is still success.
    for (let i = 0; i < 2; i++) {
      const cleared = await put(0, {});
      expect(cleared.status).toBe(200);
      expect(await cleared.json()).toEqual({ links: [] });
    }
    expect((await put(0, all)).status).toBe(200);
  });

  it('refuses every value outside the accepted shapes with 400 and keeps what was stored', async () => {
    const bad: unknown[] = [
      { x: 'https://x.com/kobe/status/1' },
      { x: 'https://instagram.com/kobe' },
      { github: 'https://github.com/octo/repo' },
      { linkedin: 'https://www.linkedin.com/company/kobe' },
      { website: 'http://example.com' },
      { website: 'javascript:alert(1)' },
      { website: 'https://127.0.0.1/' },
      { website: 'https://user:pw@example.com/' },
      { website: 'https://example.com/' + 'a'.repeat(181) },
      { instagram: 'https://instagram.com/kobe' },
      { x: 1 },
      { x: null },
      [],
      'x.com/abc',
      null,
    ];
    for (const links of bad) {
      const response = await put(0, links);
      expect(response.status, JSON.stringify(links)).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_link' });
    }
    // The body names nothing else: a profile id or an extra key is not accepted.
    for (const body of [
      { links: {}, profileId: authors[1] },
      { profileId: authors[1] },
      { links: {}, extra: true },
    ])
      expect((await request(LINKS, 'PUT', 0, body)).status).toBe(400);
    expect((await request(LINKS, 'PUT', 0, '{')).status).toBe(400);
    expect(await own(0)).toEqual(stored);
  });

  it('changes only the signed-in owner’s links', async () => {
    expect((await put(1, { github: 'github.com/other-person' })).status).toBe(200);
    expect(await own(1)).toEqual([{ service: 'github', url: 'https://github.com/other-person' }]);
    expect(await own(0)).toEqual(stored);
    expect((await put(1, {})).status).toBe(200);
    expect(await own(0)).toEqual(stored);
  });

  it('needs current enrollment to add or change links, but a graduate can still remove them', async () => {
    expect((await put(2, { x: 'x.com/graduate' })).status).toBe(200);
    const period = await db
      .prepare(
        'SELECT admission_year,graduation_year,starts_at_ms,ends_at_ms FROM private_enrollment_periods WHERE owner_account_id=?',
      )
      .bind('private-account-2')
      .first<{
        admission_year: number;
        graduation_year: number;
        starts_at_ms: number;
        ends_at_ms: number;
      }>();
    expect(period).not.toBeNull();
    const setPeriod = (v: NonNullable<typeof period>) =>
      db
        .prepare(
          'UPDATE private_enrollment_periods SET admission_year=?,graduation_year=?,starts_at_ms=?,ends_at_ms=? WHERE owner_account_id=?',
        )
        .bind(
          v.admission_year,
          v.graduation_year,
          v.starts_at_ms,
          v.ends_at_ms,
          'private-account-2',
        )
        .run();
    // Graduated in 2001: the period ended long before NOW.
    await setPeriod({
      admission_year: 2000,
      graduation_year: 2001,
      starts_at_ms: Date.UTC(2000, 3, 1) - 9 * 3600000,
      ends_at_ms: Date.UTC(2002, 3, 1) - 9 * 3600000,
    });
    try {
      expect((await put(2, { x: 'x.com/changed' })).status).toBe(404);
      expect((await put(2, { github: 'github.com/added' })).status).toBe(404);
      expect(await own(2)).toEqual([{ service: 'x', url: 'https://x.com/graduate' }]);
      const cleared = await put(2, {});
      expect(cleared.status).toBe(200);
      expect(await own(2)).toEqual([]);
    } finally {
      await setPeriod(period!);
    }
  });

  it('keeps D1 itself to the service prefixes and to active non-sample owners', async () => {
    const insert = (profile: string, service: string, url: string) =>
      db
        .prepare(
          'INSERT INTO public_profile_links(public_profile_id,service,url,updated_at_ms) VALUES(?,?,?,?)',
        )
        .bind(profile, service, url, NOW)
        .run();
    await expect(insert(authors[1], 'website', 'javascript:alert(1)')).rejects.toThrow();
    await expect(insert(authors[1], 'x', 'https://evil.example/x.com/a')).rejects.toThrow();
    await expect(insert(authors[1], 'instagram', 'https://instagram.com/a')).rejects.toThrow();
    await expect(insert(authors[1], 'website', 'https://exa mple.com/')).rejects.toThrow();
    await expect(insert('sample-a', 'x', 'https://x.com/sample')).rejects.toThrow();
    await expect(
      db
        .prepare(
          "UPDATE public_profile_links SET public_profile_id=? WHERE public_profile_id=? AND service='x'",
        )
        .bind(authors[1], authors[0])
        .run(),
    ).rejects.toThrow();
  });
});

describe('profile links in public reads (#313)', () => {
  it('adds only the registered links to the student page and the author card', async () => {
    const student = await publicStudent(0);
    expect(student.status).toBe(200);
    expect(Object.keys(student.body).sort()).toEqual([
      'author',
      'avatar',
      'entries',
      'links',
      'projects',
    ]);
    expect(student.body.links).toEqual(stored);
    const authorCard = await card(0);
    expect(authorCard.status).toBe(200);
    expect(authorCard.body.links).toEqual(stored);
    expect((await put(0, { website: all.website })).status).toBe(200);
    expect((await publicStudent(0)).body.links).toEqual([stored[3]]);
    expect((await card(0)).body.links).toEqual([stored[3]]);
    expect((await put(0, all)).status).toBe(200);
  });

  it('serves no links for a profile that is not public, and none once its works stop', async () => {
    expect((await put(1, { github: 'github.com/not-public' })).status).toBe(200);
    expect((await publicStudent(1)).status).toBe(404);
    expect((await card(1)).status).toBe(404);
    const store = new ProfileLinkStore(db, ORIGIN, () => NOW);
    expect(await store.readPublic(authors[1])).toEqual([]);
    expect(await store.readPublic(authors[0])).toEqual(stored);
    // A stored row that no longer fits its shape is left out, not shown as a link.
    await db
      .prepare(
        "UPDATE public_profile_links SET url='https://x.com/home' WHERE public_profile_id=? AND service='x'",
      )
      .bind(authors[0])
      .run();
    expect(await store.readPublic(authors[0])).toEqual(stored.slice(1));
    expect((await put(0, all)).status).toBe(200);
    // While the only article is hidden by moderation, the profile and its links are not public.
    await db.prepare("UPDATE content SET status='hidden' WHERE id=?").bind(article0).run();
    try {
      expect((await publicStudent(0)).status).toBe(404);
      expect((await card(0)).status).toBe(404);
      expect(await store.readPublic(authors[0])).toEqual([]);
    } finally {
      await db.prepare("UPDATE content SET status='published' WHERE id=?").bind(article0).run();
    }
    expect((await publicStudent(0)).body.links).toEqual(stored);
  });
});

describe('profile links in the report record (#313)', () => {
  it('records the links the reporter saw, shows them to the operator, and never rewrites them', async () => {
    const reported = await request('/api/private/profile-reports/' + authors[0], 'POST', 2, {
      reason: 'Suspicious link',
    });
    expect(reported.status).toBe(201);
    const row = await db
      .prepare(
        'SELECT links_json FROM profile_reports WHERE public_profile_id=? AND reporter_account_id=?',
      )
      .bind(authors[0], 'private-account-2')
      .first<{ links_json: string }>();
    expect(JSON.parse(row!.links_json)).toEqual(stored);
    // A report from the previous Worker (no links column written) stays readable as "not recorded".
    await db
      .prepare(
        "INSERT INTO profile_reports(id,public_profile_id,reporter_account_id,reason,detail,display_name,department,year_label,bio,created_at_ms) SELECT '00000000-0000-4000-8000-000000000313',p.id,'private-account-1','Older report','',p.display_name,p.department,p.year_label,p.bio,? FROM public_profiles p WHERE p.id=?",
      )
      .bind(NOW - 1000, authors[0])
      .run();
    // Later the owner changes the links; the record keeps what was reported.
    expect((await put(0, { github: all.github })).status).toBe(200);
    const view = await request('/api/private/profile-moderation/cases/' + authors[0], 'GET', 4);
    expect(view.status).toBe(200);
    const value = (await view.json()) as ProfileReportCase;
    expect(value.links).toEqual([stored[1]]);
    expect(value.reports.map((r) => r.reported.links)).toEqual([stored, null]);
    // The snapshot can neither be rewritten nor inserted with links that were not there.
    await expect(
      db
        .prepare("UPDATE profile_reports SET links_json='[]' WHERE public_profile_id=?")
        .bind(authors[0])
        .run(),
    ).rejects.toThrow(/immutable/);
    await expect(
      db
        .prepare(
          "INSERT INTO profile_reports(id,public_profile_id,reporter_account_id,reason,detail,display_name,department,year_label,bio,links_json,created_at_ms) SELECT '00000000-0000-4000-8000-000000000314',p.id,'private-account-3','Forged','',p.display_name,p.department,p.year_label,p.bio,'[]',? FROM public_profiles p WHERE p.id=?",
        )
        .bind(NOW, authors[0])
        .run(),
    ).rejects.toThrow(/unavailable/);
    expect((await put(0, all)).status).toBe(200);
  });
});
