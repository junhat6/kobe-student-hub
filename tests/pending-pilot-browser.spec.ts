import { test, expect } from '@playwright/test';
test('fictional browser receives pending-only receipt through real pilot page and JOSE callback', async ({
  page,
  context,
}) => {
  await page.route('https://accounts.google.com/**', async (route) => {
    const target = new URL(route.request().url());
    expect(target.searchParams.get('prompt')).toBe('select_account');
    await route.fulfill({
      status: 303,
      headers: {
        Location:
          'https://127.0.0.1:8791/api/auth/callback?state=' +
          target.searchParams.get('state') +
          '&code=' +
          target.searchParams.get('nonce'),
      },
    });
  });
  const asset = await page.request.get('/');
  expect(asset.status()).toBe(200);
  expect(await asset.text()).toContain('<div id="root"></div>');
  const fallback = await page.request.get('/fictional-spa-fallback');
  expect(await fallback.text()).toBe(await asset.text());
  await page.goto('/api/auth/pilot');
  await expect(page.getByRole('heading', { name: '学校アカウント申請受付' })).toBeVisible();
  await page.request.post('/api/auth/bootstrap', { headers: { Origin: 'https://127.0.0.1:8791' } });
  await page.reload();
  await page.getByRole('button', { name: 'Googleで申請する' }).click();
  await expect(page.getByRole('status')).toContainText('申請を受け付けました');
  expect(page.url()).toBe('https://127.0.0.1:8791/api/auth/pilot');
  expect((await context.cookies()).some((c) => c.name === '__Host-kobe-session')).toBe(false);
  expect((await page.request.get('/api/private/session')).status()).toBe(404);
});
