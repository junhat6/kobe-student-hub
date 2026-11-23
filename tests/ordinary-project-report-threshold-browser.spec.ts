import { fulfillGoogleFormPost } from './helpers/google-form-post';
import { test, expect, type Browser, type Page, type TestInfo } from '@playwright/test';

const ORIGIN = 'https://127.0.0.1:8790';
async function register(page: Page, info: TestInfo, who: string) {
  const provider = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;
  const actor = `fictional-threshold-${who}-${info.project.name}-${Date.now().toString(36)}`;
  await page.route(provider, async (route) => {
    const url = new URL(route.request().url());
    const state = url.searchParams.get('state')!,
      nonce = url.searchParams.get('nonce')!;
    expect(
      (
        await page.request.get('/__control/token?' + new URLSearchParams({ state, nonce, actor }))
      ).status(),
    ).toBe(200);
    await fulfillGoogleFormPost(route, ORIGIN, { state, code: state });
  });
  await page.goto('/signup');
  await page.getByLabel('入学', { exact: true }).selectOption('2026');
  await page.getByLabel('卒業予定', { exact: true }).selectOption('2028');
  await page.getByRole('button', { name: '学校Googleで登録', exact: true }).click();
  await expect(page).toHaveURL(ORIGIN + '/account');
  await page.unroute(provider);
}
async function context(browser: Browser, page: Page) {
  return browser.newContext({
    baseURL: ORIGIN,
    ignoreHTTPSErrors: true,
    viewport: page.viewportSize() ?? undefined,
  });
}

test('three different accounts temporarily hide a project without deleting it', async ({
  page,
  browser,
}, info) => {
  const title = `通報される架空作品-${info.project.name}`;
  await register(page, info, 'author');
  const profile = page.getByRole('region', { name: 'プロフィールをつくる' });
  await profile.getByLabel('表示名', { exact: true }).fill('架空のしきい値投稿者');
  await profile.getByRole('button', { name: '公開する', exact: true }).click();
  await expect(page.getByRole('button', { name: 'プロフィールを編集', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '作品を登録', exact: true }).click();
  await page.getByLabel('作品タイトル', { exact: true }).fill(title);
  await page.getByLabel('作品の説明', { exact: true }).fill('架空の作品説明');
  await page.getByRole('button', { name: '作品を保存', exact: true }).click();
  await expect(page.getByText('保存済みです。', { exact: false })).toBeVisible();
  // #235: the publish check runs by itself once the saved version matches the input.
  await expect(
    page.getByRole('button', { name: '確認した保存版の作品を公開', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: '確認した保存版の作品を公開', exact: true }).click();
  const link = page.getByRole('link', { name: 'ログインなしで作品を見る' });
  await expect(link).toBeVisible();
  const path = (await link.getAttribute('href'))!;
  expect(path).toMatch(/^\/projects\/[0-9a-f-]{36}$/);

  const guestContext = await context(browser, page);
  const reporters = [];
  try {
    const guest = await guestContext.newPage();
    for (let n = 0; n < 3; n++) {
      // Each reporter is a separate browser context, so cookies and storage are never shared.
      const ctx = await context(browser, page);
      reporters.push(ctx);
      const reader = await ctx.newPage();
      await register(reader, info, 'reporter' + n);
      await reader.goto(path);
      await expect(reader.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await reader.getByRole('button', { name: 'この作品を通報する', exact: true }).click();
      await reader
        .getByLabel('作品の通報理由（必須）', { exact: true })
        .fill('架空の通報理由 ' + (n + 1));
      await reader.locator('.project-report-form').getByRole('checkbox').check();
      await reader.getByRole('button', { name: '確認した作品通報を送信', exact: true }).click();
      await expect(reader.locator('.project-report-form [role="status"]')).toContainText(
        '送信しました。この作品の通報を受け付けました',
      );
      if (n === 0) {
        await reader.screenshot({
          path: info.outputPath('project-report-received.png'),
          fullPage: true,
          scale: 'css',
        });
        expect(
          await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        ).toBe(true);
      }
      await guest.goto(path);
      if (n < 2)
        await expect(guest.getByRole('heading', { name: title, exact: true })).toBeVisible();
    }
    // Third distinct report: anonymous readers no longer see it on the page or in the list.
    await expect(guest.getByRole('heading', { name: '作品が見つかりません' })).toBeVisible();
    await guest.goto('/works');
    await expect(guest.getByRole('link', { name: title, exact: true })).toHaveCount(0);
    // Not deleted: the owner still has the record, shown as temporarily hidden.
    await page.goto('/account');
    const records = page.getByRole('region', { name: '自分の公開記録', exact: true });
    await expect(records.getByText(title, { exact: false })).toBeVisible();
    await expect(records.locator('.own-publications-state-hidden')).toHaveText('一時非公開');
    await expect(records.locator('.own-publications-state-deleted')).toHaveCount(0);
    // The owner learns why, without any reporter's reason.
    const notices = page.getByRole('region', { name: '運営からのお知らせ', exact: true });
    await expect(notices).toContainText('作品が一時非公開になりました');
    await expect(notices).toContainText(title);
    await expect(notices).toContainText('異なる3人からの通報により、一時非公開になりました。');
    await expect(notices).not.toContainText('架空の通報理由');
    // The next steps must look like links, not body text (#181).
    const bodyColor = await notices
      .locator('.notification-reason')
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    for (const name of [
      '自分の公開記録を確認する',
      '判断についての相談・異議申立ての案内（別のタブ）',
    ]) {
      const link = notices.getByRole('link', { name, exact: true }).first();
      await expect(link).toBeVisible();
      await expect(link).toHaveCSS('text-decoration-line', 'underline');
      await expect(link).not.toHaveCSS('color', bodyColor);
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await notices.screenshot({ path: info.outputPath('project-report-owner-notice.png') });
    await page.screenshot({
      path: info.outputPath('project-report-owner-hidden.png'),
      fullPage: true,
      scale: 'css',
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    for (const ctx of reporters) await ctx.close();
    await guestContext.close();
  }
});
