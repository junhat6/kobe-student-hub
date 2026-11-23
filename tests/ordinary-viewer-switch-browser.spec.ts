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
  await page.getByLabel('入学', { exact: true }).selectOption('2026');
  await page.getByLabel('卒業予定', { exact: true }).selectOption('2028');
  await page.getByRole('button', { name: '学校Googleで登録', exact: true }).click();
  await expect(page).toHaveURL(ORIGIN + '/account');
  await page.unroute(provider);
}
async function createProfile(page: Page, name: string) {
  const profile = page.getByRole('region', { name: 'プロフィールをつくる' });
  await profile.getByLabel('表示名', { exact: true }).fill(name);
  await profile.getByRole('button', { name: '公開する', exact: true }).click();
  await expect(page.getByRole('button', { name: 'プロフィールを編集', exact: true })).toBeVisible();
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
  await expect(page.locator('#profile .profile-editor-card strong')).toHaveText(nameA);

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
  await expect(page.locator('#profile .profile-editor-card strong')).toHaveText(nameB);
  await expect(page.locator('body')).not.toContainText(nameA);
  await page.getByRole('button', { name: 'アカウントメニュー', exact: true }).click();
  const profileLink = page.getByRole('menuitem', { name: '公開プロフィールを見る', exact: true });
  const href = await profileLink.getAttribute('href');
  await page.keyboard.press('Escape');
  expect(href).toBe(
    await page
      .getByRole('link', { name: '公開プロフィールを見る', exact: true })
      .getAttribute('href'),
  );
});

test('a temporary profile read failure is not shown as a missing profile', async ({
  page,
}, info) => {
  const name = `架空C-${info.project.name}`;
  await register(page, info, 'c');
  await createProfile(page, name);
  await page.route('**/api/private/profile', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 503, body: '' })
      : route.continue(),
  );
  await page.reload();
  const profile = page.locator('#profile');
  await expect(profile.getByRole('alert')).toContainText('読み込めませんでした');
  // A failed read is not "no profile": never ask to create one.
  await expect(page.getByRole('heading', { name: 'プロフィールをつくる' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '公開する', exact: true })).toHaveCount(0);
  // While the failure continues, a retry visibly runs and then offers the retry again.
  await profile.getByRole('button', { name: 'もう一度', exact: true }).click();
  await expect(profile.getByRole('button', { name: 'もう一度', exact: true })).toBeEnabled();
  await page.unroute('**/api/private/profile');
  await profile.getByRole('button', { name: 'もう一度', exact: true }).click();
  await expect(profile).toContainText(name);
});

test('logging out from the header menu leaves the header signed out (#187)', async ({
  page,
}, info) => {
  await register(page, info, 'logout');
  const header = page.getByRole('banner');
  await header.getByRole('button', { name: 'アカウントメニュー', exact: true }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('menuitem', { name: 'ログアウト', exact: true }).click();
  await expect(page).toHaveURL(ORIGIN + '/');
  await expect(header.getByRole('link', { name: 'ログイン', exact: true })).toBeVisible();
  await expect(header.getByRole('button', { name: 'アカウントメニュー' })).toHaveCount(0);
});
