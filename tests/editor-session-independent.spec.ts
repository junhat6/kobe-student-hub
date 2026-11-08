import { test, expect, type Page, type Browser } from '@playwright/test';
const ORIGIN = 'https://127.0.0.1:8788';
async function seed(page: Page, account: 'a' | 'b' = 'a') {
  const response = await page
    .context()
    .request.post('/__fixture/session', { headers: { Origin: ORIGIN }, data: { account } });
  expect(response.status()).toBe(200);
}
async function open(page: Page) {
  await seed(page);
  await page.goto('/lab/account');
  await expect(page.getByRole('button', { name: '新しい下書き', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'このブラウザをログアウト', exact: true }),
  ).toBeVisible();
}
async function draft(page: Page) {
  const title = 'セッション検証-' + crypto.randomUUID().slice(0, 8);
  await page.getByRole('button', { name: '新しい下書き', exact: true }).click();
  await page.getByLabel('タイトル', { exact: true }).fill(title);
  await page.getByLabel('Markdown本文', { exact: true }).fill('保存済みの架空の文章');
  await expect(page.getByRole('button', { name: '下書きを保存', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  await expect(page.locator('#editor-main').getByRole('status')).toHaveText(
    '下書きを保存しました。',
  );
  return title;
}
async function draftId(page: Page, title: string) {
  return page.evaluate(async (name) => {
    const rows = (await (await fetch('/api/private/drafts', { cache: 'no-store' })).json()) as {
      id: string;
      title: string;
    }[];
    const value = rows.find((row) => row.title === name);
    if (!value) throw new Error('fictional draft unavailable');
    return value.id;
  }, title);
}
async function freshContext(browser: Browser, page: Page) {
  const device = test.info().project.use;
  return browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: ORIGIN,
    viewport: page.viewportSize(),
    screen: device.screen,
    isMobile: device.isMobile,
    hasTouch: device.hasTouch,
    deviceScaleFactor: device.deviceScaleFactor,
    userAgent: device.userAgent,
  });
}
test('independent unknown proof preserves a hidden buffer but confirmed invalid session clears it', async ({
  page,
}, info) => {
  await open(page);
  await draft(page);
  const body = page.getByLabel('Markdown本文', { exact: true });
  await body.fill('503では保持し401では破棄する架空の未保存入力');
  await body.evaluate((element) => {
    (element as HTMLElement & { __qaMarker?: boolean }).__qaMarker = true;
  });
  await page
    .getByRole('region', { name: '既存セッションの確認' })
    .screenshot({ path: info.outputPath('01-active-session-controls.png'), scale: 'css' });
  let status = 503;
  await page.route('**/api/private/session', (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({
        error: status === 503 ? 'synthetic_unavailable' : 'synthetic_invalid',
      }),
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    page.getByText(/手元の編集はこのページのメモリ内に保持したまま隠しています/),
  ).toBeVisible();
  await expect(page.locator('.session-private')).toBeHidden();
  expect(await page.locator('.session-private').evaluate((e) => (e as HTMLElement).inert)).toBe(
    true,
  );
  expect(await page.locator('#draft-body').inputValue()).toBe(
    '503では保持し401では破棄する架空の未保存入力',
  );
  expect(
    await body.evaluate((e) => Boolean((e as HTMLElement & { __qaMarker?: boolean }).__qaMarker)),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath('02-unverified-hidden-retained.png'),
    fullPage: true,
    scale: 'css',
  });
  status = 401;
  await page.getByRole('button', { name: 'セッションを再確認', exact: true }).click();
  await expect(
    page.getByText(
      '現在ログインしていません。このローカル画面では学校Googleログインやアカウント作成は利用できません。',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.locator('#draft-body')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'このブラウザをログアウト', exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath('03-confirmed-invalid-cleared.png'),
    fullPage: true,
    scale: 'css',
  });
  await page.unroute('**/api/private/session');
  await seed(page, 'b');
  await page.getByRole('button', { name: 'セッションを再確認', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '確認したセッションで編集を開く', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '新しい下書き', exact: true })).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath('04-explicit-new-scope-continuation.png'),
    fullPage: true,
    scale: 'css',
  });
  await page.getByRole('button', { name: '確認したセッションで編集を開く', exact: true }).click();
  await expect(page.getByRole('button', { name: '新しい下書き', exact: true })).toBeVisible();
  await expect(page.locator('#draft-body')).toHaveCount(0);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});
