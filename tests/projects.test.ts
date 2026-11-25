import { SESSION_IDLE_MS } from '../worker/auth/sessions';
import { applyFixtureMigrations } from './helpers/migrations';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import {
  hasVisibleCharacter,
  normalizeProjectFields,
  oneLineRejectedCodePoint,
} from '../src/project-input';
import type {
  ProjectDraft,
  PublicProjectReader,
  PublicProjectDiscovery,
} from '../src/project-types';
import { withProjectSnapshotUnlocked } from './helpers/project-snapshot';
const O = 'https://app.example.invalid',
  NOW = 1800000000000;
let mf: Miniflare;
type Session = { setCookie: string; contextCookie: string; csrfToken: string };
let users: Session[];
const f = {
  title: 'Standalone project',
  description: 'Plain saved description',
  githubUrl: 'https://github.com',
  demoUrl: '',
};
const h = (n = 0) => ({
  Cookie: [users[n].setCookie, users[n].contextCookie].map((v) => v.split(';')[0]).join('; '),
  Origin: O,
  Authorization: 'Bearer csrf.' + users[n].csrfToken,
  'Content-Type': 'application/json',
});
async function req(
  path: string,
  method = 'GET',
  input?: unknown,
  n = 0,
  extra: Record<string, string> = {},
) {
  const r = await mf.dispatchFetch(O + path, {
    method,
    headers: { ...h(n), ...extra },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  if (path.startsWith('/api/')) {
    expect(r.headers.get('Cache-Control')).toBe('private, no-store');
    expect(r.headers.get('Vary')).toBe('Cookie');
    expect(r.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(r.headers.has('Set-Cookie')).toBe(false);
  }
  return r;
}
async function create(input: unknown = f, n = 0) {
  return (await (
    await req('/api/private/project-drafts', 'POST', input, n)
  ).json()) as ProjectDraft;
}
async function publish(d: ProjectDraft, n = 0) {
  return await req(
    '/api/private/project-publications/' + d.id,
    'POST',
    { expectedVersion: d.version, confirmPublic: true },
    n,
  );
}
async function publicRead(id: string) {
  return (await (await req('/public/project/' + id)).json()) as PublicProjectReader | null;
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: '.worker/projects-test.js',
      compatibilityDate: '2026-11-03',
      d1Databases: ['DB'],
    }),
  );
  const db = await mf.getD1Database('DB');
  await applyFixtureMigrations(db);
  users = [];
  for (let n = 0; n < 3; n++) {
    await db
      .prepare(
        "INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)",
      )
      .bind('account-' + n, 'subject-' + n, n + '@st.kobedenshi.ac.jp', NOW)
      .run();
    users.push(
      (await (
        await mf.dispatchFetch(O + '/fixture/session', { headers: { 'X-Test-Who': String(n) } })
      ).json()) as Session,
    );
    if (n < 2)
      expect(
        (
          await req(
            '/fixture/profile',
            'POST',
            {
              displayName: 'Project author ' + n,
              department: 'Explicit',
              yearLabel: 'Manual',
              bio: 'Public biography',
              confirmPublic: true,
            },
            n,
          )
        ).status,
      ).toBe(200);
  }
});
afterAll(async () => {
  await mf?.dispose();
});
it('normalizes optional HTTPS links without fetching and rejects unsafe/oversized malformed input', () => {
  expect(normalizeProjectFields(f)?.githubUrl).toBe('https://github.com/');
  for (const url of [
    'http://example.invalid',
    'javascript:alert(1)',
    'https://u:p@example.invalid',
    'https://example.invalid/ bad',
    'https://example.invalid/\\bad',
    'https://example.invalid/\u0000',
  ])
    expect(normalizeProjectFields({ ...f, demoUrl: url })).toBeNull();
  for (const v of [
    { ...f, title: '\ud800' },
    { ...f, description: 'x'.repeat(4001) },
    { ...f, title: '😀'.repeat(201) },
    { ...f, owner: 'account-1' },
  ])
    expect(normalizeProjectFields(v)).toBeNull();
});
it('accepts an optional one-line technologies text and always returns it', () => {
  expect(normalizeProjectFields(f)?.technologies).toBe('');
  expect(normalizeProjectFields({ ...f, technologies: 'React、Hono' })?.technologies).toBe(
    'React、Hono',
  );
  for (const technologies of ['a\nb', 'tab\there', 'x'.repeat(101), 1, null, '\ud800'])
    expect(normalizeProjectFields({ ...f, technologies })).toBeNull();
  expect(normalizeProjectFields({ ...f, technologies: '', owner: 'x' })).toBeNull();
});
it('keeps one-line fields free of separators, bidi and invisible format characters on input only (#177)', () => {
  const bad = [
    '\u2028',
    '\u2029',
    '\u202e',
    '\u202a',
    '\u2066',
    '\u200b',
    '\u200e',
    '\u2060',
    '\ufeff',
    '\u061c',
    // #255: soft hyphen, tag characters and other \p{Cf}, and Hangul fillers that render blank.
    '\u00ad',
    '\u{e0001}',
    '\u{e0041}',
    '\u{e007f}',
    '\u{1d173}',
    '\u0600',
    '\u3164',
    '\uffa0',
    '\u{1f3f4}\u{e0067}\u{e0062}', // a flag tag run that never ends with CANCEL TAG
    // #255 verifier P3: a flag-shaped tag run that is not one of the three RGI flags hides text.
    '\u{1f3f4}' +
      [...'ignoreallrules'].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('') +
      '\u{e007f}',
    // #257: Default_Ignorable code points, braille blank, private use, noncharacters, detached and stacked marks.
    '\u034f',
    '\u180b',
    '\u180f',
    '\u17b4',
    '\ufff0',
    '\u{1bca0}',
    '\u2800',
    '\ue000',
    '\u{f0000}',
    '\u{10fffd}',
    '\ufdd0',
    '\ufffe',
    '\uffff',
    '\u{1fffe}',
    '\u{10ffff}',
    ' \ufe0f',
    ' \u{e0100}',
    ' \u0301',
    'a\u0301\u0301\u0301\u0301\u0301',
    'a\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f',
  ];
  for (const c of [...bad, '\u{e0100}', '\u0301']) {
    // A lone mark at the very start attaches to nothing.
    expect(normalizeProjectFields({ ...f, title: c + 'Title' }), JSON.stringify(c)).toBeNull();
    expect(oneLineRejectedCodePoint(c + 'Title')).toMatch(/^U\+[0-9A-F]{4,6}$/);
  }
  expect(oneLineRejectedCodePoint('a\u034fb')).toBe('U+034F');
  expect(oneLineRejectedCodePoint(' \u{e0100}')).toBe('U+E0100');
  for (const c of bad) {
    expect(normalizeProjectFields({ ...f, technologies: 'React' + c + 'Hono' })).toBeNull();
    expect(normalizeProjectFields({ ...f, title: 'Title' + c })).toBeNull();
    // Rows saved before the rule still read back unchanged.
    expect(
      normalizeProjectFields({ ...f, title: 'Title' + c, technologies: 'a' + c }, 'stored'),
    ).toMatchObject({ title: 'Title' + c, technologies: 'a' + c });
  }
  for (const title of ['a\nb', 'tab\there', 'del\u007f'])
    expect(normalizeProjectFields({ ...f, title })).toBeNull();
  // Emoji ZWJ sequences, ZWNJ and the description's own line breaks stay allowed.
  expect(
    normalizeProjectFields({
      ...f,
      title: '家族👨\u200d👩\u200d👧',
      technologies: 'a\u200cb',
      description: 'line1\nline2\u2028',
    }),
  ).not.toBeNull();
  // A complete subdivision flag (🏴 + tag letters + CANCEL TAG) and emoji variation selectors stay allowed.
  expect(
    normalizeProjectFields({
      ...f,
      title: 'Wales \u{1f3f4}\u{e0067}\u{e0062}\u{e0077}\u{e006c}\u{e0073}\u{e007f} ❤\ufe0f',
    }),
  ).not.toBeNull();
  // Kanji variation sequences (IVS), keycaps, Japanese combining voiced marks and Thai stacked marks stay allowed.
  for (const title of [
    '葛\u{e0100}城',
    '1\ufe0f\u20e3',
    'か\u3099',
    'ที่\u0e48',
    'café\u0301',
    '🏳\ufe0f\u200d🌈',
  ])
    expect(normalizeProjectFields({ ...f, title }), title).not.toBeNull();
  expect(oneLineRejectedCodePoint('葛\u{e0100}城 ❤\ufe0f')).toBeNull();
  // The description is multi-line Markdown and is not a one-line field.
  expect(normalizeProjectFields({ ...f, description: 'x\u202ey' })).not.toBeNull();
});
it('does not let ZWJ/ZWNJ hide stacked or detached marks or stand alone in a one-line field (#261)', () => {
  const stacked = 'a' + '\u0301\u200c'.repeat(60);
  for (const [value, code] of [
    [stacked, 'U+0301'],
    ['a' + '\u0301\u200d'.repeat(5), 'U+0301'],
    ['a' + '\ufe0f\u200c'.repeat(5), 'U+FE0F'],
    ['\u200d', 'U+200D'],
    ['\u200c\u200d\u200c', 'U+200C'],
    [' \u200d', 'U+200D'],
    ['Title \u200c', 'U+200C'],
    ['a\u200d\u200dB', 'U+200D'],
    ['a\u200c\u200cB', 'U+200C'],
  ] as const) {
    expect(oneLineRejectedCodePoint(value), JSON.stringify(value)).toBe(code);
    expect(normalizeProjectFields({ ...f, title: value }), JSON.stringify(value)).toBeNull();
    expect(normalizeProjectFields({ ...f, technologies: value }), JSON.stringify(value)).toBeNull();
    // Rows saved before the rule still read back unchanged.
    expect(normalizeProjectFields({ ...f, title: value }, 'stored')?.title).toBe(value);
  }
  // A joiner never gives a mark its base: the mark after a space stays detached.
  expect(oneLineRejectedCodePoint('a\u200d \u0301')).toBe('U+0301');
  // Legitimate joiners between visible characters stay allowed: emoji ZWJ sequences, Persian and Indic ZWNJ/ZWJ.
  for (const title of [
    '家族👨\u200d👩\u200d👧\u200d👦',
    '❤\ufe0f\u200d🔥',
    '🏳\ufe0f\u200d🌈',
    '👩🏽\u200d💻',
    'می\u200cخواهم',
    'क्\u200dष',
    'ශ්\u200dරී',
    'ण्\u200c',
  ])
    expect(oneLineRejectedCodePoint(title), title).toBeNull();
});
it('saves standalone drafts, enforces owner/CAS and lists metadata only', async () => {
  const d = await create();
  expect(d).toMatchObject({ ...f, githubUrl: 'https://github.com/', version: 1 });
  expect((await req('/api/private/project-drafts/' + d.id, 'GET', undefined, 1)).status).toBe(404);
  const results = await Promise.all(
    [0, 1].map(() =>
      req('/api/private/project-drafts/' + d.id, 'PUT', {
        ...f,
        title: 'Changed',
        expectedVersion: 1,
      }),
    ),
  );
  expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
  const list = (await (await req('/api/private/project-drafts')).json()) as object[];
  expect(list.length).toBeGreaterThan(0);
  expect(Object.keys(list[0]).sort()).toEqual(['id', 'title', 'updatedAt', 'version']);
});
it('distinguishes genuine empty discovery and storage failure', async () => {
  expect(await (await req('/public/discovery')).json()).toEqual({ cards: [] });
  expect(
    await (
      await req('/public/discovery', 'GET', undefined, 0, { 'X-Test-Discovery-Fault': '1' })
    ).json(),
  ).toBeNull();
});
it('publishes only explicit saved snapshots and preserves original after edit and repeated publication', async () => {
  const d = await create();
  expect(await (await req('/api/private/project-publications/' + d.id)).json()).toEqual({
    publication: null,
  });
  const ids = await Promise.all(
    Array.from({ length: 12 }, async () => {
      const response = await publish(d);
      expect(response.status).toBe(201);
      return ((await response.json()) as { projectId: string }).projectId;
    }),
  );
  expect(new Set(ids).size).toBe(1);
  const reader = await publicRead(ids[0]);
  expect(reader?.project).toMatchObject({
    title: f.title,
    description: f.description,
    githubUrl: 'https://github.com/',
    publishedOn: '2027-01-15',
  });
  expect(JSON.stringify(reader)).not.toMatch(
    /account-0|subject-0|sourceVersion|owner_account|draft_id|minutes|report/,
  );
  await req('/api/private/project-drafts/' + d.id, 'PUT', {
    ...f,
    title: 'Private newer',
    expectedVersion: 1,
  });
  expect((await publish(d)).status).toBe(201);
  expect((await publicRead(ids[0]))?.project.title).toBe(f.title);
  const receipt = (await (await req('/api/private/project-publications/' + d.id)).json()) as {
    publication: { sourceVersion: number };
  };
  expect(receipt.publication.sourceVersion).toBe(1);
  expect((await req('/api/private/project-publications/' + d.id, 'GET', undefined, 1)).status).toBe(
    404,
  );
  expect(
    (
      await req('/api/private/project-publications/' + d.id, 'POST', {
        expectedVersion: 2,
        confirmPublic: true,
      })
    ).status,
  ).toBe(404);
});
it('refuses blank/stale/missing-profile and client-controlled publication fields', async () => {
  const blank = await create({ ...f, description: ' ' });
  expect((await publish(blank)).status).toBe(404);
  const d = await create(f, 2);
  expect((await publish(d, 2)).status).toBe(404);
  for (const input of [
    { expectedVersion: 1, confirmPublic: false },
    { expectedVersion: 2, confirmPublic: true },
    { expectedVersion: 1, confirmPublic: true, title: 'client' },
  ])
    expect((await req('/api/private/project-publications/' + d.id, 'POST', input, 2)).status).toBe(
      404,
    );
});
it('freshly hides projects and refuses receipt/replay without restoring; deleted draft snapshot persists', async () => {
  const d = await create(),
    id = ((await (await publish(d)).json()) as { projectId: string }).projectId,
    db = await mf.getD1Database('DB');
  await db.prepare("UPDATE project_publications SET status='hidden' WHERE id=?").bind(id).run();
  expect(await publicRead(id)).toBeNull();
  expect((await req('/api/private/project-publications/' + d.id)).status).toBe(404);
  expect((await publish(d)).status).toBe(404);
  const other = await create(),
    pub = ((await (await publish(other)).json()) as { projectId: string }).projectId;
  await db.prepare('DELETE FROM project_drafts WHERE id=?').bind(other.id).run();
  expect(await publicRead(pub)).not.toBeNull();
});
it('rejects changed browser generation across private project read/write/receipt paths', async () => {
  const login = async () => {
    users[0] = (await (
      await mf.dispatchFetch(O + '/fixture/session', { headers: { 'X-Test-Who': '0' } })
    ).json()) as Session;
  };
  await login();
  const d = await create(),
    base = '/api/private/project-drafts',
    pub = '/api/private/project-publications/' + d.id;
  for (const [path, method, input] of [
    [base, 'POST', f],
    [base, 'GET', undefined],
    [base + '/' + d.id, 'GET', undefined],
    [base + '/' + d.id, 'PUT', { ...f, title: 'denied', expectedVersion: 1 }],
    [pub, 'POST', { expectedVersion: 1, confirmPublic: true }],
    [pub, 'GET', undefined],
  ] as const) {
    await login();
    const r = await req(path, method, input, 0, {
      'X-Test-Race': 'context',
      'X-Test-Race-At': path === pub && method === 'POST' ? '3' : '2',
    });
    expect(r.status).toBe(404);
    const db = await mf.getD1Database('DB');
    expect(
      (await db
        .prepare('SELECT version FROM project_drafts WHERE id=?')
        .bind(d.id)
        .first<{ version: number }>())!.version,
    ).toBe(1);
    expect(
      (await db
        .prepare('SELECT count(*) n FROM project_publications WHERE draft_id=?')
        .bind(d.id)
        .first<{ n: number }>())!.n,
    ).toBe(0);
  }
  await login();
});
it('requires session CSRF and live final SQL after authorization', async () => {
  for (const extra of [
    { Cookie: '' },
    { Origin: 'https://evil.invalid' },
    { Authorization: 'Bearer csrf.' + users[1].csrfToken },
  ] as Record<string, string>[])
    expect((await req('/api/private/project-drafts', 'POST', f, 0, extra)).status).toBe(401);
  expect(
    (
      await req('/api/private/project-drafts', 'POST', f, 0, {
        'X-Test-Now': String(NOW + SESSION_IDLE_MS),
      })
    ).status,
  ).toBe(401);
  expect(
    (await req('/api/private/project-drafts', 'POST', f, 2, { 'X-Test-Race': 'revoke' })).status,
  ).toBe(404);
  for (let n = 0; n < 3; n++)
    users[n] = (await (
      await mf.dispatchFetch(O + '/fixture/session', { headers: { 'X-Test-Who': String(n) } })
    ).json()) as Session;
});
it('bounds HTTP media/input/routes and does not reflect invalid payloads', async () => {
  expect(
    (await req('/api/private/project-drafts', 'POST', f, 0, { 'Content-Type': 'text/plain' }))
      .status,
  ).toBe(415);
  expect(
    (await req('/api/private/project-drafts', 'POST', { ...f, description: 'x'.repeat(33000) }))
      .status,
  ).toBe(413);
  expect((await req('/api/private/project-drafts?PRIVATE=1')).status).toBe(404);
  expect((await req('/api/private/project-drafts', 'DELETE')).headers.get('Allow')).toBe(
    'GET, POST',
  );
  expect(
    (
      await req('/api/private/project-drafts', 'GET', undefined, 0, {
        'X-Test-Origin': 'http://invalid.example',
      })
    ).status,
  ).toBe(503);
});
it('bounds stalled and empty chunk bodies without a late saved record', async () => {
  const db = await mf.getD1Database('DB');
  const count = async () =>
    await db.prepare('SELECT count(*) n FROM project_drafts').first<{ n: number }>();
  const before = await count();
  expect(
    (await req('/api/private/project-drafts', 'POST', undefined, 0, { 'X-Test-Body': 'empty' }))
      .status,
  ).toBe(413);
  const start = Date.now();
  expect(
    (await req('/api/private/project-drafts', 'POST', undefined, 0, { 'X-Test-Body': 'late' }))
      .status,
  ).toBe(408);
  expect(Date.now() - start).toBeLessThan(6500);
  await new Promise((r) => setTimeout(r, 700));
  expect(await count()).toEqual(before);
}, 8000);
it('rolls back refused publication inserts and denies malformed profile projections', async () => {
  const db = await mf.getD1Database('DB');
  const d = await create();
  await db
    .prepare(
      "CREATE TRIGGER fixture_project_abort BEFORE INSERT ON project_publications BEGIN SELECT RAISE(ABORT,'fixture'); END",
    )
    .run();
  try {
    expect((await publish(d)).status).toBe(404);
    expect(await (await req('/api/private/project-publications/' + d.id)).json()).toEqual({
      publication: null,
    });
  } finally {
    await db.prepare('DROP TRIGGER fixture_project_abort').run();
  }
  const id = ((await (await publish(d)).json()) as { projectId: string }).projectId;
  const profile = await db
    .prepare(
      "SELECT public_profile_id id FROM account_public_profiles WHERE owner_account_id='account-0'",
    )
    .first<{ id: string }>();
  await db
    .prepare('UPDATE public_profiles SET bio=? WHERE id=?')
    .bind('x'.repeat(801), profile!.id)
    .run();
  expect(await publicRead(id)).toBeNull();
  expect((await req('/api/private/project-publications/' + d.id)).status).toBe(404);
  expect((await publish(d)).status).toBe(404);
  await db
    .prepare('UPDATE public_profiles SET bio=? WHERE id=?')
    .bind('Public biography', profile!.id)
    .run();
  await db.prepare("UPDATE project_publications SET status='deleted' WHERE id=?").bind(id).run();
  expect(await publicRead(id)).toBeNull();
  expect((await publish(d)).status).toBe(404);
});
// 22 create+publish+unlock round trips: 5 s timed out on a loaded CI runner (#266).
it('discovers newest20 immutable cross-author snapshots with short DTOs and fresh stop exclusion', async () => {
  const db = await mf.getD1Database('DB');
  await db.prepare("UPDATE project_publications SET status='hidden'").run();
  await db
    .prepare("INSERT INTO public_profiles VALUES('orphan-project-profile','Orphan','','','','O',0)")
    .run();
  const expected: { id: string; time: number; owner: number; draft: ProjectDraft }[] = [];
  for (let n = 0; n < 22; n++) {
    const owner = n % 2,
      d = await create(
        {
          ...f,
          title: 'Discovered ' + n,
          description: 'Description ' + n + '😀'.repeat(320),
          githubUrl: 'https://example.invalid/source',
          demoUrl: 'https://example.invalid/demo',
        },
        owner,
      );
    const id = ((await (await publish(d, owner)).json()) as { projectId: string }).projectId,
      time = NOW + Math.floor(n / 2);
    await withProjectSnapshotUnlocked(db, () =>
      db
        .prepare('UPDATE project_publications SET published_at_ms=? WHERE id=?')
        .bind(time, id)
        .run(),
    );
    expected.push({ id, time, owner, draft: d });
  }
  const ordered = [...expected].sort((a, b) => b.time - a.time || a.id.localeCompare(b.id));
  const read = async (extra: Record<string, string> = {}) =>
    (await (
      await req('/public/discovery', 'GET', undefined, 0, extra)
    ).json()) as PublicProjectDiscovery | null;
  let result = (await read())!;
  expect(result.cards.map((c) => c.project.id)).toEqual(ordered.slice(0, 20).map((e) => e.id));
  for (const card of result.cards) {
    const source = expected.find((e) => e.id === card.project.id)!;
    expect(card.author.name).toBe('Project author ' + source.owner);
    expect(Array.from(card.project.descriptionPreview).length).toBe(300);
    expect(Object.keys(card.project).sort()).toEqual([
      'descriptionPreview',
      'id',
      'publishedOn',
      'stage',
      'title',
    ]);
    expect(card.project.stage).toBe('complete');
    expect(Object.keys(card.author).sort()).toEqual([
      'department',
      'id',
      'initials',
      'name',
      'year',
    ]);
  }
  for (const marker of [
    'githubUrl',
    'demoUrl',
    'biography',
    'account-',
    'subject-',
    'sourceVersion',
    'draft_id',
    'st.kobedenshi',
    'orphan-project-profile',
  ])
    expect(JSON.stringify(result)).not.toContain(marker);
  expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(262144);
  const first = ordered[0];
  await req(
    '/api/private/project-drafts/' + first.draft.id,
    'PUT',
    { ...f, title: 'UNSAVED PUBLIC DRIFT', expectedVersion: 1 },
    first.owner,
  );
  expect((await read())!.cards[0].project.title).not.toBe('UNSAVED PUBLIC DRIFT');
  await withProjectSnapshotUnlocked(db, () =>
    db
      .prepare('UPDATE project_publications SET published_at_ms=? WHERE id=?')
      .bind(NOW, first.id)
      .run(),
  );
  expect(
    (
      (await (
        await req(
          '/fixture/stop/' + first.id,
          'POST',
          { expectedSourceVersion: 1, confirmStop: true },
          first.owner,
        )
      ).json()) as { stopped: boolean }
    ).stopped,
  ).toBe(true);
  expect((await read())!.cards.map((c) => c.project.id)).not.toContain(first.id);
  expect(
    (await db
      .prepare('SELECT title FROM project_publications WHERE id=?')
      .bind(first.id)
      .first<{ title: string }>())!.title,
  ).toBe(first.draft.title);
  const selected = (await read())!.cards[0].project.id;
  const selectedProfile = (await db
    .prepare('SELECT public_profile_id id FROM project_publications WHERE id=?')
    .bind(selected)
    .first<{ id: string }>())!.id;
  await db.prepare('UPDATE public_profiles SET is_sample=1 WHERE id=?').bind(selectedProfile).run();
  expect(await read()).toBeNull();
  await db.prepare('UPDATE public_profiles SET is_sample=0 WHERE id=?').bind(selectedProfile).run();
  await withProjectSnapshotUnlocked(db, () =>
    db
      .prepare('UPDATE project_publications SET description=? WHERE id=?')
      .bind('bad\0text', selected)
      .run(),
  );
  expect(await read()).toBeNull();
  await withProjectSnapshotUnlocked(db, () =>
    db
      .prepare('UPDATE project_publications SET description=? WHERE id=?')
      .bind('Restored description', selected)
      .run(),
  );
  expect(await read({ 'X-Test-Discovery-Race': '1' })).toBeNull();
  expect(await read({ 'X-Test-Discovery-Fault': '1' })).toBeNull();
}, 30_000);
// Same 22-row setup as above (#266).
it('bounds author list newest20, rejects corrupt snapshots and fails storage errors closed', async () => {
  const db = await mf.getD1Database('DB');
  await db.prepare("UPDATE project_publications SET status='hidden'").run();
  const ids: string[] = [];
  for (let n = 0; n < 22; n++) {
    const d = await create({ ...f, title: 'Project ' + n }, 1);
    const id = ((await (await publish(d, 1)).json()) as { projectId: string }).projectId;
    ids.push(id);
    await withProjectSnapshotUnlocked(db, () =>
      db
        .prepare('UPDATE project_publications SET published_at_ms=? WHERE id=?')
        .bind(NOW + n, id)
        .run(),
    );
  }
  const profile = await db
    .prepare(
      "SELECT public_profile_id id FROM account_public_profiles WHERE owner_account_id='account-1'",
    )
    .first<{ id: string }>();
  const url = '/public/author/' + profile!.id;
  const result = (await (await req(url)).json()) as {
    projects: { id: string; descriptionPreview: string }[];
  };
  expect(result.projects.map((p) => p.id)).toEqual(ids.slice(-20).reverse());
  await withProjectSnapshotUnlocked(db, () =>
    db
      .prepare('UPDATE project_publications SET description=? WHERE id=?')
      .bind('bad\0text', ids[21])
      .run(),
  );
  expect(await (await req(url)).json()).toBeNull();
  await withProjectSnapshotUnlocked(db, () =>
    db
      .prepare('UPDATE project_publications SET description=? WHERE id=?')
      .bind('Restored valid description', ids[21])
      .run(),
  );
  expect(await (await req(url)).json()).not.toBeNull();
  expect(
    await (await req(url, 'GET', undefined, 0, { 'X-Test-Discovery-Fault': '1' })).json(),
  ).toBeNull();
}, 30_000);
it('publishes 制作中／完成 on the snapshot and lets only the owner switch it (#275)', async () => {
  const db = await mf.getD1Database('DB');
  // An older page publishes without a stage: the project is complete, as before.
  const legacy = await create({ ...f, title: 'Legacy stage' });
  const legacyId = ((await (await publish(legacy)).json()) as { projectId: string }).projectId;
  expect((await publicRead(legacyId))?.project.stage).toBe('complete');
  for (const stage of ['done', '', null, 1, 'COMPLETE'])
    expect(
      (
        await req('/api/private/project-publications/' + (await create()).id, 'POST', {
          expectedVersion: 1,
          confirmPublic: true,
          stage,
        })
      ).status,
    ).toBe(404);
  const d = await create({ ...f, title: 'Work in progress' });
  const r = await req('/api/private/project-publications/' + d.id, 'POST', {
    expectedVersion: 1,
    confirmPublic: true,
    stage: 'in_progress',
  });
  expect(r.status).toBe(201);
  const { projectId } = (await r.json()) as { projectId: string };
  const reader = (await publicRead(projectId))!;
  expect(reader.project.stage).toBe('in_progress');
  // The public page DTO gains exactly one key.
  expect(Object.keys(reader.project).sort()).toEqual([
    'demoUrl',
    'description',
    'githubUrl',
    'id',
    'publishedOn',
    'stage',
    'technologies',
    'title',
  ]);
  const before = await db
    .prepare('SELECT * FROM project_publications WHERE id=?')
    .bind(projectId)
    .first<Record<string, unknown>>();
  const path = '/api/private/project-publications/' + d.id;
  // Another student, a student without the draft, malformed bodies and GET-only routes change nothing.
  for (const [input, n] of [
    [{ stage: 'complete' }, 1],
    [{ stage: 'complete' }, 2],
    [{ stage: 'done' }, 0],
    [{ stage: 'complete', title: 'client' }, 0],
    [{}, 0],
    [['complete'], 0],
  ] as const)
    expect((await req(path, 'PUT', input, n)).status).toBe(404);
  expect(
    (
      await mf.dispatchFetch(O + path, {
        method: 'PUT',
        headers: { Origin: O, 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: 'complete' }),
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await req(path, 'PUT', { stage: 'complete' }, 0, {
        Authorization: 'Bearer csrf.' + 'x'.repeat(43),
      })
    ).status,
  ).toBe(401);
  expect((await req('/api/private/project-drafts', 'PUT', { stage: 'complete' })).status).toBe(405);
  expect((await publicRead(projectId))?.project.stage).toBe('in_progress');
  // The owner switches it; the snapshot text stays the same and the receipt shows the new stage.
  const switched = await req(path, 'PUT', { stage: 'complete' });
  expect(switched.status).toBe(200);
  const receipt = (await switched.json()) as {
    publication: { projectId: string; project: { stage: string; title: string } };
  };
  expect(receipt.publication.projectId).toBe(projectId);
  expect(receipt.publication.project).toMatchObject({
    stage: 'complete',
    title: 'Work in progress',
  });
  expect((await publicRead(projectId))?.project.stage).toBe('complete');
  const after = await db
    .prepare('SELECT * FROM project_publications WHERE id=?')
    .bind(projectId)
    .first<Record<string, unknown>>();
  expect({ ...after, stage: before!.stage }).toEqual(before);
  expect((await req(path, 'PUT', { stage: 'in_progress' })).status).toBe(200);
  // The works list and the author list carry the stage.
  await db
    .prepare("UPDATE project_publications SET status='hidden' WHERE id<>?")
    .bind(projectId)
    .run();
  const works = (await (await req('/public/discovery')).json()) as PublicProjectDiscovery;
  expect(works.cards.find((c) => c.project.id === projectId)?.project.stage).toBe('in_progress');
  const profile = await db
    .prepare(
      "SELECT public_profile_id id FROM account_public_profiles WHERE owner_account_id='account-0'",
    )
    .first<{ id: string }>();
  const author = (await (await req('/public/author/' + profile!.id)).json()) as {
    projects: { id: string; stage: string }[];
  };
  expect(author.projects.find((p) => p.id === projectId)?.stage).toBe('in_progress');
  // A stopped (hidden) project can no longer be switched by anyone.
  expect(
    (
      (await (
        await req('/fixture/stop/' + projectId, 'POST', {
          expectedSourceVersion: 1,
          confirmStop: true,
        })
      ).json()) as { stopped: boolean }
    ).stopped,
  ).toBe(true);
  expect((await req(path, 'PUT', { stage: 'complete' })).status).toBe(404);
  expect(
    (await db
      .prepare('SELECT stage FROM project_publications WHERE id=?')
      .bind(projectId)
      .first<{ stage: string }>())!.stage,
  ).toBe('in_progress');
  // A snapshot the owner cannot read back (here an oversized stored title) is refused without a write.
  const damaged = await create({ ...f, title: 'Damaged later' });
  const damagedId = ((await (await publish(damaged)).json()) as { projectId: string }).projectId;
  await withProjectSnapshotUnlocked(db, () =>
    db
      .prepare('UPDATE project_publications SET title=? WHERE id=?')
      .bind('x'.repeat(900), damagedId)
      .run(),
  );
  expect(
    (await req('/api/private/project-publications/' + damaged.id, 'PUT', { stage: 'in_progress' }))
      .status,
  ).toBe(404);
  expect(
    (await db
      .prepare('SELECT stage FROM project_publications WHERE id=?')
      .bind(damagedId)
      .first<{ stage: string }>())!.stage,
  ).toBe('complete');
  // A row only the decoder refuses (a blank title) is refused by the receipt check, also without a write.
  const blank = await create({ ...f, title: 'Blank later' });
  const blankId = ((await (await publish(blank)).json()) as { projectId: string }).projectId;
  await withProjectSnapshotUnlocked(db, () =>
    db.prepare("UPDATE project_publications SET title='   ' WHERE id=?").bind(blankId).run(),
  );
  expect(
    (await req('/api/private/project-publications/' + blank.id, 'PUT', { stage: 'in_progress' }))
      .status,
  ).toBe(404);
  expect(
    (await db
      .prepare('SELECT stage FROM project_publications WHERE id=?')
      .bind(blankId)
      .first<{ stage: string }>())!.stage,
  ).toBe('complete');
  // The column only holds the two stages, also for direct writes.
  await expect(
    db.prepare("UPDATE project_publications SET stage='done' WHERE id=?").bind(legacyId).run(),
  ).rejects.toThrow();
});
it('stores technologies in the draft and the immutable published snapshot', async () => {
  const d = await create({ ...f, technologies: 'React、Cloudflare Workers' });
  expect(d.technologies).toBe('React、Cloudflare Workers');
  const r = await publish(d);
  expect(r.status).toBe(201);
  const { projectId } = (await r.json()) as { projectId: string };
  expect((await publicRead(projectId))?.project.technologies).toBe('React、Cloudflare Workers');
  const saved = (await (
    await req('/api/private/project-drafts/' + d.id, 'PUT', {
      ...f,
      technologies: 'Private newer',
      expectedVersion: 1,
    })
  ).json()) as ProjectDraft;
  expect(saved.technologies).toBe('Private newer');
  expect((await publicRead(projectId))?.project.technologies).toBe('React、Cloudflare Workers');
  const db = await mf.getD1Database('DB');
  await expect(
    db
      .prepare("UPDATE project_publications SET technologies='changed' WHERE id=?")
      .bind(projectId)
      .run(),
  ).rejects.toThrow();
  // A page loaded before the field existed may still save; the omitted field becomes empty.
  const legacy = await req('/api/private/project-drafts/' + d.id, 'PUT', {
    ...f,
    expectedVersion: saved.version,
  });
  expect(legacy.status).toBe(200);
  expect(((await legacy.json()) as ProjectDraft).technologies).toBe('');
});
it('refuses DELETE and INSERT OR REPLACE on published project snapshots (#177)', async () => {
  const d = await create({ ...f, technologies: 'Snapshot' });
  const r = await publish(d);
  expect(r.status).toBe(201);
  const { projectId } = (await r.json()) as { projectId: string };
  const db = await mf.getD1Database('DB');
  await expect(
    db.prepare('DELETE FROM project_publications WHERE id=?').bind(projectId).run(),
  ).rejects.toThrow(/immutable project snapshot/);
  await expect(
    db
      .prepare(
        "INSERT OR REPLACE INTO project_publications(id,owner_account_id,draft_id,public_profile_id,source_version,title,description,github_url,demo_url,technologies,published_at_ms,status,media_ids_json,article_ids_json) SELECT id,owner_account_id,draft_id,public_profile_id,source_version,title,description,github_url,demo_url,'Replaced',published_at_ms,status,media_ids_json,article_ids_json FROM project_publications WHERE id=?",
      )
      .bind(projectId)
      .run(),
  ).rejects.toThrow(/immutable project snapshot/);
  expect((await publicRead(projectId))?.project.technologies).toBe('Snapshot');
  // #255: a different id with the same draft_id would silently swap the snapshot through REPLACE; it is ignored.
  const swap = (verb: string) =>
    db
      .prepare(
        `${verb} INTO project_publications(id,owner_account_id,draft_id,public_profile_id,source_version,title,description,github_url,demo_url,technologies,published_at_ms,status,media_ids_json,article_ids_json) SELECT 'swapped-'||id,owner_account_id,draft_id,public_profile_id,source_version,'Hijacked',description,github_url,demo_url,'Replaced',published_at_ms,status,media_ids_json,article_ids_json FROM project_publications WHERE id=?`,
      )
      .bind(projectId)
      .run();
  await swap('INSERT OR REPLACE');
  await swap('REPLACE');
  await swap('INSERT OR IGNORE');
  const rows = await db
    .prepare('SELECT id,title,technologies FROM project_publications WHERE draft_id=?')
    .bind(d.id)
    .all();
  expect(rows.results).toEqual([{ id: projectId, title: f.title, technologies: 'Snapshot' }]);
  expect((await publicRead(projectId))?.project).toMatchObject({
    title: f.title,
    technologies: 'Snapshot',
  });
  // The ordinary repeated publication (ON CONFLICT(draft_id) DO NOTHING) still answers as before.
  const again = await publish(d);
  expect(again.status).toBe(201);
  expect(((await again.json()) as { projectId: string }).projectId).toBe(projectId);
});
it('refuses UPDATE of the published snapshot columns, also through UPDATE OR REPLACE (#257)', async () => {
  const a = await create({ ...f, title: 'Snapshot A', technologies: 'A' });
  const b = await create({ ...f, title: 'Snapshot B', technologies: 'B' });
  const idA = ((await (await publish(a)).json()) as { projectId: string }).projectId;
  const idB = ((await (await publish(b)).json()) as { projectId: string }).projectId;
  const db = await mf.getD1Database('DB');
  const snapshot = () =>
    db
      .prepare(
        'SELECT id,owner_account_id,draft_id,public_profile_id,source_version,title,description,github_url,demo_url,published_at_ms,status FROM project_publications WHERE id IN (?,?) ORDER BY id',
      )
      .bind(idA, idB)
      .all();
  const before = (await snapshot()).results;
  for (const [sql, value] of [
    ['UPDATE OR REPLACE project_publications SET draft_id=? WHERE id=?', a.id],
    ['UPDATE OR REPLACE project_publications SET id=? WHERE id=?', idA],
    ['UPDATE project_publications SET draft_id=? WHERE id=?', null],
    ['UPDATE project_publications SET owner_account_id=? WHERE id=?', null],
    ['UPDATE project_publications SET title=? WHERE id=?', 'Hijacked'],
    ['UPDATE project_publications SET description=? WHERE id=?', 'Hijacked'],
    ['UPDATE project_publications SET github_url=? WHERE id=?', 'https://example.invalid/x'],
    ['UPDATE project_publications SET demo_url=? WHERE id=?', 'https://example.invalid/x'],
    ['UPDATE project_publications SET source_version=? WHERE id=?', 99],
    ['UPDATE project_publications SET published_at_ms=? WHERE id=?', 1],
    ['UPDATE project_publications SET public_profile_id=public_profile_id||? WHERE id=?', 'x'],
  ] as const)
    await expect(db.prepare(sql).bind(value, idB).run(), sql).rejects.toThrow(
      /immutable project snapshot/,
    );
  // Writing the same value is not a change and stays allowed.
  await db.prepare('UPDATE project_publications SET title=title WHERE id=?').bind(idA).run();
  expect((await snapshot()).results).toEqual(before);
  expect((await publicRead(idA))?.project.title).toBe('Snapshot A');
  expect((await publicRead(idB))?.project.title).toBe('Snapshot B');
  // Status transitions (stop, moderation, report threshold) are untouched.
  await db.prepare("UPDATE project_publications SET status='hidden' WHERE id=?").bind(idA).run();
  await db.prepare("UPDATE project_publications SET status='published' WHERE id=?").bind(idA).run();
  // ON DELETE SET NULL still applies once the draft row itself is gone.
  await db.prepare('DELETE FROM project_drafts WHERE id=?').bind(b.id).run();
  expect(
    await db
      .prepare('SELECT draft_id,title FROM project_publications WHERE id=?')
      .bind(idB)
      .first(),
  ).toEqual({ draft_id: null, title: 'Snapshot B' });
});
it('refuses rewriting the rowid of a published snapshot, which would REPLACE another row away (#261)', async () => {
  const a = await create({ ...f, title: 'Rowid A' });
  const b = await create({ ...f, title: 'Rowid B' });
  const idA = ((await (await publish(a)).json()) as { projectId: string }).projectId;
  const idB = ((await (await publish(b)).json()) as { projectId: string }).projectId;
  const db = await mf.getD1Database('DB');
  const rows = () =>
    db
      .prepare(
        'SELECT rowid r,id,title,status FROM project_publications WHERE id IN (?,?) ORDER BY id',
      )
      .bind(idA, idB)
      .all();
  const before = (await rows()).results;
  for (const alias of ['rowid', 'oid', '_rowid_'])
    for (const verb of ['UPDATE OR REPLACE', 'UPDATE', 'UPDATE OR IGNORE'])
      await expect(
        db
          .prepare(
            `${verb} project_publications SET ${alias}=(SELECT rowid FROM project_publications WHERE id=?) WHERE id=?`,
          )
          .bind(idA, idB)
          .run(),
        `${verb} ${alias}`,
      ).rejects.toThrow(/immutable project snapshot/);
  // Moving to a free rowid is refused too: a snapshot's identity never changes.
  await expect(
    db.prepare('UPDATE project_publications SET rowid=rowid+100000 WHERE id=?').bind(idB).run(),
  ).rejects.toThrow(/immutable project snapshot/);
  expect((await rows()).results).toEqual(before);
  expect((await publicRead(idA))?.project.title).toBe('Rowid A');
  expect((await publicRead(idB))?.project.title).toBe('Rowid B');
  // Writing the same rowid is not a change, and the status transitions still pass.
  await db.prepare('UPDATE project_publications SET rowid=rowid WHERE id=?').bind(idA).run();
  await db.prepare("UPDATE project_publications SET status='hidden' WHERE id=?").bind(idA).run();
  await db.prepare("UPDATE project_publications SET status='published' WHERE id=?").bind(idA).run();
  // The other protected tables already refuse every UPDATE, including one of the rowid alone.
  for (const table of [
    'article_publication_revisions',
    'article_report_revisions',
    'article_publication_media',
    'project_publication_media',
  ]) {
    const sql = (
      await db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='trigger' AND tbl_name=? AND sql LIKE '%BEFORE UPDATE ON%'",
        )
        .bind(table)
        .first<{ sql: string }>()
    )?.sql;
    expect(sql, table).toMatch(/BEFORE UPDATE ON \w+ BEGIN SELECT RAISE\(ABORT/);
  }
});
it('saves no new invisible characters but still loads and publishes an older draft that has them (#177)', async () => {
  expect(
    (await req('/api/private/project-drafts', 'POST', { ...f, technologies: 'A\u202eB' })).status,
  ).not.toBe(201);
  // #255: soft hyphen and tag characters are refused by the API too; #257: so are the other characters that
  // render as nothing or blank (CGJ, Mongolian variation selectors, braille blank, private use, noncharacters).
  for (const c of [
    '\u00ad',
    '\u{e0041}',
    '\u{e0001}',
    '\u034f',
    '\u180b',
    '\u2800',
    '\ue000',
    '\u{f0000}',
    '\ufdd0',
    '\ufffe',
    '\u{1fffe}',
  ])
    for (const field of ['title', 'technologies'])
      expect(
        (await req('/api/private/project-drafts', 'POST', { ...f, [field]: 'A' + c + 'B' })).status,
      ).not.toBe(201);
  const d = await create({ ...f, title: 'Older' });
  const db = await mf.getD1Database('DB');
  await db
    .prepare('UPDATE project_drafts SET title=?,technologies=? WHERE id=?')
    .bind('Older\u2028title', 'A\u200bB', d.id)
    .run();
  const read = (await (await req('/api/private/project-drafts/' + d.id)).json()) as ProjectDraft;
  expect(read).toMatchObject({ title: 'Older\u2028title', technologies: 'A\u200bB' });
  expect(
    (
      await req('/api/private/project-drafts/' + d.id, 'PUT', {
        ...f,
        title: 'Older\u2028title',
        technologies: 'A\u200bB',
        expectedVersion: read.version,
      })
    ).status,
  ).not.toBe(200);
  const fixed = await req('/api/private/project-drafts/' + d.id, 'PUT', {
    ...f,
    title: 'Older title',
    technologies: 'AB',
    expectedVersion: read.version,
  });
  expect(fixed.status).toBe(200);
});
it('refuses a title of only blank or invisible characters on save and on publication (#265)', async () => {
  const blank = [
    '\u3000',
    '\u00a0 ',
    '\u{1d159}',
    '\u{1d159}\u200d\u{1d159}',
    '\u{16fe4}',
    '\u{16fe4}\u200d\u{16fe4}',
    '\u{13441}',
    '\u{13442}\u3000\u{13441}',
  ];
  for (const title of blank) {
    expect(hasVisibleCharacter(title), title).toBe(false);
    expect(normalizeProjectFields({ ...f, title }), title).toBeNull();
    expect(
      (await req('/api/private/project-drafts', 'POST', { ...f, title })).status,
      title,
    ).not.toBe(201);
  }
  // Real titles still pass: kana, kanji with a variation selector, emoji sequences, Thai, a letter with a mark.
  for (const title of [
    '作品',
    '葛\u{e0100}城',
    '👩\u200d💻 Lab',
    'ภาษาไทย',
    'e\u0301',
    'a\u{16fe4}',
    '♪',
  ])
    expect(normalizeProjectFields({ ...f, title }), title).not.toBeNull();
  // An empty title is still an unfinished draft that can be saved.
  expect(normalizeProjectFields({ ...f, title: '' })).not.toBeNull();
  // A draft saved before this rule with such a title still loads, but cannot be published.
  const d = await create({ ...f, title: 'Blank later' });
  const db = await mf.getD1Database('DB');
  for (const title of ['\u{1d159}', '\u200b']) {
    await db
      .prepare('UPDATE project_drafts SET title=?,version=version+1 WHERE id=?')
      .bind(title, d.id)
      .run();
    const read = (await (await req('/api/private/project-drafts/' + d.id)).json()) as ProjectDraft;
    expect(read.title).toBe(title);
    expect((await publish(read)).status, title).not.toBe(201);
  }
  await db
    .prepare('UPDATE project_drafts SET title=?,version=version+1 WHERE id=?')
    .bind('Shown', d.id)
    .run();
  const shown = (await (await req('/api/private/project-drafts/' + d.id)).json()) as ProjectDraft;
  expect((await publish(shown)).status).toBe(201);
});
it('keeps a published snapshot when its owner account is deleted: only owner_account_id becomes NULL (#261)', async () => {
  const d = await create({ ...f, title: 'Owner leaves' }, 1);
  const r = await publish(d, 1);
  expect(r.status).toBe(201);
  const { projectId } = (await r.json()) as { projectId: string };
  const db = await mf.getD1Database('DB');
  const read = () =>
    db
      .prepare(
        'SELECT rowid r,id,owner_account_id,public_profile_id,source_version,title,description,github_url,demo_url,published_at_ms,status FROM project_publications WHERE id=?',
      )
      .bind(projectId)
      .first<Record<string, unknown>>();
  const before = await read();
  expect(before?.owner_account_id).toBe('account-1');
  // The owner cannot be cleared while the account still exists…
  await expect(
    db
      .prepare('UPDATE project_publications SET owner_account_id=NULL WHERE id=?')
      .bind(projectId)
      .run(),
  ).rejects.toThrow(/immutable project snapshot/);
  // …but ON DELETE SET NULL applies once the account row itself is gone, and nothing else in the row moves.
  await db.prepare('DELETE FROM private_accounts WHERE id=?').bind('account-1').run();
  expect(await read()).toEqual({ ...before, owner_account_id: null });
  // A NULL owner can never be set back to an account.
  await expect(
    db
      .prepare("UPDATE project_publications SET owner_account_id='account-0' WHERE id=?")
      .bind(projectId)
      .run(),
  ).rejects.toThrow(/immutable project snapshot/);
});
it('routes the owner-only journal links of a published project (#273)', async () => {
  const d = await create({ ...f, title: 'Journal project' });
  const r = await publish(d);
  expect(r.status).toBe(201);
  const { projectId } = (await r.json()) as { projectId: string };
  const path = '/api/private/project-journal/' + d.id;
  const own = await req(path);
  expect(own.status).toBe(200);
  expect(await own.json()).toEqual({
    projectId,
    fixedArticleIds: [],
    articleIds: [],
    articles: [],
  });
  // Another signed-in student, a missing session, a query, a missing id and an unknown draft.
  expect((await req(path, 'GET', undefined, 2)).status).toBe(404);
  expect((await req(path, 'GET', undefined, 0, { Cookie: '' })).status).toBe(401);
  expect((await req(path + '?x=1')).status).toBe(404);
  expect((await req('/api/private/project-journal')).status).toBe(404);
  expect((await req('/api/private/project-journal/' + crypto.randomUUID())).status).toBe(404);
  const post = await req(path, 'POST', { articleId: crypto.randomUUID(), linked: true });
  expect(post.status).toBe(405);
  expect(post.headers.get('Allow')).toBe('GET, PUT');
  // Not an own public article, or a malformed body: the same 404, and nothing is written.
  for (const body of [
    { articleId: crypto.randomUUID(), linked: true },
    { articleId: 'x', linked: true },
    { articleId: crypto.randomUUID() },
  ])
    expect((await req(path, 'PUT', body)).status).toBe(404);
  // A write without the CSRF proof never reaches the store.
  expect(
    (
      await req(path, 'PUT', { articleId: crypto.randomUUID(), linked: false }, 0, {
        Authorization: '',
      })
    ).status,
  ).toBe(401);
  const db = await mf.getD1Database('DB');
  expect(
    await db
      .prepare('SELECT COUNT(*) n FROM project_journal_links WHERE project_id=?')
      .bind(projectId)
      .first('n'),
  ).toBe(0);
});
