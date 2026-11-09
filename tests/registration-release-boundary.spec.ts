import { test, expect } from '@playwright/test';
test('explicit sample-reader fixture keeps signup HTTPS-only and authoring UI disabled', async ({
  page,
}) => {
  const privateRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/(?:private|auth)(?:\/|\?|$)/.test(new URL(request.url()).pathname))
      privateRequests.push(request.url());
  });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '新しい知恵と、つくったもの', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'メイン' }).getByRole('link', { name: 'アカウント' }),
  ).toBeVisible();
  await expect(page.locator('.notice')).toContainText('学校Googleでの登録・年度管理を先行提供');
  expect(privateRequests).toEqual([]);
  // The existing public-preview server is HTTP. Real account journeys use the HTTPS fixture.
  for (const route of ['/signup', '/login']) {
    await page.goto(route);
    await expect(
      page.getByRole('heading', { name: 'アカウント画面を読み込めませんでした', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /学校Google/ })).toHaveCount(0);
  }
  for (const [route, title] of [
    ['/account', 'アカウント'],
    ['/guide', '利用ルールと情報の扱い'],
  ]) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '新しい下書き', exact: true })).toHaveCount(0);
  }
  for (const route of ['/drafts', '/works/new', '/moderation']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: 'ページが見つかりません' })).toBeVisible();
    await expect(page.getByRole('button', { name: /学校Google/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '新しい下書き', exact: true })).toHaveCount(0);
  }
  expect(privateRequests.every((url) => new URL(url).pathname === '/api/private/session')).toBe(
    true,
  );
});
