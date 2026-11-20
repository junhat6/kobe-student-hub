import { completeGoogleFormPost } from './helpers/google-form-post';
import { test, expect, type Browser, type BrowserContext } from '@playwright/test';

// C01: an anonymous reader meets real articles and works on the top page, newest first,
// never mixed with the fictional sample catalog, and every card leads somewhere.
const ORIGIN = 'https://127.0.0.1:8790';
type Actor = { context: BrowserContext; csrf: string; profileId: string };

async function actor(browser: Browser, contexts: BrowserContext[], name: string): Promise<Actor> {
  const context = await browser.newContext({ baseURL: ORIGIN, ignoreHTTPSErrors: true });
  contexts.push(context);
  const headers = { Origin: ORIGIN };
  expect((await context.request.post('/api/auth/bootstrap', { headers })).status()).toBe(204);
  const command = await context.request.post('/api/auth/command?action=self-registration', {
    headers,
  });
  expect(command.status()).toBe(200);
  const { commandToken } = await command.json();
  const start = await context.request.post('/api/auth/register', {
    headers: { ...headers, Authorization: 'Bearer command.' + commandToken },
    data: { admissionYear: 2026, graduationYear: 2028 },
  });
  expect(start.status()).toBe(200);
  const authorization = new URL((await start.json()).authorizationUrl);
  const state = authorization.searchParams.get('state')!;
  const nonce = authorization.searchParams.get('nonce')!;
  expect(
    (
      await context.request.get(
        '/__control/token?' +
          new URLSearchParams({ state, nonce, actor: 'fictional-home-' + crypto.randomUUID() }),
      )
    ).status(),
  ).toBe(200);
  const callback = await completeGoogleFormPost(context.request, ORIGIN, { state, code: state });
  expect(callback.status()).toBe(303);
  const { csrfToken } = await (await context.request.get('/api/private/session')).json();
  const profile = await context.request.post('/api/private/profile', {
    headers: { ...headers, Authorization: 'Bearer csrf.' + csrfToken },
    data: { displayName: name, department: '', yearLabel: '', bio: '', confirmPublic: true },
  });
  expect(profile.status()).toBe(201);
  return { context, csrf: csrfToken, profileId: (await profile.json()).profile.id };
}

async function write(
  owner: Actor,
  path: string,
  data: object,
  method: 'POST' | 'PATCH' = 'POST',
  expected = method === 'POST' ? 201 : 200,
) {
  const response = await owner.context.request.fetch(path, {
    method,
    headers: { Origin: ORIGIN, Authorization: 'Bearer csrf.' + owner.csrf },
    data,
  });
  expect(response.status()).toBe(expected);
  return response.json();
}

const metadata = {
  confirmPublic: true,
  summary: 'トップに並ぶ架空の記事',
  tags: ['トップ'],
  minutes: 1,
  audience: '',
  prerequisite: '',
  outcome: '',
};

async function article(owner: Actor, title: string) {
  const draft = await write(owner, '/api/private/drafts', { title, body: '## 架空の本文' });
  const published = await write(owner, '/api/private/publications/' + draft.id, {
    ...metadata,
    expectedVersion: draft.version,
  });
  return { id: published.contentId as string, draftId: draft.id as string, version: draft.version };
}

test('anonymous top lists real articles and works newest first and every card leads on', async ({
  browser,
  page,
}, info) => {
  const contexts: BrowserContext[] = [];
  const key = info.project.name + '-' + Date.now().toString(36);
  try {
    const owner = await actor(browser, contexts, '架空のトップ投稿者-' + key);
    const older = await article(owner, '先に公開した記事-' + key);
    const newer = await article(owner, '後に公開した記事-' + key);
    const workDraft = await write(owner, '/api/private/project-drafts', {
      title: 'トップの作品-' + key,
      description: 'トップに並ぶ架空の作品',
      githubUrl: '',
      demoUrl: '',
    });
    const work = await write(owner, '/api/private/project-publications/' + workDraft.id, {
      expectedVersion: workDraft.version,
      confirmPublic: true,
    });

    await page.goto('/');
    const articles = page.locator('section[aria-labelledby="home-articles-title"] .content-card');
    const firstTitles = () => articles.locator('h3').allTextContents();
    await expect(articles.first()).toBeVisible();
    expect((await firstTitles()).slice(0, 2)).toEqual([
      '後に公開した記事-' + key,
      '先に公開した記事-' + key,
    ]);
    // Only real publications reach the ordinary top; the fictional catalog stays separate.
    await expect(page.getByText('「動いた」で終わらせない、制作ノートの残し方')).toHaveCount(0);
    await expect(page.getByText('サンプルの先輩')).toHaveCount(0);

    // A revision moves the article up, matching the date its card shows.
    const revised = await write(
      owner,
      '/api/private/drafts/' + older.draftId,
      { title: '改稿した記事-' + key, body: '## 改稿した本文', expectedVersion: older.version },
      'PATCH',
    );
    const republished = await write(owner, '/api/private/publications/' + older.draftId, {
      ...metadata,
      expectedVersion: revised.version,
      expectedPublicationVersion: older.version,
    });
    expect(republished.contentId).toBe(older.id);
    await page.reload();
    await expect(articles.first().locator('h3')).toHaveText('改稿した記事-' + key);
    expect((await firstTitles()).slice(0, 2)).toEqual([
      '改稿した記事-' + key,
      '後に公開した記事-' + key,
    ]);
    const dates = await articles
      .locator('time')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('datetime') ?? ''));
    expect([...dates].sort().reverse()).toEqual(dates);

    const works = page.locator('section[aria-labelledby="home-works-title"] .content-card');
    await expect(works.first().getByRole('link', { name: 'トップの作品-' + key })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
    await page.screenshot({ path: info.outputPath('ordinary-home.png'), fullPage: true });

    // Card → article.
    await articles
      .first()
      .getByRole('link', { name: '改稿した記事-' + key })
      .click();
    await expect(page).toHaveURL(new RegExp('/articles/' + older.id + '$'));
    await expect(
      page.getByRole('heading', { level: 1, name: '改稿した記事-' + key }),
    ).toBeVisible();
    // Card → author.
    await page.goto('/');
    await articles
      .first()
      .getByRole('link', { name: new RegExp('架空のトップ投稿者-' + key) })
      .click();
    await expect(page).toHaveURL(new RegExp('/students/' + owner.profileId));
    await expect(page.getByRole('heading', { name: '架空のトップ投稿者-' + key })).toBeVisible();
    // Card → work.
    await page.goto('/');
    await works
      .first()
      .getByRole('link', { name: 'トップの作品-' + key })
      .click();
    await expect(page).toHaveURL(new RegExp('/projects/' + work.projectId + '$'));
    await expect(
      page.getByRole('heading', { level: 1, name: 'トップの作品-' + key }),
    ).toBeVisible();
    expect(newer.id).not.toBe(older.id);
    // The fictional catalog stays reachable by direct URL and always says it is a sample.
    await page.goto('/articles/learning-notes');
    await expect(page.getByText(/サンプル/).first()).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
