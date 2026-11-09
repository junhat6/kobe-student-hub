import { fulfillGoogleFormPost } from './helpers/google-form-post';
import { test, expect, type Page, type TestInfo } from '@playwright/test';

const ORIGIN = 'https://127.0.0.1:8790';
async function register(page: Page, info: TestInfo) {
  const provider = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;
  const actor = `fictional-project-${info.project.name}-${Date.now().toString(36)}`;
  await page.route(provider, async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('response_mode')).toBe('form_post');
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

test('ordinary project snapshot reaches anonymous readers and is removed by owner stop', async ({
  page,
  browser,
}, info) => {
  const title = `架空の作品-${info.project.name}`;
  const description = `公開する作品説明-${info.project.name}`;
  await register(page, info);
  await page.getByText('公開プロフィールを準備する', { exact: true }).click();
  const profile = page.getByRole('region', { name: '公開プロフィールの初回作成' });
  await profile.getByLabel('表示名 必須').fill('架空の作品投稿者');
  await profile.getByRole('checkbox').check();
  await profile
    .getByRole('button', { name: '確認した内容でプロフィールを作成', exact: true })
    .click();
  await expect(profile.locator('.profile-setup-status')).toHaveText(
    '公開プロフィールを作成しました。',
  );
  await page.getByRole('link', { name: '作品を登録する', exact: true }).click();
  await expect(page).toHaveURL(ORIGIN + '/works/new');
  await page.getByLabel('作品タイトル', { exact: true }).fill(title);
  await page.getByLabel('作品説明（プレーンテキスト）', { exact: true }).fill(description);
  await page
    .getByLabel('GitHub URL（任意）', { exact: true })
    .fill('https://github.com/example/fictional-project');
  await page.getByRole('button', { name: '作品を保存', exact: true }).click();
  await expect(
    page.getByText('手元の入力と保存版は一致しています。', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: '作品の公開準備・記録を確認', exact: true }).click();
  await page.getByRole('button', { name: '確認した保存版の作品を公開', exact: true }).click();
  const link = page.getByRole('link', { name: 'ログインなしで作品を見る' });
  await expect(link).toBeVisible();
  const path = await link.getAttribute('href');
  expect(path).toMatch(/^\/projects\/[0-9a-f-]{36}$/);
  await page
    .getByLabel('作品説明（プレーンテキスト）', { exact: true })
    .fill('PRIVATE_PROJECT_CONTINUATION');
  await page.getByRole('button', { name: '作品を保存', exact: true }).click();
  await expect(
    page.getByText('手元の入力と保存版は一致しています。', { exact: false }),
  ).toBeVisible();
  const guest = await browser.newContext({
    baseURL: ORIGIN,
    ignoreHTTPSErrors: true,
    viewport: page.viewportSize() ?? undefined,
  });
  try {
    expect((await guest.request.get('/api/private/project-drafts')).status()).toBe(401);
    expect(
      (await guest.request.get('/api/private/project-reports/' + path!.split('/').at(-1))).status(),
    ).toBe(401);
    const reader = await guest.newPage();
    const privateRequests: string[] = [];
    reader.on('request', (request) => {
      if (
        new URL(request.url()).pathname.startsWith('/api/private/') &&
        new URL(request.url()).pathname !== '/api/private/session'
      )
        privateRequests.push(request.url());
    });
    await reader.goto(path!);
    await expect(reader.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(reader.locator('.project-description')).toHaveText(description);
    await expect(reader.locator('main')).not.toContainText('PRIVATE_PROJECT_CONTINUATION');
    expect(privateRequests).toEqual([]);
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await reader.screenshot({
      path: info.outputPath('ordinary-project-reader.png'),
      fullPage: true,
      scale: 'css',
    });
    await reader.locator('.detail-author .author').click();
    await expect(
      reader.getByRole('heading', { name: '架空の作品投稿者', exact: true }),
    ).toBeVisible();
    await expect(reader.getByRole('link', { name: title, exact: true })).toBeVisible();
    const activity = reader.getByRole('navigation', { name: '投稿者の活動' });
    await activity.getByRole('link', { name: '記事', exact: true }).click();
    await expect(
      reader.getByRole('heading', { name: '架空の作品投稿者', exact: true }),
    ).toBeVisible();
    await expect(
      reader.getByText('公開している記事はまだありません。', { exact: true }),
    ).toBeVisible();
    await expect(reader.getByRole('heading', { name: '投稿者を表示できませんでした' })).toHaveCount(
      0,
    );
    expect(privateRequests).toEqual([]);
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await reader.screenshot({
      path: info.outputPath('ordinary-project-only-articles.png'),
      fullPage: true,
      scale: 'css',
    });
    await activity.getByRole('link', { name: '作品', exact: true }).click();
    await expect(
      reader.getByRole('heading', { name: '公開している作品', exact: true }),
    ).toBeVisible();
    await expect(reader.getByRole('link', { name: title, exact: true })).toBeVisible();
    expect(privateRequests).toEqual([]);
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await reader.screenshot({
      path: info.outputPath('ordinary-project-only-works.png'),
      fullPage: true,
      scale: 'css',
    });
    await reader.goto('/works');
    await expect(reader.getByRole('link', { name: title, exact: true })).toBeVisible();
    await register(reader, info);
    await reader.goto(path!);
    await reader.getByRole('button', { name: 'この作品を通報する', exact: true }).click();
    await reader.getByLabel('作品の通報理由（必須）', { exact: true }).fill('架空の通報理由');
    await reader.locator('.project-report-form').getByRole('checkbox').check();
    await reader.getByRole('button', { name: '確認した作品通報を送信', exact: true }).click();
    await expect(reader.locator('.project-report-form [role="status"]')).toContainText(
      'このアカウントの受付記録を確認しました',
    );
    await page.bringToFront();
    await page.getByRole('link', { name: 'アカウントへ戻る', exact: true }).click();
    const records = page.getByRole('region', { name: '自分の公開記録', exact: true });
    await records.getByRole('button', { name: '公開停止を確認：' + title, exact: true }).click();
    const stop = page.getByRole('region', { name: '選択した公開の停止' });
    await stop.getByRole('checkbox').check();
    await stop.getByRole('button', { name: '確認した公開保存版を停止' }).click();
    await expect(stop.getByRole('status')).toContainText('公開停止記録を確認しました');
    await reader.goto(path!);
    await expect(reader.getByRole('heading', { name: '作品を表示できませんでした' })).toBeVisible();
    await reader.goto('/works');
    await expect(reader.getByRole('link', { name: title, exact: true })).toHaveCount(0);
  } finally {
    await guest.close();
  }
});
