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
  await page.getByLabel('入学', { exact: true }).selectOption('2026');
  await page.getByLabel('卒業予定', { exact: true }).selectOption('2028');
  await page.getByRole('button', { name: '学校Googleで登録', exact: true }).click();
  await expect(page).toHaveURL(ORIGIN + '/account');
  await page.unroute(provider);
  const region = page.getByRole('region', { name: 'プロフィールをつくる' });
  await region.getByLabel('表示名', { exact: true }).fill('架空の編集前プロフィール');
  await region.getByLabel('自己紹介', { exact: true }).fill('自分で入力した初回の公開文');
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/private/profile') && r.request().method() === 'POST',
  );
  await region.getByRole('button', { name: '公開する', exact: true }).click();
  const result = await (await response).json();
  expect(result.profile.id).toMatch(/^profile-[a-f0-9-]{36}$/);
  await expect(page.getByRole('button', { name: 'プロフィールを編集', exact: true })).toBeVisible();
  return result.profile.id as string;
}
const editor = (page: Page) => page.getByRole('region', { name: 'プロフィール', exact: true });
async function openEdit(page: Page) {
  await editor(page).getByRole('button', { name: 'プロフィールを編集', exact: true }).click();
  await expect(editor(page).getByLabel('表示名', { exact: true })).toBeVisible();
}
async function save(page: Page) {
  await editor(page).getByRole('button', { name: '保存', exact: true }).click();
}
test('explicit profile edit keeps its public author URL and exposes only confirmed updated fields', async ({
  page,
  browser,
}, info) => {
  const id = await createProfile(page, info);
  await openEdit(page);
  const region = editor(page);
  await region.getByLabel('表示名', { exact: true }).fill('更新した架空の書き手');
  await region.getByLabel('自己紹介', { exact: true }).fill('更新した公開紹介');
  await save(page);
  await expect(region.getByRole('status')).toHaveText('プロフィールを保存しました。');
  await page.getByRole('link', { name: '記事の管理', exact: true }).click();
  await page.getByRole('button', { name: '新しい下書き', exact: true }).click();
  await page.getByLabel('タイトル', { exact: true }).fill('架空プロフィール更新の制作ノート');
  await page.getByLabel('Markdown本文', { exact: true }).fill('自分で確認した架空の制作本文です。');
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み');
  await page
    .locator('.editor-main-heading')
    .getByRole('button', { name: '公開する', exact: true })
    .click();
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
    // Only the owner gets the GitHub-style edit button on the author page.
    await expect(reader.getByRole('link', { name: 'プロフィールを編集' })).toHaveCount(0);
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
  // The owner edits from their own author page, as on GitHub: the button opens the form directly.
  await page.goto('/students/' + id);
  await page.getByRole('link', { name: 'プロフィールを編集', exact: true }).click();
  await expect(page).toHaveURL(ORIGIN + '/account#profile');
  await expect(editor(page).getByLabel('表示名', { exact: true })).toHaveValue(
    '更新した架空の書き手',
  );
});
test('an unclear save is re-read instead of resent, and a stale edit keeps the input', async ({
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
  await region.getByLabel('自己紹介', { exact: true }).fill('受付結果が不明でも確かめる公開文');
  await save(page);
  // The page reads what the server holds and reports the save itself; no second PATCH.
  await expect(region.getByRole('status')).toHaveText('プロフィールを保存しました。');
  await expect(region).toContainText('受付結果が不明でも確かめる公開文');
  expect(patches).toBe(1);
  await page.unroute('**/api/private/profile');
  const other = await context.newPage();
  try {
    await other.goto('/account');
    await openEdit(page);
    await openEdit(other);
    await editor(other).getByLabel('自己紹介', { exact: true }).fill('別画面からの新しい公開文');
    await save(other);
    await expect(editor(other).getByRole('status')).toHaveText('プロフィールを保存しました。');
    await region.getByLabel('自己紹介', { exact: true }).fill('古い画面で保持する入力');
    await save(page);
    await expect(region.getByRole('alert')).toContainText('別の画面で変更');
    await expect(region.getByLabel('自己紹介', { exact: true })).toHaveValue(
      '古い画面で保持する入力',
    );
    await region.screenshot({ path: info.outputPath('profile-stale-input-retained.png') });
    // One more tap saves the kept input against the latest version.
    await save(page);
    await expect(region.getByRole('status')).toHaveText('プロフィールを保存しました。');
    await expect(region).toContainText('古い画面で保持する入力');
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await other.close();
  }
});
test('profile links (#313): the owner adds them, readers see icons on the profile and the author card', async ({
  page,
  browser,
}, info) => {
  const id = await createProfile(page, info);
  await openEdit(page);
  const region = editor(page);
  const links = region.getByRole('group', { name: 'リンク' });
  await links.getByLabel('X', { exact: true }).fill('https://twitter.com/kobe_student');
  await links.getByLabel('GitHub', { exact: true }).fill('github.com/kobe-student');
  await links.getByLabel('LinkedIn', { exact: true }).fill('https://www.linkedin.com/in/ab');
  await links.getByLabel('Webサイト', { exact: true }).fill('http://example.com');
  // Shapes that do not fit are named before anything is sent.
  await expect(region.getByRole('alert')).toHaveText('LinkedIn・Webサイトのリンクの形が違います');
  await expect(region.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await links.getByLabel('LinkedIn', { exact: true }).fill('');
  await links.getByLabel('Webサイト', { exact: true }).fill('https://example.com/works');
  const put = page.waitForResponse(
    (r) => r.url().endsWith('/api/private/profile/links') && r.request().method() === 'PUT',
  );
  await save(page);
  expect((await put).status()).toBe(200);
  await expect(region.getByRole('status')).toHaveText('プロフィールを保存しました。');
  const ownLinks = region.getByRole('list', { name: /さんのリンク$/ });
  await expect(ownLinks.getByRole('link')).toHaveCount(3);
  // Reopening shows the stored (normalized) values.
  await openEdit(page);
  await expect(links.getByLabel('X', { exact: true })).toHaveValue('https://x.com/kobe_student');
  await editor(page).getByRole('button', { name: 'キャンセル', exact: true }).click();
  // Publish one article so the profile and the card are public.
  await page.getByRole('link', { name: '記事の管理', exact: true }).click();
  await page.getByRole('button', { name: '新しい下書き', exact: true }).click();
  await page.getByLabel('タイトル', { exact: true }).fill('リンクを載せた架空の制作ノート');
  await page.getByLabel('Markdown本文', { exact: true }).fill('自分で確認した架空の制作本文です。');
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み');
  await page
    .locator('.editor-main-heading')
    .getByRole('button', { name: '公開する', exact: true })
    .click();
  const composer = page.getByRole('region', { name: '保存済み版の公開', exact: true });
  await composer.getByLabel('記事の概要（300文字以内）').fill('プロフィールのリンクの検証');
  await composer.getByRole('checkbox').check();
  await composer.getByRole('button', { name: '確認した保存済み版を公開', exact: true }).click();
  const publicLink = composer.getByRole('link', { name: 'ログインなしの読者画面を開く' });
  await expect(publicLink).toBeVisible();
  const articlePath = (await publicLink.getAttribute('href'))!;
  const guest = await browser.newContext({
    baseURL: ORIGIN,
    ignoreHTTPSErrors: true,
    viewport: page.viewportSize() ?? undefined,
  });
  try {
    const reader = await guest.newPage();
    const expected = [
      ['X（新しいタブで開きます）', 'https://x.com/kobe_student'],
      ['GitHub（新しいタブで開きます）', 'https://github.com/kobe-student'],
      ['Webサイト（新しいタブで開きます）', 'https://example.com/works'],
    ];
    const check = async (scope: ReturnType<typeof reader.locator>) => {
      const list = scope.getByRole('list', { name: /さんのリンク$/ });
      const anchors = list.getByRole('link');
      await expect(anchors).toHaveCount(3);
      for (const [i, [label, href]] of expected.entries()) {
        const a = anchors.nth(i);
        await expect(a).toHaveAccessibleName(label);
        await expect(a).toHaveAttribute('href', href);
        await expect(a).toHaveAttribute('target', '_blank');
        await expect(a).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
        await expect(a).toHaveAttribute('title', new RegExp(href.replace(/[.]/g, '\\.')));
        const box = (await a.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      await expect(list.getByRole('link', { name: /LinkedIn/ })).toHaveCount(0);
    };
    await reader.goto('/students/' + id);
    await check(reader.locator('.profile-side'));
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await reader.screenshot({ path: info.outputPath('profile-links-public.png'), fullPage: true });
    await reader.goto(articlePath);
    const card = reader.getByRole('region', { name: '書いた学生' });
    await check(card);
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await card.screenshot({ path: info.outputPath('profile-links-author-card.png') });
  } finally {
    await guest.close();
  }
  // Clearing every field removes all links.
  await page.goto('/account');
  await openEdit(page);
  for (const label of ['X', 'GitHub', 'Webサイト'])
    await editor(page)
      .getByRole('group', { name: 'リンク' })
      .getByLabel(label, { exact: true })
      .fill('');
  await save(page);
  await expect(editor(page).getByRole('status')).toHaveText('プロフィールを保存しました。');
  await expect(editor(page).getByRole('list', { name: /さんのリンク$/ })).toHaveCount(0);
});
