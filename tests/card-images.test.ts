import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { encode as pngEncode } from 'fast-png';
import { workerModules } from './helpers/worker-modules';
import type { PrivateDraft } from '../worker/drafts';
import { isCardImage, withCardImageKey } from '../src/shared/card-image';

// #311 (C26 condition 5): the picture on public cards and the owner's choice of it.
const O = 'https://app.example.invalid',
  NOW = 1800000000000;
type Session = { setCookie: string; contextCookie: string; csrfToken: string };
let mf: Miniflare,
  users: Session[] = [];
const png = pngEncode({
  width: 32,
  height: 24,
  data: new Uint8Array(32 * 24 * 4).fill(120),
  channels: 4,
});
const id = () => crypto.randomUUID();
const h = (n = 0) => ({
  Cookie: [users[n].setCookie, users[n].contextCookie].map((s) => s.split(';')[0]).join('; '),
  Origin: O,
  Authorization: 'Bearer csrf.' + users[n].csrfToken,
});
async function call<T>(path: string, input: unknown, n = 0): Promise<T> {
  const response = await mf.dispatchFetch(O + '/fixture/' + path, {
    method: 'POST',
    headers: { ...h(n), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return (await response.json()) as T;
}
async function boot(until = '￿') {
  users = [];
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: workerModules('.worker/media-test.js'),
      compatibilityDate: '2026-11-03',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: ['DB'],
      outboundService() {
        throw Error('Unexpected outbound');
      },
    }),
  );
  const db = await mf.getD1Database('DB');
  for (const file of readdirSync('migrations')
    .filter((f) => f.endsWith('.sql') && f < until)
    .sort()) {
    const raw = readFileSync('migrations/' + file, 'utf8');
    for (const sql of (raw.includes('-- @statement')
      ? raw.split(/^-- @statement\s*$/m)
      : raw.split(/;\s*(?:\n|$)/)
    )
      .map((s) => s.replace(/^--.*$/gm, '').trim())
      .filter(Boolean))
      await db.prepare(sql).run();
  }
  for (let n = 0; n < 2; n++) {
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
    await db
      .prepare(
        "INSERT INTO public_profiles(id,display_name,department,year_label,bio,initials,is_sample) VALUES(?,'公開表示名','','','','画',0)",
      )
      .bind('card-author-' + n)
      .run();
    await db
      .prepare(
        'INSERT INTO account_public_profiles(owner_account_id,public_profile_id) VALUES(?,?)',
      )
      .bind('account-' + n, 'card-author-' + n)
      .run();
  }
}
const upload = async (kind: 'articles' | 'projects', draftId: string, image: string, n = 0) =>
  (
    await mf.dispatchFetch(O + `/api/private/media/${kind}/${draftId}/${image}`, {
      method: 'PUT',
      headers: { ...h(n), 'If-Match': '"1"', 'Content-Type': 'image/png' },
      body: png,
    })
  ).status;
/** A published article whose body refers to `images` in that order (each uploaded to its draft). */
async function article(images: string[], extra: string[] = [], n = 0) {
  const d = await call<PrivateDraft>(
    'draft',
    {
      title: 'Card article ' + id().slice(0, 8),
      body: images.map((image) => `![図](/api/media/${image})`).join('\n\n') || '本文だけ',
    },
    n,
  );
  for (const image of [...images, ...extra])
    expect(await upload('articles', d.id, image, n)).toBe(201);
  const p = await call<{ contentId: string } | null>(
    'article-publish',
    {
      id: d.id,
      input: {
        expectedVersion: d.version,
        confirmPublic: true,
        summary: 'Card overview',
        tags: [],
        minutes: 1,
        mediaIds: images,
      },
    },
    n,
  );
  expect(p).not.toBeNull();
  return { draftId: d.id, contentId: p!.contentId };
}
async function project(images: string[], extra: string[] = [], n = 0) {
  const d = await call<{ id: string }>(
    'project-draft',
    {
      title: 'Card project ' + id().slice(0, 8),
      description: images.map((image) => `![画面](/api/media/${image})`).join('\n') || '説明だけ',
      githubUrl: '',
      demoUrl: '',
    },
    n,
  );
  for (const image of [...images, ...extra])
    expect(await upload('projects', d.id, image, n)).toBe(201);
  const p = await call<{ projectId: string } | null>(
    'project-publish',
    { id: d.id, input: { expectedVersion: 1, confirmPublic: true, mediaIds: images } },
    n,
  );
  expect(p).not.toBeNull();
  return { draftId: d.id, projectId: p!.projectId };
}
const choose = (
  kind: 'articles' | 'projects',
  draftId: string,
  body: unknown,
  n = 0,
  headers: Record<string, string> = {},
) =>
  mf.dispatchFetch(O + `/api/private/card-images/${kind}/${draftId}`, {
    method: 'PUT',
    headers: { ...h(n), 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
type Cards = { cards: { entry: { id: string; image?: string } }[] };
type Works = { cards: { project: { id: string; image?: string } }[] };
const articleImage = async (contentId: string) => {
  const response = await mf.dispatchFetch(O + '/api/articles');
  expect(response.status).toBe(200);
  const card = ((await response.json()) as Cards).cards.find((c) => c.entry.id === contentId);
  return card ? (card.entry.image ?? null) : undefined;
};
const projectImage = async (projectId: string) => {
  const response = await mf.dispatchFetch(O + '/api/projects');
  expect(response.status).toBe(200);
  const card = ((await response.json()) as Works).cards.find((c) => c.project.id === projectId);
  return card ? (card.project.image ?? null) : undefined;
};
const path = (image: string) => '/api/media/' + image;

describe('card image DTO helpers', () => {
  it('accepts only the public media path of an image id', () => {
    const image = id();
    expect(isCardImage(path(image))).toBe(true);
    for (const value of [
      'https://evil.example/x.png',
      '/api/private/media/' + image,
      path(image) + '?x=1',
      path(image.toUpperCase()),
      path(image) + '/',
      42,
      null,
    ])
      expect(isCardImage(value)).toBe(false);
    expect(withCardImageKey({ id: 'a' }, ['id'])).toEqual(['id']);
    expect(withCardImageKey({ id: 'a', image: path(image) }, ['id'])).toEqual(['id', 'image']);
    expect(withCardImageKey({ id: 'a', image: 'https://evil.example/' }, ['id'])).toBeNull();
  });
});

describe('card images', () => {
  beforeAll(() => boot());
  afterAll(async () => {
    await mf?.dispose();
  });

  it('shows the first image in the body by default, and no image key without images', async () => {
    // `second` sorts after `first` by id, yet comes first in the body: the body order decides.
    const [first, second] = [id(), id()].sort();
    const a = await article([second, first]);
    expect(await articleImage(a.contentId)).toBe(path(second));
    const plain = await article([]);
    const response = await mf.dispatchFetch(O + '/api/articles');
    const card = ((await response.json()) as Cards).cards.find(
      (c) => c.entry.id === plain.contentId,
    )!;
    expect(Object.hasOwn(card.entry, 'image')).toBe(false);
    // Home discovery carries the same picture.
    const home = (await (await mf.dispatchFetch(O + '/api/discovery')).json()) as {
      recent: { entry: { id: string; image?: string } }[];
    };
    expect(home.recent.find((c) => c.entry.id === a.contentId)?.entry.image).toBe(path(second));
  });

  it('lets the owner choose an attached image and go back to the default', async () => {
    const first = id(),
      second = id();
    const a = await article([first, second]);
    const own = await mf.dispatchFetch(O + `/api/private/card-images/articles/${a.draftId}`, {
      headers: h(),
    });
    expect(own.status).toBe(200);
    expect(own.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await own.json()).toEqual({ mediaId: null });
    const chosen = await choose('articles', a.draftId, { mediaId: second });
    expect(chosen.status).toBe(200);
    expect(await chosen.json()).toEqual({ mediaId: second });
    expect(await articleImage(a.contentId)).toBe(path(second));
    const back = await choose('articles', a.draftId, { mediaId: null });
    expect(await back.json()).toEqual({ mediaId: null });
    expect(await articleImage(a.contentId)).toBe(path(first));
  });

  it('refuses another owner’s image, external URLs and malformed bodies with 400', async () => {
    const mine = id(),
      theirs = id();
    const a = await article([mine]);
    await article([theirs], [], 1);
    for (const body of [
      { mediaId: theirs },
      { mediaId: 'https://evil.example/x.png' },
      { mediaId: path(mine) },
      { mediaId: mine, extra: true },
      {},
      'not json',
    ]) {
      const response = await choose('articles', a.draftId, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    // An unknown image id is not attached either.
    expect((await choose('articles', a.draftId, { mediaId: id() })).status).toBe(400);
    expect(await articleImage(a.contentId)).toBe(path(mine));
  });

  it('keeps the draft owner’s choice to the owner: other students, no CSRF and no session fail', async () => {
    const image = id();
    const a = await article([image]);
    expect((await choose('articles', a.draftId, { mediaId: image }, 1)).status).toBe(404);
    expect(
      (
        await mf.dispatchFetch(O + `/api/private/card-images/articles/${a.draftId}`, {
          headers: h(1),
        })
      ).status,
    ).toBe(404);
    expect(
      (await choose('articles', a.draftId, { mediaId: image }, 0, { Authorization: '' })).status,
    ).toBe(401);
    expect(
      (
        await choose('articles', a.draftId, { mediaId: image }, 0, {
          Origin: 'https://other.example.invalid',
        })
      ).status,
    ).toBe(401);
    expect(
      (await mf.dispatchFetch(O + `/api/private/card-images/articles/${a.draftId}`)).status,
    ).toBe(404);
    expect(
      (
        await mf.dispatchFetch(O + `/api/private/card-images/articles/${a.draftId}`, {
          method: 'DELETE',
          headers: h(),
        })
      ).status,
    ).toBe(405);
  });

  it('falls back to the default when the chosen image is not in the public version', async () => {
    const shown = id(),
      unpublished = id();
    // `unpublished` is attached to the draft but not referenced by the published body.
    const a = await article([shown], [unpublished]);
    expect((await choose('articles', a.draftId, { mediaId: unpublished })).status).toBe(200);
    expect(await articleImage(a.contentId)).toBe(path(shown));
  });

  it('hides the picture with the publication: a stopped article is gone and its image is 404', async () => {
    const image = id();
    const a = await article([image]);
    expect(await articleImage(a.contentId)).toBe(path(image));
    expect((await mf.dispatchFetch(O + path(image))).status).toBe(200);
    expect(
      await call('stop', {
        kind: 'article',
        id: a.contentId,
        input: { expectedSourceVersion: 1, confirmStop: true },
      }),
    ).not.toBeNull();
    expect(await articleImage(a.contentId)).toBeUndefined();
    expect((await mf.dispatchFetch(O + path(image))).status).toBe(404);
  });

  it('gives projects the same default, choice and stop behaviour', async () => {
    // `first` sorts after `second` by id, so only the description order can pick it.
    const [second, first] = [id(), id()].sort();
    const p = await project([first, second]);
    expect(await projectImage(p.projectId)).toBe(path(first));
    expect((await choose('projects', p.draftId, { mediaId: second })).status).toBe(200);
    expect(await projectImage(p.projectId)).toBe(path(second));
    // An article draft id under the projects path is not this owner's project draft.
    const a = await article([id()]);
    expect((await choose('projects', a.draftId, { mediaId: second })).status).toBe(404);
    await call('stop', {
      kind: 'project',
      id: p.projectId,
      input: { expectedSourceVersion: 1, confirmStop: true },
    });
    expect(await projectImage(p.projectId)).toBeUndefined();
    expect((await mf.dispatchFetch(O + path(second))).status).toBe(404);
  });

  it('enforces the attachment boundary in the database as well', async () => {
    const image = id(),
      theirs = id();
    const a = await article([image]);
    await article([theirs], [], 1);
    const db = await mf.getD1Database('DB');
    await expect(
      db
        .prepare(
          "INSERT INTO article_card_images(draft_id,owner_account_id,media_id,updated_at_ms) VALUES(?,'account-0',?,?)",
        )
        .bind(a.draftId, theirs, NOW)
        .run(),
    ).rejects.toThrow();
    await db
      .prepare(
        "INSERT INTO article_card_images(draft_id,owner_account_id,media_id,updated_at_ms) VALUES(?,'account-0',?,?)",
      )
      .bind(a.draftId, image, NOW)
      .run();
    await expect(
      db
        .prepare('UPDATE article_card_images SET media_id=? WHERE draft_id=?')
        .bind(theirs, a.draftId)
        .run(),
    ).rejects.toThrow();
    await expect(
      db
        .prepare("UPDATE article_card_images SET owner_account_id='account-1' WHERE draft_id=?")
        .bind(a.draftId)
        .run(),
    ).rejects.toThrow();
  });
});

describe('card images before migration 0053 (the previous schema)', () => {
  beforeAll(() => boot('0053'));
  afterAll(async () => {
    await mf?.dispose();
  });
  it('still lists articles and projects, with the default image', async () => {
    const image = id(),
      shot = id();
    const a = await article([image]);
    const p = await project([shot]);
    expect(await articleImage(a.contentId)).toBe(path(image));
    expect(await projectImage(p.projectId)).toBe(path(shot));
    expect((await mf.dispatchFetch(O + '/api/discovery')).status).toBe(200);
    // Without the table the choice is unavailable, never a silent success.
    expect((await choose('articles', a.draftId, { mediaId: image })).status).toBe(503);
  });
});
