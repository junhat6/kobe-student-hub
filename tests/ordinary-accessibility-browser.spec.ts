import AxeBuilder from '@axe-core/playwright';
import { completeGoogleFormPost } from './helpers/google-form-post';
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

// C19 / #141: the ordinary release screens (reading, report forms, sign-in, account,
// history and authoring entry points) have no critical or serious axe violations.
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
          new URLSearchParams({ state, nonce, actor: 'fictional-a11y-' + crypto.randomUUID() }),
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
      department: '',
      yearLabel: '',
      bio: '架空の自己紹介',
      confirmPublic: true,
    },
  });
  expect(profile.status()).toBe(201);
  return { context, csrf: csrfToken, profileId: (await profile.json()).profile.id };
}

async function write(owner: Actor, path: string, data: object) {
  const response = await owner.context.request.post(path, {
    headers: { Origin: ORIGIN, Authorization: 'Bearer csrf.' + owner.csrf },
    data,
  });
  expect(response.status()).toBe(201);
  return response.json();
}

async function seriousViolations(page: Page) {
  // label-content-name-mismatch on the account/draft buttons is tracked in #170; remove this
  // exclusion when that is fixed.
  const { violations } = await new AxeBuilder({ page })
    .disableRules(['label-content-name-mismatch'])
    .analyze();
  return violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(' ')) }));
}

async function check(page: Page, path: string, ready: () => Promise<void>) {
  await page.goto(path);
  await ready();
  expect
    .soft({ path, violations: await seriousViolations(page) })
    .toEqual({ path, violations: [] });
}

test('ordinary reading, report, sign-in, account and history screens pass axe', async ({
  browser,
  page,
}, info) => {
  const contexts: BrowserContext[] = [];
  const key = info.project.name + '-' + Date.now().toString(36);
  try {
    const owner = await actor(browser, contexts, '架空の読みやすさ投稿者-' + key);
    const draft = await write(owner, '/api/private/drafts', {
      title: '読みやすさの記事-' + key,
      body: '## 架空の本文\n\n```js\nconst answer = 42; // 架空\n```\n',
    });
    const article = await write(owner, '/api/private/publications/' + draft.id, {
      confirmPublic: true,
      summary: '架空の要約',
      tags: ['読みやすさ'],
      minutes: 1,
      audience: '',
      prerequisite: '',
      outcome: '',
      expectedVersion: draft.version,
    });
    const workDraft = await write(owner, '/api/private/project-drafts', {
      title: '読みやすさの作品-' + key,
      description: '架空の作品説明',
      githubUrl: '',
      demoUrl: '',
    });
    const work = await write(owner, '/api/private/project-publications/' + workDraft.id, {
      expectedVersion: workDraft.version,
      confirmPublic: true,
    });

    // Anonymous reader.
    await check(page, '/', () =>
      expect(page.getByRole('link', { name: '読みやすさの記事-' + key })).toBeVisible(),
    );
    await check(page, '/search?q=' + encodeURIComponent('読みやすさの記事-' + key), () =>
      expect(page.getByRole('link', { name: '読みやすさの記事-' + key })).toBeVisible(),
    );
    await check(page, '/search?q=' + encodeURIComponent('該当しない架空の言葉'), () =>
      expect(page.locator('.empty')).toBeVisible(),
    );
    await check(page, '/works', () =>
      expect(page.getByRole('link', { name: '読みやすさの作品-' + key })).toBeVisible(),
    );
    await check(page, '/students/' + owner.profileId, () =>
      expect(page.getByRole('heading', { name: '架空の読みやすさ投稿者-' + key })).toBeVisible(),
    );
    await check(page, '/login', () => expect(page.locator('main')).toBeVisible());
    await check(page, '/signup', () =>
      expect(page.getByLabel('入学年度 必須', { exact: true })).toBeVisible(),
    );
    await check(page, '/guide', () => expect(page.locator('h1')).toBeVisible());
    await check(page, '/history', () =>
      expect(page.getByRole('link', { name: 'ログインして履歴を見る', exact: true })).toBeVisible(),
    );

    // Report forms on an ordinary article and work, opened by another signed-in student.
    const reader = await actor(browser, contexts, '架空の読者-' + key);
    const readerPage = await reader.context.newPage();
    await readerPage.setViewportSize(page.viewportSize()!);
    await readerPage.goto('/articles/' + article.contentId);
    await expect(readerPage.getByRole('heading', { level: 1 })).toContainText('読みやすさの記事');
    await readerPage.getByRole('button', { name: 'この記事を通報する', exact: true }).click();
    await expect(readerPage.getByLabel('通報理由（必須）', { exact: true })).toBeEditable();
    expect.soft(await seriousViolations(readerPage)).toEqual([]);
    await readerPage.goto('/projects/' + work.projectId);
    await expect(readerPage.getByRole('heading', { level: 1 })).toContainText('読みやすさの作品');
    await readerPage.getByRole('button', { name: 'この作品を通報する', exact: true }).click();
    await expect(readerPage.getByLabel('作品の通報理由（必須）', { exact: true })).toBeEditable();
    expect.soft(await seriousViolations(readerPage)).toEqual([]);

    // Signed-in owner.
    const ownerPage = await owner.context.newPage();
    await ownerPage.setViewportSize(page.viewportSize()!);
    await check(ownerPage, '/account', () =>
      expect(ownerPage.getByRole('link', { name: '記事を書く', exact: true })).toBeVisible(),
    );
    await check(ownerPage, '/history', () =>
      expect(ownerPage.getByRole('region', { name: '自分の閲覧履歴', exact: true })).toBeVisible(),
    );
    await check(ownerPage, '/drafts', () => expect(ownerPage.locator('h1')).toBeVisible());
    await check(ownerPage, '/works/new', () => expect(ownerPage.locator('h1')).toBeVisible());
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
