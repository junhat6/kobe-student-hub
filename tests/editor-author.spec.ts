import { test, expect, type Page } from '@playwright/test';
const origin = 'https://127.0.0.1:8788';
async function seed(page: Page) {
  await page.goto('/lab/articles/00000000-0000-4000-8000-000000000000');
  return page.evaluate(async () => {
    const session = (await (
      await fetch('/__fixture/profile-session', { method: 'POST' })
    ).json()) as { csrfToken: string };
    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer csrf.' + session.csrfToken,
    };
    async function post(path: string, value: unknown) {
      const r = await fetch(path, { method: 'POST', headers, body: JSON.stringify(value) });
      if (!r.ok) throw Error('fixture setup failed');
      return r.json() as Promise<{
        id: string;
        version: number;
        contentId: string;
        profile: { id: string };
      }>;
    }
    const p = await post('/api/private/profile', {
      displayName: '架空の活動投稿者',
      bio: '<script>window.authorInjected=true</script>',
      confirmPublic: true,
    });
    const ids = [];
    for (const title of ['最初の公開記事', '次に試せる公開記事']) {
      const d = await post('/api/private/drafts', {
        title,
        body: '# 架空の本文\n\n試すための手順',
      });
      const published = await post('/api/private/publications/' + d.id, {
        expectedVersion: d.version,
        confirmPublic: true,
        summary: '活動を試すための概要',
        tags: ['学び'],
        minutes: 5,
        prerequisite: '基本操作',
        outcome: '自分で試せる',
      });
      ids.push(published.contentId);
    }
    await post('/api/private/drafts', { title: '公開していない秘密の下書き', body: '秘密の本文' });
    return { authorId: p.profile.id as string, ids: ids as string[] };
  });
}
test('article author leads to published activities and native article return without private requests', async ({
  page,
  browser,
}) => {
  const data = await seed(page);
  const device = test.info().project.use;
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: origin,
    viewport: page.viewportSize(),
    screen: device.screen,
    isMobile: device.isMobile,
    hasTouch: device.hasTouch,
    deviceScaleFactor: device.deviceScaleFactor,
    userAgent: device.userAgent,
  });
  const headerChecks: Promise<void>[] = [];
  try {
    const reader = await context.newPage();
    let privateCalls = 0;
    reader.on('request', (r) => {
      if (r.url().includes('/api/private/') || r.url().includes('/__fixture/')) privateCalls++;
      if (r.url().includes('/__lab/'))
        headerChecks.push(
          r.allHeaders().then((headers) => {
            expect(Object.hasOwn(headers, 'cookie')).toBe(false);
            expect(Object.hasOwn(headers, 'x-csrf-token')).toBe(false);
          }),
        );
    });
    await reader.goto('/lab/articles/' + data.ids[0]);
    await reader.getByRole('link', { name: '架空の活動投稿者', exact: true }).click();
    await expect(
      reader.getByRole('heading', { name: '架空の活動投稿者', exact: true }),
    ).toBeVisible();
    await expect(
      reader.getByRole('region', { name: 'この投稿者の公開記事' }).getByRole('article'),
    ).toHaveCount(2);
    await expect(reader.getByText('公開していない秘密の下書き')).toHaveCount(0);
    await expect(
      reader.getByText('<script>window.authorInjected=true</script>', { exact: true }),
    ).toBeVisible();
    expect(await reader.evaluate(() => 'authorInjected' in window)).toBe(false);
    const link = reader.getByRole('link', { name: '次に試せる公開記事', exact: true });
    await link.click();
    await expect(
      reader.getByRole('heading', { name: '次に試せる公開記事', exact: true }),
    ).toBeVisible();
    await reader.goBack();
    await expect(link).toBeVisible();
    await reader.getByRole('link', { name: '← 元の記事に戻る', exact: true }).click();
    await expect(
      reader.getByRole('heading', { name: '最初の公開記事', exact: true }),
    ).toBeVisible();
    await reader.goto('/lab/authors/' + data.authorId);
    await expect(
      reader.getByRole('heading', { name: '架空の活動投稿者', exact: true }),
    ).toBeVisible();
    await expect(reader.getByRole('link', { name: '← 元の記事に戻る', exact: true })).toHaveCount(
      0,
    );
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(privateCalls).toBe(0);
  } finally {
    try {
      await Promise.all(headerChecks);
    } finally {
      await context.close();
    }
  }
});
test('anonymous author HTTP contract fails closed for invalid routes and methods', async ({
  page,
  playwright,
}) => {
  const data = await seed(page);
  const anonymous = await playwright.request.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    storageState: { cookies: [], origins: [] },
  });
  try {
    const response = await anonymous.get('/__lab/authors/' + data.authorId, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers['set-cookie']).toBeUndefined();
    expect(headers.location).toBeUndefined();
    expect(headers['cache-control']).toContain('no-store');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(headers['x-content-type-options']).toBe('nosniff');
  } finally {
    await anonymous.dispose();
  }
  const result = await page.evaluate(async (id) => {
    const path = '/__lab/authors/' + id;
    const r = await fetch(path, { credentials: 'omit' });
    const value = (await r.json()) as {
      author: Record<string, unknown>;
      entries: Record<string, unknown>[];
    };
    const query = await fetch(path + '?unexpected=1', { credentials: 'omit' });
    const invalid = await fetch('/__lab/authors/bad.id', { credentials: 'omit' });
    const method = await fetch(path, { method: 'POST', credentials: 'omit' });
    return {
      status: r.status,
      cache: r.headers.get('cache-control'),
      location: r.headers.get('location'),
      value,
      query: query.status,
      invalid: invalid.status,
      method: method.status,
      allow: method.headers.get('allow'),
    };
  }, data.authorId);
  expect(result.status).toBe(200);
  expect(result.cache).toContain('no-store');
  expect(result.location).toBeNull();
  expect(Object.keys(result.value).sort()).toEqual(['author', 'entries']);
  expect(Object.keys(result.value.author).sort()).toEqual([
    'bio',
    'department',
    'id',
    'initials',
    'name',
    'year',
  ]);
  for (const item of result.value.entries)
    expect(Object.keys(item).sort()).toEqual([
      'audience',
      'id',
      'minutes',
      'outcome',
      'prerequisite',
      'summary',
      'tags',
      'title',
      'updatedAt',
    ]);
  expect(result.query).toBe(404);
  expect(result.invalid).toBe(404);
  expect(result.method).toBe(405);
  expect(result.allow).toBe('GET');
});
test('failed author reads hide previous content and permit an explicit recovery', async ({
  page,
}) => {
  const data = await seed(page);
  await page.goto('/lab/authors/' + data.authorId);
  await expect(page.getByRole('heading', { name: '架空の活動投稿者', exact: true })).toBeVisible();
  let failed = true;
  await page.route('**/__lab/authors/*', (route) =>
    failed
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"error":"private diagnostic"}',
        })
      : route.continue(),
  );
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'この投稿者を表示できません', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: '架空の活動投稿者', exact: true })).toHaveCount(0);
  await expect(page.getByText('private diagnostic')).toHaveCount(0);
  failed = false;
  await page.getByRole('button', { name: 'もう一度確認', exact: true }).click();
  await expect(page.getByRole('heading', { name: '架空の活動投稿者', exact: true })).toBeVisible();
});
