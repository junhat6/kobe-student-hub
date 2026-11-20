import { fulfillGoogleFormPost } from './helpers/google-form-post';
import { test, expect, type Page, type TestInfo } from '@playwright/test';

const ORIGIN = 'https://127.0.0.1:8790';
async function register(page: Page, info: TestInfo, label: string) {
  const provider = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;
  const actor = `fictional-switch-${label}-${info.project.name}-${Date.now().toString(36)}`;
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
  await page.getByLabel('入学年度 必須', { exact: true }).fill('2026');
  await page.getByLabel('卒業予定年度 必須', { exact: true }).fill('2028');
  await page.getByRole('button', { name: '学校Googleで登録', exact: true }).click();
  await expect(page).toHaveURL(ORIGIN + '/account');
  await page.unroute(provider);
}
async function createProfile(page: Page, name: string) {
  await page.getByText('公開プロフィールを準備する', { exact: true }).click();
  const profile = page.getByRole('region', { name: '公開プロフィールの初回作成' });
  await profile.getByLabel('表示名 必須').fill(name);
  await profile.getByRole('checkbox').check();
  await profile
    .getByRole('button', { name: '確認した内容でプロフィールを作成', exact: true })
    .click();
  await expect(profile.locator('.profile-setup-status')).toHaveText(
    '公開プロフィールを作成しました。',
  );
}

test('switching accounts in another window never leaves the previous name on screen', async ({
  page,
  context,
  browser,
}, info) => {
  const nameA = `架空A-${info.project.name}`;
  const nameB = `架空B-${info.project.name}`;
  await register(page, info, 'a');
  await createProfile(page, nameA);
  await page.reload();
  await expect(page.locator('.account-summary-name')).toHaveText(nameA);

  // Account B signs in elsewhere; its session cookie then replaces A's in this browser,
  // as when another window of the same browser logs in as a different account.
  const elsewhere = await browser.newContext({ baseURL: ORIGIN, ignoreHTTPSErrors: true });
  try {
    const other = await elsewhere.newPage();
    await register(other, info, 'b');
    await createProfile(other, nameB);
    await context.addCookies(await elsewhere.cookies());
  } finally {
    await elsewhere.close();
  }

  // Side-by-side windows: the first page regains focus without a visibilitychange.
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('body')).not.toContainText(nameA);
  await page.getByRole('button', { name: '確認したアカウントを開く', exact: true }).click();
  await expect(page.locator('.account-summary-name')).toHaveText(nameB);
  await expect(page.locator('body')).not.toContainText(nameA);
  await page.getByRole('button', { name: 'アカウントメニュー', exact: true }).click();
  const profileLink = page.getByRole('menuitem', { name: '公開プロフィールを見る', exact: true });
  const href = await profileLink.getAttribute('href');
  await page.keyboard.press('Escape');
  expect(href).toBe(await page.locator('.account-summary-who a').getAttribute('href'));
});
