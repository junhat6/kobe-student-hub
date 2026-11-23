import AxeBuilder from '@axe-core/playwright';
import { fulfillGoogleFormPost } from './helpers/google-form-post';
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';

// C17: after the registered graduation year, new posts stop but own management continues.
const ORIGIN = 'https://127.0.0.1:8790';
const provider = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;
const TITLE = '架空の卒業前ノート';

async function register(page: Page, info: TestInfo) {
  const actor = `fictional-graduation-${info.project.name}-${Date.now().toString(36)}`;
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
}

async function publishAndKeepDraft(page: Page) {
  const profile = page.getByRole('region', { name: 'プロフィールをつくる' });
  await profile.getByLabel('表示名', { exact: true }).fill('架空の卒業生');
  await profile.getByRole('button', { name: '公開する', exact: true }).click();
  await expect(page.getByRole('button', { name: 'プロフィールを編集', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '記事を書く', exact: true }).click();
  await page.getByRole('button', { name: '新しい下書き', exact: true }).click();
  await page.getByLabel('タイトル', { exact: true }).fill(TITLE);
  await page.getByLabel('Markdown本文', { exact: true }).fill('在学中に公開した架空の本文です。');
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み');
  await page.getByText('記事を公開する', { exact: true }).click();
  const composer = page.getByRole('region', { name: '保存済み版の公開', exact: true });
  await composer.getByLabel('記事の概要（300文字以内）').fill('卒業前に公開した記録');
  await composer.getByRole('checkbox').check();
  await composer.getByRole('button', { name: '確認した保存済み版を公開', exact: true }).click();
  const publicLink = composer.getByRole('link', { name: 'ログインなしの読者画面を開く' });
  await expect(publicLink).toBeVisible();
  return (await publicLink.getAttribute('href'))!;
}

async function correctYears(page: Page, admission: string, graduation: string) {
  const form = page.getByRole('region', { name: '在学期間' });
  await form.getByLabel('入学', { exact: true }).selectOption(admission);
  await form.getByLabel('卒業予定', { exact: true }).selectOption(graduation);
  await form.getByRole('button', { name: '保存', exact: true }).click();
  await expect(form.getByRole('status')).toHaveText('在学期間を保存しました。');
}

async function expectNoSeriousAxe(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(
    violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(' ')) })),
  ).toEqual([]);
}

// The section stays in view after every account read has finished, not only at first paint.
async function expectLanded(page: Page, section: Locator) {
  await expect(section).toBeInViewport();
  // The two slowest parts: the own-publication list above and the enrollment form below.
  await expect(
    page.getByRole('button', { name: '公開を止める：' + TITLE, exact: true }),
  ).toBeAttached();
  await expect(
    page.getByRole('region', { name: '在学期間' }).getByLabel('入学', { exact: true }),
  ).toHaveValue('2024');
  await expect(section).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('after the graduation year: no new posts, but stop, draft delete and correction still work', async ({
  page,
  browser,
}, info) => {
  await register(page, info);
  const articlePath = await publishAndKeepDraft(page);

  await page.goto('/account');
  await correctYears(page, '2024', '2025');
  const notice = page.getByRole('note', { name: '新しい投稿について' });
  await expect(notice.getByRole('heading', { name: '卒業予定を過ぎています' })).toBeVisible();
  await expect(page.getByRole('link', { name: '記事を書く', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '作品を登録', exact: true })).toHaveCount(0);
  expect(await noHorizontalScroll(page)).toBe(true);
  await expectNoSeriousAxe(page);
  await page.screenshot({ path: info.outputPath('graduated-account.png'), fullPage: true });

  // Drafts: readable and deletable, but no create, save or publish that would always fail.
  await page.getByRole('link', { name: '下書き', exact: true }).click();
  await expect(page).toHaveURL(ORIGIN + '/drafts');
  await expect(
    page
      .getByRole('note', { name: '新しい投稿について' })
      .getByRole('heading', { name: '卒業予定を過ぎています' }),
  ).toBeVisible();
  // #179: no create controls, and nothing visible or announced says a new draft can be made.
  await expect(page.getByRole('button', { name: '新しい下書き', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新しい下書きを作成', exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator('.editor-status')).toHaveText(
    '左の一覧から下書きを開くと、読み返したり削除したりできます。',
  );
  await expect(page.getByRole('region', { name: '下書きのセッション確認' })).toContainText(
    'ログインを確認しました。',
  );
  await expect(page.getByText(/作成できます|書く・再開できます|新しい下書きを作成/)).toHaveCount(0);
  await page.getByRole('button', { name: TITLE, exact: true }).click();
  await expect(page.getByRole('heading', { name: '保存した下書きを読み返す' })).toBeVisible();
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue(TITLE);
  await expect(page.getByLabel('タイトル', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '下書きを保存', exact: true })).toBeDisabled();
  await expect(page.getByText('記事を公開する', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /画像を選ぶ/ })).toHaveCount(0);
  expect(await noHorizontalScroll(page)).toBe(true);
  await expectNoSeriousAxe(page);
  await page.screenshot({ path: info.outputPath('graduated-drafts.png'), fullPage: true });
  await page.getByRole('button', { name: 'この下書きを削除', exact: true }).click();
  await page.getByRole('button', { name: '保存版と手元の変更を削除', exact: true }).click();
  await expect(page.locator('.editor-status')).toHaveText(
    '下書きを削除しました。公開済みの記事は変更していません。',
  );
  await expect(page.getByRole('button', { name: TITLE, exact: true })).toHaveCount(0);
  // Without the create button, focus lands on the editor area rather than being dropped.
  await expect(page.locator('#editor-main')).toBeFocused();

  // #178: the notice's links land on the named account section, not on the page top.
  await page
    .getByRole('note', { name: '新しい投稿について' })
    .getByRole('link', { name: '停止', exact: true })
    .click();
  await expect(page).toHaveURL(ORIGIN + '/account#publications');
  await expectLanded(page, page.getByRole('region', { name: '自分の公開記録', exact: true }));

  // Works: the notice appears and saving a new project is not offered.
  await page.goto('/works/new');
  await expect(
    page
      .getByRole('note', { name: '新しい投稿について' })
      .getByRole('heading', { name: '卒業予定を過ぎています' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '作品を保存', exact: true })).toBeDisabled();
  expect(await noHorizontalScroll(page)).toBe(true);
  await page
    .getByRole('note', { name: '新しい投稿について' })
    .getByRole('link', { name: '在学期間を直す', exact: true })
    .click();
  await expect(page).toHaveURL(ORIGIN + '/account#enrollment');
  await expectLanded(page, page.getByRole('region', { name: '在学期間' }));

  // The published article stays public until the owner stops it.
  const guest = await browser.newContext({ baseURL: ORIGIN, ignoreHTTPSErrors: true });
  try {
    const reader = await guest.newPage();
    await reader.goto(articlePath);
    await expect(reader.getByRole('heading', { name: TITLE, exact: true })).toBeVisible();

    await page.goto('/account');
    const records = page.getByRole('region', { name: '自分の公開記録', exact: true });
    await records.getByRole('button', { name: '公開を止める：' + TITLE, exact: true }).click();
    const stop = page.getByRole('alertdialog', { name: /の公開を止めますか/ });
    await stop.getByRole('button', { name: '公開を止める', exact: true }).click();
    await expect(stop).toBeHidden();
    await expect(page.getByText(/の公開を止めました/)).toBeVisible();
    await reader.reload();
    await expect(reader.getByRole('heading', { name: '記事が見つかりません' })).toBeVisible();
  } finally {
    await guest.close();
  }

  // Correcting a mistaken year reopens writing at once, without reloading.
  await correctYears(page, '2026', '2028');
  await expect(page.getByRole('note', { name: '新しい投稿について' })).toHaveCount(0);
  await page.getByRole('link', { name: '記事を書く', exact: true }).click();
  await expect(page.getByRole('button', { name: '新しい下書き', exact: true })).toBeEnabled();
});
