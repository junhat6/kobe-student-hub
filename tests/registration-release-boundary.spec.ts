import { test, expect } from '@playwright/test';
test('default public build exposes no ordinary account or draft routes or private/auth requests', async ({
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
  ).toHaveCount(0);
  for (const route of ['/signup', '/login', '/account', '/drafts']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: 'ページが見つかりません' })).toBeVisible();
    await expect(page.getByRole('button', { name: /学校Google/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '新しい下書き', exact: true })).toHaveCount(0);
  }
  expect(privateRequests).toEqual([]);
});
