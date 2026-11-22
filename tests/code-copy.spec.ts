import { test, expect } from '@playwright/test';
test('copies only the displayed code and reports completed success', async ({ page }, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as any).__copied = text;
        },
      },
    });
  });
  await page.goto('/articles/git-branches');
  const pre = page.locator('.code-block pre').first();
  await expect(pre).toBeVisible();
  const code = await pre.textContent();
  await expect(page.locator('.code-block')).toHaveCount(3);
  expect(code).toBe('git switch -c try-new-title\n');
  await expect(page.getByRole('heading', { name: '2. README.mdを編集して保存する' })).toBeVisible();
  await page.getByRole('button', { name: 'コードをコピー', exact: true }).first().click();
  // Success is an icon change plus an announcement, not printed text.
  await expect(page.getByRole('status').first()).toHaveText('コピーしました');
  await expect(
    page.getByRole('button', { name: 'コードをコピー', exact: true }).first(),
  ).toHaveAttribute('data-state', 'copied');
  expect(await page.evaluate(() => (window as any).__copied)).toBe(code);
  await page.screenshot({
    path: info.outputPath('copy-success.png'),
    fullPage: true,
    scale: 'css',
  });
});
test('denied or unavailable clipboard selects the code for a manual copy', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const mode = new URL(location.href).searchParams.get('clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value:
        mode === 'unavailable'
          ? undefined
          : {
              writeText: async () => {
                throw new Error('private browser detail');
              },
            },
    });
  });
  for (const mode of ['denied', 'unavailable']) {
    await page.goto('/articles/git-branches?clipboard=' + mode);
    const pre = page.locator('.code-block pre').first();
    await expect(pre).toBeVisible();
    await page.getByRole('button', { name: 'コードをコピー', exact: true }).first().click();
    await expect(page.getByRole('alert').first()).toContainText('コピーできませんでした');
    await expect(page.getByText('private browser detail')).toHaveCount(0);
    await expect(pre).toBeFocused();
    expect(await page.evaluate(() => window.getSelection()?.getRangeAt(0).toString())).toBe(
      await pre.textContent(),
    );
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: info.outputPath('manual-selection.png'),
    fullPage: true,
    scale: 'css',
  });
});
test('multiple blocks keep exact whitespace, inline code stays inline, pending is not success', async ({
  page,
  request,
}) => {
  const data = await (await request.get('/api/catalog')).json();
  data.entries[0].body =
    '`inline`\n\n```text\nfirst\n```\n\n```text\n  <script>literal</script>\n\t全角 text\n```';
  await page.route('**/api/catalog', (r) => r.fulfill({ json: data }));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: (text: string) =>
          new Promise<void>((resolve) => {
            (window as any).__copied = text;
            (window as any).__finishCopy = resolve;
          }),
      },
    });
  });
  await page.goto('/articles/learning-notes');
  await expect(page.locator('.code-block')).toHaveCount(2);
  await expect(page.locator('.prose > p code')).toHaveText('inline');
  await page.getByRole('button', { name: 'コードをコピー', exact: true }).nth(1).click();
  const status = page.locator('.code-block').nth(1).getByRole('status');
  await expect(status).toHaveText('');
  expect(await page.evaluate(() => (window as any).__copied)).toBe(
    '  <script>literal</script>\n\t全角 text\n',
  );
  await expect(page.locator('.prose script')).toHaveCount(0);
  await page.evaluate(() => (window as any).__finishCopy());
  await expect(status).toHaveText('コピーしました');
});
