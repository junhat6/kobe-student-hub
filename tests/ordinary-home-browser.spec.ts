import { completeGoogleFormPost } from './helpers/google-form-post';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

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
    // #307: a card shows only the frame, kind, title, author and time. Reading time, summary,
    // reader context, tags and the work description stay off the card.
    const articleCard = articles.filter({ hasText: '改稿した記事-' + key });
    const workCard = works.filter({ hasText: 'トップの作品-' + key });
    for (const card of [articleCard, workCard]) {
      await expect(card.locator('.content-card-band')).toBeVisible();
      await expect(card.locator('time')).toHaveCount(1);
      await expect(card.locator('.content-card-author')).toBeVisible();
      await expect(card.getByRole('link')).toHaveText([
        card === articleCard ? '改稿した記事-' + key : 'トップの作品-' + key,
        /架空/,
      ]);
    }
    await expect(articleCard).not.toContainText('分で読める');
    await expect(articleCard).not.toContainText(metadata.summary);
    await expect(articleCard).not.toContainText('# トップ');
    await expect(workCard).not.toContainText('トップに並ぶ架空の作品');
    // Kind by icon and word as well as colour, and the two kinds differ in colour.
    await expect(articleCard.locator('.content-card-kind')).toHaveText('記事');
    await expect(workCard.locator('.content-card-kind')).toHaveText('作品');
    await expect(articleCard.locator('.content-card-kind svg')).toHaveCount(1);
    await expect(workCard.locator('.content-card-kind svg')).toHaveCount(1);
    const kindColour = (card: typeof articleCard) =>
      card.locator('.content-card-kind').evaluate((node) => getComputedStyle(node).color);
    expect(await kindColour(articleCard)).not.toBe(await kindColour(workCard));
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

// #309 (C26-4): the top opens on the cards. A signed-in reader gets no hero at all (search and
// 書く live in the header) and sees the first card's title without scrolling; a signed-out
// visitor gets one short band saying what this is and how to join. The band is decided once
// the session answers, so it never shows and then vanishes, and never pushes shown cards down.
test('top has no hero: a short band when signed out, straight to the cards when signed in', async ({
  browser,
  page,
}, info) => {
  const contexts: BrowserContext[] = [];
  const key = info.project.name + '-' + Date.now().toString(36);
  const mobile = info.project.name.includes('mobile');
  const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 };
  // Records, in order, when the band and the first article card first enter the DOM.
  const watch = () => {
    const seen: string[] = [];
    (window as unknown as { __seen: string[] }).__seen = seen;
    new MutationObserver(() => {
      for (const [name, selector] of [
        ['band', '.home-band'],
        ['card', 'section[aria-labelledby="home-articles-title"] .content-card'],
      ])
        if (!seen.includes(name) && document.querySelector(selector)) seen.push(name);
      if (seen.includes('band') && !document.querySelector('.home-band')) seen.push('band-gone');
    }).observe(document, { childList: true, subtree: true });
  };
  const slowSession = async (target: Page) =>
    target.route('**/api/private/session', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    });
  try {
    const owner = await actor(browser, contexts, '架空の帯の投稿者-' + key);
    await article(owner, '帯の下の記事-' + key);

    // Signed out: a slow session answer still shows the band before (never after) the cards.
    await page.setViewportSize(viewport);
    await page.addInitScript(watch);
    await slowSession(page);
    await page.goto('/');
    const band = page.locator('.home-band');
    await expect(band).toBeVisible();
    await expect(band.getByRole('link', { name: '学校Googleで登録して書く' })).toHaveAttribute(
      'href',
      '/signup',
    );
    await expect(band).toContainText('学びと制作の経験を記事と作品で共有する場所');
    const signedOutCards = page.locator(
      'section[aria-labelledby="home-articles-title"] .content-card',
    );
    await expect(signedOutCards.first()).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen)).toEqual([
      'band',
      'card',
    ]);
    const bandHeight = (await band.boundingBox())!.height;
    expect(bandHeight).toBeLessThanOrEqual(mobile ? 220 : 160);
    await expect(page.locator('main')).not.toContainText('次の一歩');
    await expect(page.locator('main').getByRole('searchbox')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
    await page.screenshot({ path: info.outputPath('home-signed-out.png'), scale: 'css' });

    // Signed in: no band at any moment, no hero actions, and the first title is above the fold.
    const reader = await owner.context.newPage();
    await reader.setViewportSize(viewport);
    await reader.addInitScript(watch);
    await slowSession(reader);
    await reader.goto('/');
    const cards = reader.locator('section[aria-labelledby="home-articles-title"] .content-card');
    await expect(cards.first()).toBeVisible();
    await expect(reader.getByRole('button', { name: 'アカウントメニュー' })).toBeVisible();
    expect(await reader.evaluate(() => (window as unknown as { __seen: string[] }).__seen)).toEqual(
      ['card'],
    );
    await expect(reader.locator('.home-band')).toHaveCount(0);
    await expect(reader.locator('main').getByRole('link', { name: '記事を書く' })).toHaveCount(0);
    await expect(reader.locator('main').getByRole('link', { name: '作品を登録する' })).toHaveCount(
      0,
    );
    await expect(reader.locator('main').getByRole('searchbox')).toHaveCount(0);
    expect(await reader.evaluate(() => scrollY)).toBe(0);
    const title = (await cards.first().locator('h3').boundingBox())!;
    expect(title.y + title.height).toBeLessThanOrEqual(viewport.height);
    expect(await reader.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
    await reader.screenshot({ path: info.outputPath('home-signed-in.png'), scale: 'css' });
    const { violations } = await new AxeBuilder({ page: reader }).analyze();
    expect(
      violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => v.id),
    ).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
