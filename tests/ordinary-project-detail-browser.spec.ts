import { fulfillGoogleFormPost } from './helpers/google-form-post';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { japanDaysSince } from './helpers/japan-day';

const testStartedAt = Date.now();

const ORIGIN = 'https://127.0.0.1:8790';
const provider = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;

async function register(page: Page, info: TestInfo) {
  const actor = `fictional-detail-${info.project.name}-${Date.now().toString(36)}`;
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
  const profile = page.getByRole('region', { name: 'プロフィールをつくる' });
  await profile.getByLabel('表示名', { exact: true }).fill('架空の作品詳細投稿者');
  await profile.getByRole('button', { name: '公開する', exact: true }).click();
  await expect(page.getByRole('button', { name: 'プロフィールを編集', exact: true })).toBeVisible();
}

test('project detail shows summary, technologies, author and a consent-gated YouTube video without linked articles', async ({
  page,
  browser,
}, info) => {
  const title = `架空の技術つき作品-${info.project.name}`;
  await register(page, info);
  await page.goto('/works/new');
  await page.getByLabel('作品タイトル', { exact: true }).fill(title);
  await page
    .getByLabel('作品説明（プレーンテキスト）', { exact: true })
    .fill('授業の課題で作った架空の作品です。\n\n[架空の紹介動画](https://youtu.be/AbCdEf12345)');
  await page
    .getByLabel('使った技術（任意・読点かカンマ区切り・100文字まで）', { exact: true })
    .fill('React、TypeScript, Cloudflare Workers');
  await page.getByRole('button', { name: '作品を保存', exact: true }).click();
  await expect(
    page.getByText('手元の入力と保存版は一致しています。', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: '作品の公開準備・記録を確認', exact: true }).click();
  await page.getByRole('button', { name: '確認した保存版の作品を公開', exact: true }).click();
  const open = page.getByRole('link', { name: 'ログインなしで作品を見る' });
  await expect(open).toBeVisible();
  const projectPath = (await open.getAttribute('href'))!;
  expect(projectPath).toMatch(/^\/projects\/[0-9a-f-]{36}$/);

  const guest = await browser.newContext({
    baseURL: ORIGIN,
    ignoreHTTPSErrors: true,
    viewport: page.viewportSize() ?? undefined,
  });
  try {
    const reader = await guest.newPage();
    const external: string[] = [];
    await reader.route(/^https?:\/\/(?!127\.0\.0\.1:8790\/)/, async (route) => {
      external.push(route.request().url());
      // Synthetic frame only; no request reaches a vendor.
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        headers: { 'Content-Security-Policy': "default-src 'none'" },
        body: '<!doctype html><title>Synthetic embedded frame</title><p>Synthetic embedded frame</p>',
      });
    });
    await reader.goto(projectPath);
    await expect(reader.getByRole('heading', { name: title, exact: true })).toBeVisible();
    // #142: the public date is the Japan calendar day, printed like the cards (YYYY.MM.DD).
    const publicDate = reader.locator('.detail-author time');
    await expect(publicDate).toHaveText(/^\d{4}\.\d{2}\.\d{2}$/);
    expect(japanDaysSince(testStartedAt)).toContain(await publicDate.textContent());
    await expect(reader.locator('.project-description')).toContainText(
      '授業の課題で作った架空の作品です。',
    );
    const technologies = reader.getByRole('list', { name: '使った技術' });
    await expect(technologies.getByRole('listitem')).toHaveText([
      'React',
      'TypeScript',
      'Cloudflare Workers',
    ]);
    await expect(
      reader.locator('.detail-author').getByRole('link', { name: /架空の作品詳細投稿者/ }),
    ).toBeVisible();
    // No linked articles: the page stands on its own without an empty article section.
    await expect(reader.getByRole('region', { name: 'この作品の記事' })).toHaveCount(0);
    const consent = reader.getByRole('button', { name: 'YouTube動画を読み込む', exact: true });
    await expect(consent).toBeVisible();
    await expect(reader.locator('iframe')).toHaveCount(0);
    expect(external).toEqual([]);
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await reader.screenshot({
      path: info.outputPath('project-detail-before-video.png'),
      fullPage: true,
      scale: 'css',
    });
    await consent.click();
    await expect(
      reader.frameLocator('iframe').getByText('Synthetic embedded frame', { exact: true }),
    ).toBeVisible();
    expect(external).toEqual(['https://www.youtube-nocookie.com/embed/AbCdEf12345']);
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await reader.screenshot({
      path: info.outputPath('project-detail-video.png'),
      fullPage: true,
      scale: 'css',
    });
    await reader.locator('.detail-author .author').click();
    await expect(
      reader.getByRole('heading', { name: '架空の作品詳細投稿者', exact: true }),
    ).toBeVisible();
    await expect(reader.getByRole('link', { name: title, exact: true })).toBeVisible();
  } finally {
    await guest.close();
  }
});
