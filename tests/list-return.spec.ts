import { test, expect } from '@playwright/test';
const title = '「動いた」で終わらせない、制作ノートの残し方';
const list = '/search?q=%E5%88%B6%E4%BD%9C&tag=%E5%AD%A6%E3%81%B3%E6%96%B9&kind=article';
test('return link and history preserve filters, list position and card focus', async ({
  page,
}, info) => {
  await page.goto(list);
  const card = page.getByRole('heading', { name: title }).getByRole('link');
  await expect(page.getByRole('article')).toHaveCount(1);
  await card.focus();
  await card.scrollIntoViewIfNeeded();
  const y = await page.evaluate(() => scrollY);
  await card.click();
  await expect(page.locator('.reader-context')).toBeVisible();
  await expect(page.getByRole('link', { name: '← 一覧へ', exact: true })).toHaveAttribute(
    'href',
    list,
  );
  await page.goBack();
  await expect(page).toHaveURL(new RegExp('/search\\?'));
  await expect(card).toBeFocused();
  expect(Math.abs((await page.evaluate(() => scrollY)) - y)).toBeLessThan(4);
  await page.goForward();
  await expect(page.locator('.reader-context')).toBeVisible();
  await page.getByRole('link', { name: '← 一覧へ', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('searchbox')).toHaveValue('制作');
  await expect(page.getByRole('button', { name: '記事', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: '学び方の絞り込みを解除' })).toBeVisible();
  await expect(card).toBeFocused();
  expect(Math.abs((await page.evaluate(() => scrollY)) - y)).toBeLessThan(4);
  await page.screenshot({
    path: info.outputPath('restored-list.png'),
    fullPage: true,
    scale: 'css',
  });
  await page.goBack();
  await expect(page.locator('.reader-context')).toBeVisible();
  await page.goForward();
  await expect(card).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('new tab and reload carry filters through the URL, direct links safely default', async ({
  page,
  context,
}, info) => {
  await page.goto(list);
  const card = page.getByRole('heading', { name: title }).getByRole('link');
  const opened = context.waitForEvent('page');
  await card.evaluate((a: HTMLAnchorElement) => {
    window.open(a.href, '_blank');
  });
  const tab = await opened;
  await tab.waitForLoadState();
  await expect(tab.locator('.reader-context')).toBeVisible();
  await tab.reload();
  await tab.getByRole('link', { name: '← 一覧へ', exact: true }).click();
  await expect(tab.getByRole('article')).toHaveCount(1);
  await expect(tab.getByRole('searchbox')).toHaveValue('制作');
  await tab.close();
  for (const suffix of [
    '',
    '?from=' + encodeURIComponent('https://evil.invalid/search'),
    '?from=' + encodeURIComponent('/api/catalog'),
  ]) {
    await page.goto('/articles/learning-notes' + suffix);
    await expect(page.getByRole('link', { name: '← 一覧へ', exact: true })).toHaveAttribute(
      'href',
      '/',
    );
  }
  await page.screenshot({
    path: info.outputPath('direct-link-default.png'),
    fullPage: true,
    scale: 'css',
  });
  await page.getByRole('link', { name: '← 一覧へ', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(4);
});
test('project and comparison list keep their existing list state', async ({ page }) => {
  await page.goto('/?kind=project');
  await page
    .getByRole('heading', { name: 'ひとこと制作ノート', exact: true })
    .getByRole('link')
    .click();
  await page.getByRole('link', { name: '← 一覧へ', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '作品', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.goto('/study/cards?variant=b');
  await page.getByRole('heading', { name: title }).getByRole('link').click();
  await page.getByRole('link', { name: '← 一覧へ', exact: true }).click();
  await expect(page.getByRole('button', { name: 'カードB' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.card-reader-context')).toHaveCount(3);
});
test('related content inherits only a real list snapshot, never article scroll', async ({
  page,
}) => {
  await page.goto('/articles/learning-notes?from=' + encodeURIComponent(list));
  const related = page
    .getByRole('heading', { name: 'ひとこと制作ノート', exact: true })
    .getByRole('link');
  await related.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(200);
  await related.click();
  await page.getByRole('link', { name: '← 一覧へ', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.locator('main')).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  const card = page.getByRole('heading', { name: title }).getByRole('link');
  await card.scrollIntoViewIfNeeded();
  const y = await page.evaluate(() => scrollY);
  await card.click();
  await related.click();
  await page.getByRole('link', { name: '← 一覧へ', exact: true }).click();
  await expect(card).toBeFocused();
  expect(Math.abs((await page.evaluate(() => scrollY)) - y)).toBeLessThan(4);
});
