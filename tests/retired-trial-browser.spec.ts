import { test, expect } from '@playwright/test';
test('retired page is inaccessible while public discovery still works', async ({ page }) => {
  const retired = await page.goto('/api/auth/draft-trial');
  expect(retired?.status()).toBe(404);
  await expect(page.getByRole('button', { name: 'Googleで限定ログイン' })).toHaveCount(0);
  expect(await page.locator('#draft-body').count()).toBe(0);
  await page.screenshot({ path: test.info().outputPath('retired-page.png'), fullPage: true });
  await page.goto('/');
  await expect(page.getByRole('article')).toHaveCount(4);
  await page
    .getByRole('heading', { name: 'commitの次に知りたい、ブランチの考え方', exact: true })
    .getByRole('link')
    .click();
  await expect(page.getByRole('heading', { name: 'この記事は、こんな人へ' })).toBeVisible();
  await page.locator('.detail-author .author').click();
  await expect(page.getByRole('heading', { name: 'サンプルの先輩', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('public-author.png'), fullPage: true });
});
test('worker-first denial wins over stale static files and SPA fallback', async ({ request }) => {
  for (const path of [
    '/trial-assets',
    '/trial-assets/',
    '/trial-assets/index.html',
    '/trial-assets/assets/retired-fixture.js',
    '/trial-assets/assets/retired-fixture.js?old=1',
  ]) {
    const r = await request.get(path);
    expect(r.status()).toBe(404);
    expect(r.headers()['cache-control']).toBe('private, no-store');
    expect(await r.text()).not.toContain('RETIRED_TRIAL_SHOULD_NOT_LOAD');
    expect(r.headers()['set-cookie']).toBeUndefined();
  }
  const spa = await request.get('/some-public-spa-path');
  expect(spa.status()).toBe(200);
  expect(await spa.text()).toContain('<div id="root"></div>');
});
test('old cookies and runtime setting cannot authorize ordinary private authoring', async ({
  request,
}) => {
  const headers = {
    Cookie: '__Host-kobe-session=' + 'A'.repeat(43) + '; __Host-kobe-browser=' + 'B'.repeat(43),
    Origin: 'https://127.0.0.1:8792',
  };
  for (const path of [
    '/api/private/session',
    '/api/private/drafts',
    '/api/private/logout-command',
  ]) {
    const r = await request.get(path, { headers });
    expect(r.status()).toBe(path === '/api/private/session' ? 503 : 401);
    expect(r.headers()['set-cookie']).toBeUndefined();
  }
  for (const path of [
    '/api/auth/bootstrap',
    '/api/auth/command?action=login',
    '/api/auth/start',
    '/api/private/drafts',
  ]) {
    const r = await request.post(path, { headers });
    expect(r.status()).toBe(
      path === '/api/private/drafts' ? 401 : path === '/api/auth/start' ? 400 : 503,
    );
    expect(r.headers()['set-cookie']).toBeUndefined();
  }
  expect((await (await request.get('/api/health')).json()).writesEnabled).toBe(true);
});
test('late query callbacks remove provider parameters without issuing cookies', async ({
  request,
}) => {
  const r = await request.get('/api/auth/callback?code=synthetic-code&state=synthetic-state', {
    maxRedirects: 0,
  });
  expect(r.status()).toBe(303);
  expect(r.headers()['location']).toBe('https://127.0.0.1:8792/account#authentication-failed');
  expect(r.headers()['set-cookie']).toBeUndefined();
  expect(await r.text()).toBe('');
});
