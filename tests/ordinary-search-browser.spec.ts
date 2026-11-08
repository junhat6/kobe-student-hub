import { test, expect, type Browser, type BrowserContext, type TestInfo } from '@playwright/test';

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
  const callback = await context.request.get(
    '/api/auth/callback?' + new URLSearchParams({ state, code: state }),
    { maxRedirects: 0 },
  );
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

async function article(owner: Actor, title: string) {
  const draft = await write(owner, '/api/private/drafts', {
    title,
    body: '## 架空の公開本文\n\n本文だけの語は検索対象にしません。',
  });
  const published = await write(owner, '/api/private/publications/' + draft.id, {
    expectedVersion: draft.version,
    confirmPublic: true,
    summary: '比較した条件と結果の制作ノート',
    tags: ['AI'],
    minutes: 1,
    audience: '',
    prerequisite: '',
    outcome: '',
  });
  return { id: published.contentId as string, version: draft.version as number };
}

async function project(owner: Actor, title: string) {
  const draft = await write(owner, '/api/private/project-drafts', {
    title,
    description: 'DuckDBで集計した架空作品の紹介',
    githubUrl: '',
    demoUrl: '',
  });
  const published = await write(owner, '/api/private/project-publications/' + draft.id, {
    expectedVersion: draft.version,
    confirmPublic: true,
  });
  return { id: published.projectId as string, version: draft.version as number };
}

const marker = (info: TestInfo) => `search-${info.project.name}-${Date.now().toString(36)}`;

test('ordinary search finds article-only and project-only authors and preserves query, type and article tag in its URL', async ({
  page,
  browser,
}, info) => {
  const contexts: BrowserContext[] = [];
  const key = marker(info);
  try {
    const articleOwner = await actor(browser, contexts, '架空記事投稿者-' + key);
    const projectOwner = await actor(browser, contexts, '架空作品投稿者-' + key);
    const entry = await article(articleOwner, 'AI制作ノート-' + key);
    const work = await project(projectOwner, 'DuckDB作品-' + key);
    const stoppedEntry = await article(articleOwner, '公開停止記事-' + key);
    const stoppedWork = await project(projectOwner, '公開停止作品-' + key);
    const hiddenEntry = await article(articleOwner, '一時非公開記事-' + key);
    for (const [owner, kind, value] of [
      [articleOwner, 'article', stoppedEntry],
      [projectOwner, 'project', stoppedWork],
    ] as const)
      await write(
        owner,
        '/api/private/publication-stops/' + kind + '/' + value.id,
        { expectedSourceVersion: value.version, confirmStop: true },
        200,
      );
    for (let index = 0; index < 3; index++) {
      const reporter = await actor(browser, contexts, `架空通報者${index}-${key}`);
      await write(
        reporter,
        '/api/private/reports/' + hiddenEntry.id,
        { reason: '架空の確認依頼', detail: '' },
        200,
      );
    }

    const privateRequests: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/private/'))
        privateRequests.push(new URL(request.url()).pathname);
    });
    const articleResponse = await page.request.get('/api/articles');
    const projectResponse = await page.request.get('/api/projects');
    expect(articleResponse.status()).toBe(200);
    expect(projectResponse.status()).toBe(200);
    const publicArticles = await articleResponse.text();
    const publicProjects = await projectResponse.text();
    expect(publicArticles).toContain(entry.id);
    expect(publicProjects).toContain(work.id);
    for (const id of [stoppedEntry.id, hiddenEntry.id]) expect(publicArticles).not.toContain(id);
    expect(publicProjects).not.toContain(stoppedWork.id);
    await page.goto('/search?' + new URLSearchParams({ q: key }));
    await expect(
      page.getByRole('link', { name: 'AI制作ノート-' + key, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'DuckDB作品-' + key, exact: true })).toBeVisible();
    await expect(page.locator('.search-result-count')).toHaveText('記事 1件 · 作品 1件');
    await expect(page.locator('main')).not.toContainText('公開停止記事-' + key);
    await expect(page.locator('main')).not.toContainText('公開停止作品-' + key);
    await expect(page.locator('main')).not.toContainText('一時非公開記事-' + key);
    await expect(
      page.getByText(
        '新しい公開記事・作品それぞれ最大20件のタイトル・紹介・記事タグ・投稿者名が検索対象です。',
        { exact: true },
      ),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath('search-articles-and-projects.png'),
      fullPage: true,
      scale: 'css',
    });

    await page.getByRole('searchbox').fill('架空作品投稿者-' + key);
    await page.getByRole('button', { name: '検索', exact: true }).click();
    await expect(page.locator('.search-result-count')).toHaveText('記事 0件 · 作品 1件');
    await page.locator('.project-card-author').click();
    await expect(
      page.getByRole('heading', { name: '架空作品投稿者-' + key, exact: true }),
    ).toBeVisible();
    await page
      .getByRole('navigation', { name: '投稿者の活動' })
      .getByRole('link', { name: '記事', exact: true })
      .click();
    await expect(
      page.getByText('公開している記事はまだありません。', { exact: true }),
    ).toBeVisible();
    await page.goto('/search?' + new URLSearchParams({ q: '架空記事投稿者-' + key }));
    await expect(page.locator('.search-result-count')).toHaveText('記事 1件 · 作品 0件');
    await page.locator('.discovery-author').click();
    await expect(
      page.getByRole('heading', { name: '架空記事投稿者-' + key, exact: true }),
    ).toBeVisible();
    await page
      .getByRole('navigation', { name: '投稿者の活動' })
      .getByRole('link', { name: '作品', exact: true })
      .click();
    await expect(
      page.getByText('公開している作品はまだありません。', { exact: true }),
    ).toBeVisible();

    await page.goto('/search?' + new URLSearchParams({ q: key }));
    await page.getByRole('button', { name: '記事', exact: true }).click();
    await page.getByRole('combobox', { name: 'タグ（記事）', exact: true }).selectOption('AI');
    await expect(page).toHaveURL(
      ORIGIN + '/search?' + new URLSearchParams({ q: key, type: 'article', tag: 'AI' }),
    );
    await page.goto('/search?' + new URLSearchParams({ q: key }));
    await expect(
      page.getByRole('link', { name: 'AI制作ノート-' + key, exact: true }),
    ).toBeVisible();
    // Two events in one turn must build on the URL from the preceding selection.
    await page.evaluate(() => {
      const button = Array.from(
        document.querySelectorAll<HTMLButtonElement>('.search-types button'),
      ).find((item) => item.textContent === '記事')!;
      button.click();
      const select = document.getElementById('ordinary-search-tag');
      if (!(select instanceof HTMLSelectElement)) throw new Error('Article tag select is missing');
      select.value = 'AI';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page).toHaveURL(
      ORIGIN + '/search?' + new URLSearchParams({ q: key, type: 'article', tag: 'AI' }),
    );
    await page.reload();
    await expect(page.getByRole('button', { name: '記事', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('combobox', { name: 'タグ（記事）', exact: true })).toHaveValue(
      'AI',
    );
    await expect(page.getByRole('searchbox')).toHaveValue(key);
    await page.goBack();
    await expect(page.getByRole('combobox', { name: 'タグ（記事）', exact: true })).toHaveValue('');
    await page.goForward();
    await expect(page.getByRole('combobox', { name: 'タグ（記事）', exact: true })).toHaveValue(
      'AI',
    );
    await page.getByRole('searchbox').fill('ＡＩ制作');
    await page.getByRole('button', { name: '検索', exact: true }).click();
    expect(new URL(page.url()).searchParams.get('type')).toBe('article');
    expect(new URL(page.url()).searchParams.get('tag')).toBe('AI');
    await expect(
      page.getByRole('link', { name: 'AI制作ノート-' + key, exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'AI制作ノート-' + key, exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'AI制作ノート-' + key, exact: true }),
    ).toBeVisible();
    await page
      .locator('.detail-header .tags')
      .getByRole('link', { name: '# AI', exact: true })
      .click();
    await expect(page).toHaveURL(ORIGIN + '/search?type=article&tag=AI');
    await page
      .locator('.author-lab-tags')
      .first()
      .getByRole('link', { name: '# AI', exact: true })
      .click();
    await expect(page).toHaveURL(ORIGIN + '/search?type=article&tag=AI');
    await page.goto('/search?' + new URLSearchParams({ q: key, type: 'project', tag: 'AI' }));
    await expect(page.getByText('タグは記事が対象です。', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'タグを解除', exact: true }).click();
    await expect(page.locator('.search-result-count')).toHaveText('作品 1件');
    await expect(page.getByRole('link', { name: 'DuckDB作品-' + key, exact: true })).toBeVisible();
    await page.getByRole('searchbox').fill('架空の該当なし-' + key);
    await page.getByRole('button', { name: '検索', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '一致する記事・作品はありません', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '検索条件を解除', exact: true }).click();
    await expect(page).toHaveURL(ORIGIN + '/search');
    expect(privateRequests).toEqual([]);
  } finally {
    for (const context of contexts) await context.close();
  }
});

test('ordinary search keeps available results when the other public API fails and retries only that read', async ({
  page,
  browser,
}, info) => {
  const contexts: BrowserContext[] = [];
  const key = marker(info);
  try {
    const articleOwner = await actor(browser, contexts, '架空記事投稿者-' + key);
    const projectOwner = await actor(browser, contexts, '架空作品投稿者-' + key);
    await article(articleOwner, '検索の記録-' + key);
    await project(projectOwner, '集計作品-' + key);
    const privateRequests: string[] = [];
    const counts = { articles: 0, projects: 0 };
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/api/private/')) privateRequests.push(path);
      if (path === '/api/articles') counts.articles++;
      if (path === '/api/projects') counts.projects++;
    });
    let failed = true;
    await page.route('**/api/projects', (route) =>
      failed
        ? route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: '{"error":"unavailable"}',
          })
        : route.continue(),
    );
    await page.goto('/search?' + new URLSearchParams({ q: key }));
    await expect(page.getByRole('link', { name: '検索の記録-' + key, exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: '作品の検索結果を確認できません', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.search-result-count')).toHaveText('記事 1件 · 作品：取得失敗');
    await expect(
      page.getByRole('heading', { name: '一致する記事・作品はありません', exact: true }),
    ).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath('search-partial-failure.png'),
      fullPage: true,
      scale: 'css',
    });
    const before = { ...counts };
    failed = false;
    await page.getByRole('button', { name: '作品を再読み込み', exact: true }).click();
    await expect(page.getByRole('link', { name: '集計作品-' + key, exact: true })).toBeVisible();
    expect(counts.articles).toBe(before.articles);
    expect(counts.projects).toBe(before.projects + 1);
    await expect(page.locator('.search-result-count')).toHaveText('記事 1件 · 作品 1件');
    expect(new URL(page.url()).searchParams.get('q')).toBe(key);
    expect(privateRequests).toEqual([]);
  } finally {
    for (const context of contexts) await context.close();
  }
});
