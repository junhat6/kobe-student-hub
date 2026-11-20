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
  articleIds?: string[],
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
    ...(articleIds ? { articleIds } : {}),
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
    // Published last so that recency alone would not put it first: the owner's explicit link must.
    await project(owner, '紐づけた作品-' + key, 'タグを含まない架空の説明', [source.id]);
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
    const context = page.getByRole('region', { name: '読む前の目安' });
    for (const label of ['想定読者', '前提知識', '読んだあとに'])
      await expect(context.getByText(label, { exact: true })).toBeVisible();
    await expect(context.getByText('投稿者の記載はありません', { exact: true })).toHaveCount(3);
    expect(
      await page.evaluate(() => {
        const context = document.querySelector('.reader-context');
        const body = document.querySelector('.prose');
        return Boolean(
          context &&
          body &&
          context.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }),
    ).toBe(true);
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
    // Explicit owner link → same tag article → tag-matching project, in that order.
    await expect(related.locator('.related-reading-reason')).toHaveText([
      'この記事を紐づけた作品',
      '同じタグ「' + tag + '」の記事',
      'タイトル・説明に「' + tag + '」を含む作品',
    ]);
    await expect(related.getByRole('heading', { level: 3 })).toHaveText([
      '紐づけた作品-' + key,
      '比較した結果-' + key,
      '制作した作品-' + key,
    ]);
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

test('an article with no related reading still offers a way onward', async ({
  page,
  browser,
}, info) => {
  const contexts: BrowserContext[] = [];
  const key = 'lonely-' + info.project.name + '-' + Date.now().toString(36);
  try {
    const owner = await actor(browser, contexts, '架空制作者-' + key);
    const lonely = await article(owner, '関連のない記事-' + key, '孤立' + Date.now().toString(36));
    await page.goto('/articles/' + lonely.id);
    const related = page.getByRole('region', { name: '関連する記事・作品' });
    await expect(
      related.getByText('同じタグの記事・作品はまだありません。', { exact: false }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath('ordinary-related-empty.png'),
      fullPage: true,
      scale: 'css',
    });
    await related.getByRole('link', { name: 'ほかの記事を探す →', exact: true }).click();
    await expect(page).toHaveURL(ORIGIN + '/');
    await expect(page.getByRole('button', { name: '新着', exact: true })).toBeVisible();
  } finally {
    for (const context of contexts) await context.close();
  }
});

test('ordinary popularity and related read failures have truthful empty and retry states', async ({
  page,
  browser,
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
  // Articles exist but nobody has liked any: no invented ranking, and a way back to new posts.
  const contexts: BrowserContext[] = [];
  try {
    const owner = await actor(browser, contexts, '架空制作者-unliked-' + info.project.name);
    await article(owner, 'いいね前の記事-' + info.project.name + '-' + Date.now().toString(36));
  } finally {
    for (const context of contexts) await context.close();
  }
  await page.route('**/api/discovery', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), popular: [] } });
  });
  await page.reload();
  await page.getByRole('button', { name: '人気', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '公開いいねのある記事はまだありません', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/^公開いいね \d+件$/)).toHaveCount(0);
  await page.getByRole('button', { name: '新着の記事を見る', exact: true }).click();
  await expect(page.getByRole('button', { name: '新着', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
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

test('a failed like change keeps the confirmed state and re-reads instead of resending', async ({
  browser,
}, info) => {
  const contexts: BrowserContext[] = [];
  const key = 'like-failure-' + info.project.name + '-' + Date.now().toString(36);
  try {
    const owner = await actor(browser, contexts, '架空制作者-' + key),
      liker = await actor(browser, contexts, '架空読者-' + key);
    const source = await article(owner, 'いいね失敗の記録-' + key);
    const stored = await liker.context.request.put('/api/private/article-likes/' + source.id, {
      headers: { Origin: ORIGIN, Authorization: 'Bearer csrf.' + liker.csrf },
      data: { liked: true, confirmPublic: true },
    });
    expect(stored.status()).toBe(200);
    const page = await liker.context.newPage();
    const writes: string[] = [];
    await page.route('**/api/private/article-likes/**', async (route) => {
      if (route.request().method() === 'GET') return route.continue();
      writes.push(route.request().method());
      await route.fulfill({ status: 503, body: '' });
    });
    await page.goto('/articles/' + source.id);
    const like = page.getByRole('button', { name: 'いいね済み', exact: true });
    await expect(like).toHaveAttribute('aria-pressed', 'true');
    await like.click();
    // The unlike failed: the button must not claim "not liked" while the server still has it.
    const check = page.getByRole('button', { name: '状態を確認', exact: true });
    await expect(check).toBeVisible();
    await expect(
      page.getByText('保存できたか確認できませんでした', { exact: false }),
    ).toBeVisible();
    expect(writes).toHaveLength(1);
    await check.click();
    await expect(page.getByRole('button', { name: 'いいね済み', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Pressing again re-read the stored state; it did not resend the failed change.
    expect(writes).toHaveLength(1);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
