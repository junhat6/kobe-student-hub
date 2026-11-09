import { completeGoogleFormPost } from './helpers/google-form-post';
import { test, expect, type Browser, type BrowserContext } from '@playwright/test';

const ORIGIN = 'https://127.0.0.1:8790';
type Actor = { context: BrowserContext; csrf: string; profileId: string };

// Use the existing local signed-Google HTTP fixture and actual D1 writes; no identity bypass.
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
  expect(authorization.searchParams.get('response_mode')).toBe('form_post');
  const state = authorization.searchParams.get('state')!;
  const nonce = authorization.searchParams.get('nonce')!;
  expect(
    (
      await context.request.get(
        '/__control/token?' +
          new URLSearchParams({ state, nonce, actor: 'fictional-search-' + crypto.randomUUID() }),
      )
    ).status(),
  ).toBe(200);
  const callback = await completeGoogleFormPost(context.request, ORIGIN, { state, code: state });
  expect(callback.status()).toBe(303);
  const session = await context.request.get('/api/private/session');
  expect(session.status()).toBe(200);
  const { csrfToken } = await session.json();
  const profile = await context.request.post('/api/private/profile', {
    headers: { ...headers, Authorization: 'Bearer csrf.' + csrfToken },
    data: { displayName: name, department: '', yearLabel: '', bio: '', confirmPublic: true },
  });
  expect(profile.status()).toBe(201);
  return { context, csrf: csrfToken, profileId: (await profile.json()).profile.id };
}

async function write(owner: Actor, path: string, data: object, expected = 201) {
  const response = await owner.context.request.post(path, {
    headers: { Origin: ORIGIN, Authorization: 'Bearer csrf.' + owner.csrf },
    data,
  });
  expect(response.status()).toBe(expected);
  return response.json();
}

async function article(owner: Actor, title: string, tag = 'AI') {
  const draft = await write(owner, '/api/private/drafts', {
    title,
    body: '## 架空の公開本文\n\n本文だけの語は検索対象にしません。',
  });
  const published = await write(owner, '/api/private/publications/' + draft.id, {
    expectedVersion: draft.version,
    confirmPublic: true,
    summary: '比較した条件と結果の制作ノート',
    tags: [tag],
    minutes: 1,
    audience: '',
    prerequisite: '',
    outcome: '',
  });
  return { id: published.contentId as string, version: draft.version as number };
}

async function project(
  owner: Actor,
  title: string,
  description = 'DuckDBで集計した架空作品の紹介',
) {
  const draft = await write(owner, '/api/private/project-drafts', {
    title,
    description,
    githubUrl: '',
    demoUrl: '',
  });
  const published = await write(owner, '/api/private/project-publications/' + draft.id, {
    expectedVersion: draft.version,
    confirmPublic: true,
  });
  return { id: published.projectId as string, version: draft.version as number };
}

test('ordinary new, real popularity, tag recommendations and related article/project journeys', async ({
  page,
  browser,
}, info) => {
  const contexts: BrowserContext[] = [];
  const key = 'discovery-' + info.project.name + '-' + Date.now().toString(36),
    tag = 'AI-' + Date.now().toString(36);
  try {
    const owner = await actor(browser, contexts, '架空制作者-' + key),
      liker = await actor(browser, contexts, '架空読者-' + key);
    const source = await article(owner, '技術選定の記録-' + key, tag),
      next = await article(owner, '比較した結果-' + key, tag),
      work = await project(owner, '制作した作品-' + key, tag + 'を使った架空作品の説明');
    const liked = await liker.context.request.put('/api/private/article-likes/' + source.id, {
      headers: { Origin: ORIGIN, Authorization: 'Bearer csrf.' + liker.csrf },
      data: { liked: true, confirmPublic: true },
    });
    expect(liked.status()).toBe(200);
    const discoveryCalls: string[] = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname.startsWith('/api/discovery')) discoveryCalls.push(r.url());
    });
    await page.goto('/');
    await expect(
      page.getByRole('link', { name: '技術選定の記録-' + key, exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '人気', exact: true }).click();
    await expect(page.getByText('公開いいね 1件', { exact: true }).last()).toBeVisible();
    await expect(
      page.getByRole('link', { name: '技術選定の記録-' + key, exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath('ordinary-popular.png'),
      fullPage: true,
      scale: 'css',
    });
    await page.getByRole('button', { name: 'タグからおすすめ', exact: true }).click();
    await page.getByRole('button', { name: '# ' + tag, exact: true }).click();
    await expect(
      page.getByRole('link', { name: '比較した結果-' + key, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('「' + tag + '」の新着記事です。閲覧履歴はおすすめに使いません。', {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole('link', { name: '技術選定の記録-' + key, exact: true }).click();
    const related = page.getByRole('region', { name: '関連する記事・作品' });
    await expect(
      related.getByRole('link', { name: '比較した結果-' + key, exact: true }),
    ).toBeVisible();
    await expect(
      related.getByRole('link', { name: '制作した作品-' + key, exact: true }),
    ).toBeVisible();
    await expect(related.getByText('同じタグ「' + tag + '」の記事', { exact: true })).toBeVisible();
    await expect(
      related.getByText('タイトル・説明に「' + tag + '」を含む作品', { exact: true }),
    ).toBeVisible();
    await expect(
      related.getByRole('link', { name: '技術選定の記録-' + key, exact: true }),
    ).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath('ordinary-related.png'),
      fullPage: true,
      scale: 'css',
    });
    await related.getByRole('link', { name: '比較した結果-' + key, exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: '比較した結果-' + key, exact: true }),
    ).toBeVisible();
    await page.goto('/articles/' + source.id);
    await page
      .getByRole('region', { name: '関連する記事・作品' })
      .getByRole('link', { name: '制作した作品-' + key, exact: true })
      .click();
    await expect(
      page.getByRole('heading', { level: 1, name: '制作した作品-' + key, exact: true }),
    ).toBeVisible();
    expect(discoveryCalls.some((url) => url.endsWith('/api/discovery/articles/' + source.id))).toBe(
      true,
    );
  } finally {
    for (const context of contexts) await context.close();
  }
});

test('ordinary popularity and related read failures have truthful empty and retry states', async ({
  page,
}, info) => {
  await page.route('**/api/discovery', (route) =>
    route.fulfill({ json: { recent: [], popular: [] } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: '人気', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'まだ記事がありません', exact: true }),
  ).toBeVisible();
  await page.unroute('**/api/discovery');
  let fail = true;
  await page.route('**/api/discovery', async (route) =>
    fail
      ? route.fulfill({ status: 503, json: { error: 'discovery_unavailable' } })
      : route.continue(),
  );
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('記事一覧を表示できませんでした');
  fail = false;
  await page.getByRole('button', { name: 'もう一度読み込む', exact: true }).click();
  await expect(page.getByRole('button', { name: '新着', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath('ordinary-discovery-recovered.png'),
    fullPage: true,
    scale: 'css',
  });
});
