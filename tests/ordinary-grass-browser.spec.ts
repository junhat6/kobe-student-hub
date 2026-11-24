import { fulfillGoogleFormPost } from './helpers/google-form-post';
import { test, expect, type Page, type TestInfo } from '@playwright/test';

// #225: the grass on one's own page and the short burst after publishing (1eb2933), walked in a
// real browser on the HTTPS fixture instead of unit tests and swapped APIs.

const ORIGIN = 'https://127.0.0.1:8790';
const provider = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;

async function registerWithProfile(page: Page, info: TestInfo, tag: string) {
  const actor = `fictional-grass-${tag}-${info.project.name}-${Date.now().toString(36)}`;
  await page.route(provider, async (route) => {
    const url = new URL(route.request().url());
    const state = url.searchParams.get('state')!;
    const nonce = url.searchParams.get('nonce')!;
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
  const profile = page.getByRole('region', { name: 'プロフィールをつくる' });
  await profile.getByLabel('表示名', { exact: true }).fill('架空の草の学生');
  await profile.getByRole('button', { name: '公開する', exact: true }).click();
  await expect(page.getByRole('button', { name: 'プロフィールを編集', exact: true })).toBeVisible();
}

/** Saves a fictional draft and stops right before the final publish click. */
async function prepareArticle(page: Page, title: string) {
  await page.getByRole('link', { name: '記事を書く', exact: true }).click();
  await page.getByRole('button', { name: '新しい下書き', exact: true }).click();
  await page.getByLabel('タイトル', { exact: true }).fill(title);
  await page.getByLabel('Markdown本文', { exact: true }).fill('## 草\n\n架空の公開記録です。');
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み');
  await page
    .locator('.editor-main-heading')
    .getByRole('button', { name: '公開する', exact: true })
    .click();
  const composer = page.getByRole('region', { name: '保存済み版の公開', exact: true });
  await composer.getByLabel('記事の概要（300文字以内）').fill('草が1つ伸びるかの確認');
  await composer.getByRole('checkbox').check();
  return composer;
}

const grass = (page: Page) => page.getByRole('region', { name: '草', exact: true });

/** Records whether the burst was ever attached, since it removes itself after its duration. */
async function watchBurst(page: Page) {
  await page.evaluate(() => {
    const flags = window as unknown as { burstSeen?: boolean };
    flags.burstSeen = false;
    new MutationObserver(() => {
      if (document.querySelector('.celebration')) flags.burstSeen = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  return () => page.evaluate(() => (window as unknown as { burstSeen?: boolean }).burstSeen);
}

test('own grass starts empty, the publish burst appears and leaves, and the grass grows by one', async ({
  page,
}, info) => {
  await registerWithProfile(page, info, 'motion');
  // Before anything is public, one's own page shows the empty field and the first nudge.
  await expect(grass(page)).toBeVisible();
  await expect(grass(page).getByText('最初の1本で芽が出ます', { exact: true })).toBeVisible();
  await expect(grass(page).getByRole('img', { name: /^過去半年の公開：0日・0件/ })).toBeVisible();
  await expect(grass(page).locator('.milestones')).toHaveCount(0);

  const composer = await prepareArticle(page, '架空の草ノート');
  const burstSeen = await watchBurst(page);
  await composer.getByRole('button', { name: '確認した保存済み版を公開', exact: true }).click();
  await expect(composer.getByRole('link', { name: 'ログインなしの読者画面を開く' })).toBeVisible();
  // The burst is decoration: shown, hidden from assistive tech, and gone after its duration
  // without blocking the page (pointer-events: none).
  const burst = page.locator('.celebration');
  await expect(burst).toBeVisible();
  await expect(burst).toHaveAttribute('aria-hidden', 'true');
  await expect(burst.locator('.celebration-badge')).toHaveText('+1');
  expect(await burst.evaluate((node) => getComputedStyle(node).pointerEvents)).toBe('none');
  await expect(burst).toHaveCount(0, { timeout: 5000 });
  expect(await burstSeen()).toBe(true);

  // Back on one's own page, today's square is green and the nudge has moved on.
  await page.goto('/account');
  await expect(grass(page).getByRole('img', { name: /^過去半年の公開：1日・1件/ })).toBeVisible();
  await expect(grass(page).locator('.grass-cell.is-today')).not.toHaveClass(/level-0/);
  await expect(grass(page).getByText('最初の1本で芽が出ます', { exact: true })).toHaveCount(0);
  await expect(grass(page).locator('.grass-streak')).toHaveText('1週連続');
  // #223: the first milestone is reached and the next one is shown with what is left.
  const marks = grass(page).getByRole('list', { name: '節目（自分だけに見えます）' });
  await expect(marks.locator('.milestone.is-reached')).toHaveText(['初公開']);
  await expect(marks.locator('.milestone.is-next')).toHaveText('5本あと4本');
  // The page still fits the viewport with the grass on it.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('reduced motion publishes without the burst and still grows the grass', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await registerWithProfile(page, info, 'still');
  const composer = await prepareArticle(page, '架空の静かな草ノート');
  const burstSeen = await watchBurst(page);
  await composer.getByRole('button', { name: '確認した保存済み版を公開', exact: true }).click();
  await expect(composer.getByRole('link', { name: 'ログインなしの読者画面を開く' })).toBeVisible();
  await expect(composer.locator('.publication-message')).toContainText('公開しました');
  // Longer than the burst would last, so a burst that appeared would have been recorded.
  await page.waitForTimeout(500);
  expect(await burstSeen()).toBe(false);
  await page.goto('/account');
  await expect(grass(page).getByRole('img', { name: /^過去半年の公開：1日・1件/ })).toBeVisible();
  // The milestone is there but does not bounce.
  const first = grass(page).locator('.milestone.is-reached');
  await expect(first).toHaveText('初公開');
  expect(await first.evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
});
