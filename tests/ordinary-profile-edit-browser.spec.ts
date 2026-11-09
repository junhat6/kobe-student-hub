import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { fulfillGoogleFormPost } from './helpers/google-form-post';

const ORIGIN = process.env.KSH_PROFILE_BROWSER_ORIGIN ?? 'https://127.0.0.1:8790';
const provider = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;
async function createProfile(page: Page, info: TestInfo) {
  const actor = `fictional-profile-edit-${info.project.name}-${Date.now().toString(36)}`;
  await page.route(provider, async (route) => {
    const url = new URL(route.request().url()),
      state = url.searchParams.get('state')!,
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
  const region = page.getByRole('region', { name: '公開プロフィールの初回作成' });
  await region.getByText('公開プロフィールを準備する', { exact: true }).click();
  await region.getByLabel('表示名 必須').fill('架空の編集前プロフィール');
  await region.getByLabel('自己紹介（任意）').fill('自分で入力した初回の公開文');
  await region.getByRole('checkbox').check();
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/private/profile') && r.request().method() === 'POST',
  );
  await region
    .getByRole('button', { name: '確認した内容でプロフィールを作成', exact: true })
    .click();
  const result = await (await response).json();
  expect(result.profile.id).toMatch(/^profile-[a-f0-9-]{36}$/);
  await expect(region.locator('.profile-setup-status')).toHaveText(
    '公開プロフィールを作成しました。',
  );
  return result.profile.id as string;
}
const editor = (page: Page) =>
  page.getByRole('region', { name: '公開プロフィールの編集', exact: true });
async function openEdit(page: Page) {
  await editor(page).getByText('公開プロフィールを編集する', { exact: true }).click();
  await expect(editor(page).getByLabel('表示名 必須')).toBeVisible();
}
async function save(page: Page) {
  await editor(page).getByRole('checkbox').check();
  await editor(page).getByRole('button', { name: '公開プロフィールを更新', exact: true }).click();
}
test('explicit profile edit keeps its public author URL and exposes only confirmed updated fields', async ({
  page,
  browser,
}, info) => {
  const id = await createProfile(page, info);
  await openEdit(page);
  const region = editor(page);
  await region.getByLabel('表示名 必須').fill('更新した架空の書き手');
  await region.getByLabel('自己紹介（任意）').fill('更新した公開紹介');
  await expect(
    region.getByRole('button', { name: '公開プロフィールを更新', exact: true }),
  ).toBeDisabled();
  await save(page);
  await expect(region.getByRole('status')).toHaveText('公開プロフィールを更新しました。');
  await page.getByRole('link', { name: '下書きを書く・再開する' }).click();
  await page.getByRole('button', { name: '新しい下書き', exact: true }).click();
  await page.getByLabel('タイトル', { exact: true }).fill('架空プロフィール更新の制作ノート');
  await page.getByLabel('Markdown本文', { exact: true }).fill('自分で確認した架空の制作本文です。');
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み');
  await page.getByText('記事を公開する', { exact: true }).click();
  const composer = page.getByRole('region', { name: '保存済み版の公開', exact: true });
  await composer.getByLabel('記事の概要（300文字以内）').fill('プロフィールを明示的に更新した検証');
  await composer.getByRole('checkbox').check();
  await composer.getByRole('button', { name: '確認した保存済み版を公開', exact: true }).click();
  const publicLink = composer.getByRole('link', { name: 'ログインなしの読者画面を開く' });
  await expect(publicLink).toBeVisible();
  const guest = await browser.newContext({
    baseURL: ORIGIN,
    ignoreHTTPSErrors: true,
    viewport: page.viewportSize() ?? undefined,
  });
  try {
    const reader = await guest.newPage();
    await reader.goto((await publicLink.getAttribute('href'))!);
    await expect(reader.locator('.detail-author .author')).toContainText('更新した架空の書き手');
    await expect(reader.locator('.detail-author .author')).toHaveAttribute(
      'href',
      '/students/' + id,
    );
    await reader.locator('.detail-author .author').click();
    await expect(
      reader.getByRole('heading', { name: '更新した架空の書き手', exact: true }),
    ).toBeVisible();
    await expect(reader.locator('main')).toContainText('更新した公開紹介');
    await expect(reader.locator('main')).not.toContainText('st.kobedenshi.ac.jp');
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await reader.screenshot({
      path: info.outputPath('profile-updated-public.png'),
      fullPage: true,
    });
  } finally {
    await guest.close();
  }
});
test('unknown acknowledgement and stale edit retain input until explicit recovery without automatic resend', async ({
  page,
  context,
}, info) => {
  await createProfile(page, info);
  await openEdit(page);
  let patches = 0;
  await page.route('**/api/private/profile', async (route) => {
    if (route.request().method() !== 'PATCH') {
      await route.continue();
      return;
    }
    patches++;
    expect((await route.fetch()).status()).toBe(200);
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"synthetic_lost_ack"}',
    });
  });
  const region = editor(page);
  await region.getByLabel('自己紹介（任意）').fill('受付結果が不明でも保持する公開文');
  await save(page);
  await expect(region.getByRole('status')).toContainText('再送せず');
  await expect(region.getByLabel('自己紹介（任意）')).toHaveValue(
    '受付結果が不明でも保持する公開文',
  );
  await expect(
    region.getByRole('button', { name: '公開プロフィールを更新', exact: true }),
  ).toBeDisabled();
  expect(patches).toBe(1);
  await region.getByRole('button', { name: '公開内容を再確認', exact: true }).click();
  await expect(region.getByRole('status')).toHaveText('変更した公開内容を確認できました。');
  expect(patches).toBe(1);
  await page.unroute('**/api/private/profile');
  const other = await context.newPage();
  try {
    await other.goto('/account');
    await openEdit(other);
    await editor(other).getByLabel('自己紹介（任意）').fill('別画面からの新しい公開文');
    await save(other);
    await expect(editor(other).getByRole('status')).toHaveText('公開プロフィールを更新しました。');
    await region.getByLabel('自己紹介（任意）').fill('古い画面で保持する入力');
    await save(page);
    await expect(region.getByRole('status')).toContainText('別の画面で変更');
    await region.getByRole('button', { name: '公開内容を再確認', exact: true }).click();
    await expect(region.getByRole('status')).toContainText('手元の入力は保持');
    await expect(region.getByLabel('自己紹介（任意）')).toHaveValue('古い画面で保持する入力');
    await region.screenshot({ path: info.outputPath('profile-stale-input-retained.png') });
    await region
      .getByRole('button', { name: '入力を置き換えて最新内容を使う', exact: true })
      .click();
    await expect(region.getByLabel('自己紹介（任意）')).toHaveValue('別画面からの新しい公開文');
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await other.close();
  }
});
