import { test, expect } from '@playwright/test';
test('same samples and order, optional context, direct link and back', async ({
  page,
}, testInfo) => {
  await page.goto('/study/cards?variant=a');
  await expect(page.getByRole('heading', { name: '自分に合いそうな記事を、選ぶ。' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'カードA' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.card-reader-context')).toHaveCount(0);
  const titles = await page.locator('.card h3').allTextContents();
  await expect(page.getByRole('article')).toHaveCount(3);
  await page.getByRole('button', { name: 'カードB' }).click();
  await expect(page).toHaveURL(/variant=b/);
  await expect(page.locator('.card-reader-context')).toHaveCount(3);
  expect(await page.locator('.card h3').allTextContents()).toEqual(titles);
  await page.reload();
  await expect(page.getByRole('button', { name: 'カードB' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('読む前に知っておくこと', { exact: true })).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('cards-b.png'), fullPage: true, scale: 'css' });
  await page.getByRole('heading', { name: titles[0], exact: true }).getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'この記事は、こんな人へ' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('button', { name: 'カードB' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'カードA' }).click();
  await page.screenshot({ path: testInfo.outputPath('cards-a.png'), fullPage: true, scale: 'css' });
  await page.goto('/');
  await expect(page.locator('.card-reader-context')).toHaveCount(0);
});
test('study failure recovery does not pretend to record responses', async ({ page }) => {
  await page.route('**/api/catalog', (r) => r.fulfill({ status: 503, body: '{}' }));
  await page.goto('/study/cards?variant=b');
  await expect(
    page.getByRole('heading', { name: '記事・作品を読み込めませんでした' }),
  ).toBeVisible();
  await page.unroute('**/api/catalog');
  await page.getByRole('button', { name: '再読み込み' }).click();
  await expect(page.locator('.card-reader-context')).toHaveCount(3);
  await expect(page.getByText(/回答収集や選択イベント送信/)).toBeVisible();
});
