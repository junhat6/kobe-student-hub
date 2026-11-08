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
test('unknown-URL readers discover a fresh publication then its author through anonymous native links', async ({
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
    await reader.goto('/lab/discover');
    const card = reader
      .getByRole('article')
      .filter({ has: reader.locator('a[href="/lab/articles/' + data.ids[1] + '"]') });
    await expect(card).toContainText('次に試せる公開記事');
    await expect(reader.getByText('公開していない秘密の下書き')).toHaveCount(0);
    await expect(card.getByText('基本操作', { exact: true })).toBeVisible();
    await card.getByRole('link', { name: '次に試せる公開記事', exact: true }).click();
    await expect(
      reader.getByRole('heading', { name: '次に試せる公開記事', exact: true }),
    ).toBeVisible();
    await reader.getByRole('link', { name: '架空の活動投稿者', exact: true }).click();
    await expect(
      reader.getByRole('heading', { name: '架空の活動投稿者', exact: true }),
    ).toBeVisible();
    await reader.getByRole('link', { name: '新しい公開記事を探す', exact: true }).click();
    await expect(
      reader.getByRole('heading', { name: '新しい公開記事', exact: true }),
    ).toBeVisible();
    await expect(card).toBeVisible();
    await reader.goBack();
    await expect(
      reader.getByRole('heading', { name: '架空の活動投稿者', exact: true }),
    ).toBeVisible();
    expect(privateCalls).toBe(0);
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    try {
      await Promise.all(headerChecks);
    } finally {
      await context.close();
    }
  }
});
test('empty feed and failed feed stay distinct and explicit retry can recover', async ({
  page,
}) => {
  let mode: 'empty' | 'failed' | 'actual' = 'empty';
  await page.route('**/__lab/discovery', (route) =>
    mode === 'actual'
      ? route.continue()
      : route.fulfill({
          status: mode === 'empty' ? 200 : 503,
          contentType: 'application/json',
          body: mode === 'empty' ? '{"cards":[]}' : '{"error":"PRIVATE_REASON"}',
        }),
  );
  await page.goto('/lab/discover');
  await expect(
    page.getByRole('heading', { name: '公開記事はまだありません', exact: true }),
  ).toBeVisible();
  mode = 'failed';
  await page.reload();
  await expect(
    page.getByRole('heading', { name: '公開記事を表示できません', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '公開記事はまだありません', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText('PRIVATE_REASON')).toHaveCount(0);
  mode = 'empty';
  await page.getByRole('button', { name: 'もう一度確認', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '公開記事はまだありません', exact: true }),
  ).toBeVisible();
});
