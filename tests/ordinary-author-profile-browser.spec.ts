import { completeGoogleFormPost } from './helpers/google-form-post';
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

// C05: an anonymous reader goes from an article or a work to its author's public profile,
// sees only that person's public articles and works, and never sees the school email,
// Google identifier, declared enrollment years or the Google name/picture.
const ORIGIN = 'https://127.0.0.1:8790';
type Actor = { context: BrowserContext; csrf: string; profileId: string; subject: string };

// Distinct years so the declaration cannot hide inside publication dates.
const ADMISSION = 2019;
const GRADUATION = 2031;
const CANARIES = [
  'GOOGLE_NAME_CANARY',
  'GOOGLE_GIVEN_CANARY',
  'GOOGLE_FAMILY_CANARY',
  'GOOGLE_PICTURE_CANARY',
  'googleusercontent',
  'st.kobedenshi.ac.jp',
];

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
    data: { admissionYear: ADMISSION, graduationYear: GRADUATION },
  });
  expect(start.status()).toBe(200);
  const authorization = new URL((await start.json()).authorizationUrl);
  const state = authorization.searchParams.get('state')!;
  const nonce = authorization.searchParams.get('nonce')!;
  const subject = 'fictional-author-' + crypto.randomUUID();
  expect(
    (
      await context.request.get(
        '/__control/token?' + new URLSearchParams({ state, nonce, actor: subject }),
      )
    ).status(),
  ).toBe(200);
  const callback = await completeGoogleFormPost(context.request, ORIGIN, { state, code: state });
  expect(callback.status()).toBe(303);
  const { csrfToken } = await (await context.request.get('/api/private/session')).json();
  const profile = await context.request.post('/api/private/profile', {
    headers: { ...headers, Authorization: 'Bearer csrf.' + csrfToken },
    data: {
      displayName: name,
      department: '架空の情報学科',
      yearLabel: '自分で書いた学年',
      bio: '自分で入力した公開の自己紹介',
      confirmPublic: true,
    },
  });
  expect(profile.status()).toBe(201);
  return { context, csrf: csrfToken, profileId: (await profile.json()).profile.id, subject };
}

async function write(owner: Actor, path: string, data: object) {
  const response = await owner.context.request.post(path, {
    headers: { Origin: ORIGIN, Authorization: 'Bearer csrf.' + owner.csrf },
    data,
  });
  expect(response.status()).toBe(201);
  return response.json();
}

async function article(owner: Actor, title: string) {
  const draft = await write(owner, '/api/private/drafts', { title, body: '## 架空の本文' });
  const published = await write(owner, '/api/private/publications/' + draft.id, {
    confirmPublic: true,
    summary: '投稿者の活動を知るための架空の記事',
    tags: ['活動'],
    minutes: 1,
    audience: '',
    prerequisite: '',
    outcome: '',
    expectedVersion: draft.version,
  });
  return published.contentId as string;
}

async function work(owner: Actor, title: string) {
  const draft = await write(owner, '/api/private/project-drafts', {
    title,
    description: '投稿者の活動を知るための架空の作品',
    githubUrl: '',
    demoUrl: '',
  });
  const published = await write(owner, '/api/private/project-publications/' + draft.id, {
    expectedVersion: draft.version,
    confirmPublic: true,
  });
  return published.projectId as string;
}

/** Records every same-origin API response body the anonymous reader receives. */
function recordBodies(page: Page) {
  const bodies: string[] = [];
  page.on('response', async (response) => {
    const url = new URL(response.url());
    if (url.origin !== ORIGIN || !url.pathname.startsWith('/api/')) return;
    try {
      bodies.push(await response.text());
    } catch {
      // Redirects and aborted requests have no body.
    }
  });
  return bodies;
}

async function expectNoPrivateIdentity(page: Page, bodies: string[], owner: Actor) {
  const html = await page.content();
  const text = await page.locator('body').innerText();
  for (const value of [...CANARIES, owner.subject]) {
    expect(html, value).not.toContain(value);
    for (const body of bodies) expect(body, value).not.toContain(value);
  }
  for (const year of [String(ADMISSION), String(GRADUATION)]) expect(text).not.toContain(year);
  expect(text).not.toMatch(/入学年度|卒業予定/);
  for (const body of bodies)
    expect(body).not.toMatch(/admission|graduation|enrollment|google_subject|"email"/i);
  // No avatar image: the profile shows initials only, never a Google picture.
  await expect(page.locator('.profile-header img, .detail-author img')).toHaveCount(0);
}

test('article and work lead an anonymous reader to the author profile without private identity', async ({
  browser,
  page,
}, info) => {
  const contexts: BrowserContext[] = [];
  const key = info.project.name + '-' + Date.now().toString(36);
  try {
    const owner = await actor(browser, contexts, '架空の活動する書き手-' + key);
    const other = await actor(browser, contexts, '架空の別の書き手-' + key);
    const articleTitle = '書き手の記事-' + key;
    const workTitle = '書き手の作品-' + key;
    const articleId = await article(owner, articleTitle);
    const projectId = await work(owner, workTitle);
    await article(other, '別の人の記事-' + key);
    await work(other, '別の人の作品-' + key);

    const bodies = recordBodies(page);
    const profileName = '架空の活動する書き手-' + key;

    // Article → author profile, which lists the author's own public articles.
    await page.goto('/articles/' + articleId);
    await expect(page.getByRole('heading', { level: 1, name: articleTitle })).toBeVisible();
    const articleAuthor = page.locator('.detail-author .author');
    await expect(articleAuthor).toHaveAttribute('href', '/students/' + owner.profileId);
    await expectNoPrivateIdentity(page, bodies, owner);
    await articleAuthor.click();
    await expect(page).toHaveURL(new RegExp('/students/' + owner.profileId + '$'));
    await expect(page.getByRole('heading', { level: 1, name: profileName })).toBeVisible();
    await expect(page.locator('main')).toContainText('自分で入力した公開の自己紹介');
    await expect(page.getByRole('link', { name: articleTitle })).toBeVisible();
    await expect(page.getByText('別の人の記事-' + key)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expectNoPrivateIdentity(page, bodies, owner);
    await page.screenshot({ path: info.outputPath('author-articles.png'), fullPage: true });

    // The same profile lists the author's own public works.
    await page
      .getByRole('navigation', { name: '投稿者の活動' })
      .getByRole('link', { name: '作品', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp('/students/' + owner.profileId + '/works$'));
    await expect(page.getByRole('link', { name: workTitle })).toBeVisible();
    await expect(page.getByText('別の人の作品-' + key)).toHaveCount(0);
    await expectNoPrivateIdentity(page, bodies, owner);
    await page.screenshot({ path: info.outputPath('author-works.png'), fullPage: true });

    // Work → author profile.
    await page.goto('/projects/' + projectId);
    await expect(page.getByRole('heading', { level: 1, name: workTitle })).toBeVisible();
    await expectNoPrivateIdentity(page, bodies, owner);
    await page.locator('.detail-author .author').click();
    await expect(page).toHaveURL(new RegExp('/students/' + owner.profileId));
    await expect(page.getByRole('heading', { level: 1, name: profileName })).toBeVisible();
    await expectNoPrivateIdentity(page, bodies, owner);
    expect(bodies.length).toBeGreaterThan(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
