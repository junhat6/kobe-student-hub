import { fulfillGoogleFormPost } from './helpers/google-form-post';
import { test, expect, type Page, type TestInfo } from '@playwright/test';

const ORIGIN = 'https://127.0.0.1:8790';
const provider = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;

async function register(page: Page, info: TestInfo) {
  const actor = `fictional-link-${info.project.name}-${Date.now().toString(36)}`;
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
  await profile.getByLabel('表示名', { exact: true }).fill('架空のリンク投稿者');
  await profile.getByRole('button', { name: '公開する', exact: true }).click();
  await expect(page.getByRole('button', { name: 'プロフィールを編集', exact: true })).toBeVisible();
}

async function publishArticle(page: Page, title: string) {
  await page.goto('/account');
  await page.getByRole('link', { name: '記事の管理', exact: true }).click();
  await page.getByRole('button', { name: '新しい下書き', exact: true }).click();
  await page.getByLabel('タイトル', { exact: true }).fill(title);
  await page.getByLabel('Markdown本文', { exact: true }).fill('## 作り方\n\n架空の制作記録です。');
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み');
  await page
    .locator('.editor-main-heading')
    .getByRole('button', { name: '公開する', exact: true })
    .click();
  const composer = page.getByRole('region', { name: '保存済み版の公開', exact: true });
  await composer.getByLabel('記事の概要（300文字以内）').fill('作品の制作記録');
  await composer.getByRole('checkbox').check();
  await composer.getByRole('button', { name: '確認した保存済み版を公開', exact: true }).click();
  const link = composer.getByRole('link', { name: 'ログインなしの読者画面を開く' });
  await expect(link).toBeVisible();
  return (await link.getAttribute('href'))!;
}

test('owner links own article to a project; readers move both ways directly', async ({
  page,
  browser,
}, info) => {
  const articleTitle = `架空の制作記録-${info.project.name}`;
  const projectTitle = `架空のつながる作品-${info.project.name}`;
  await register(page, info);
  const articlePath = await publishArticle(page, articleTitle);
  expect(articlePath).toMatch(/^\/articles\/[0-9a-f-]{36}$/);

  await page.goto('/works/new');
  await page.getByLabel('作品タイトル', { exact: true }).fill(projectTitle);
  await page.getByLabel('作品の説明', { exact: true }).fill('架空の作品説明');
  await page.getByRole('button', { name: '作品を保存', exact: true }).click();
  await expect(page.getByText('保存済みです。', { exact: false })).toBeVisible();
  // #235: the publish check runs by itself once the saved version matches the input.
  await expect(
    page.getByRole('button', { name: '確認した保存版の作品を公開', exact: true }),
  ).toBeEnabled();
  const links = page.getByRole('group', { name: 'この作品の記事（任意・3件まで）' });
  await expect(links).toBeVisible();
  await links.getByRole('checkbox', { name: articleTitle, exact: true }).check();
  await page.screenshot({
    path: info.outputPath('project-article-picker.png'),
    fullPage: true,
    scale: 'css',
  });
  await page.getByRole('button', { name: '確認した保存版の作品を公開', exact: true }).click();
  const open = page.getByRole('link', { name: 'ログインなしで作品を見る' });
  await expect(open).toBeVisible();
  const projectPath = (await open.getAttribute('href'))!;

  const guest = await browser.newContext({
    baseURL: ORIGIN,
    ignoreHTTPSErrors: true,
    viewport: page.viewportSize() ?? undefined,
  });
  try {
    const reader = await guest.newPage();
    await reader.goto(projectPath);
    const section = reader.getByRole('region', { name: 'この作品の記事' });
    await expect(section.getByRole('link', { name: articleTitle, exact: true })).toBeVisible();
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await reader.screenshot({
      path: info.outputPath('project-with-article.png'),
      fullPage: true,
      scale: 'css',
    });
    await section.getByRole('link', { name: articleTitle, exact: true }).click();
    await expect(reader).toHaveURL(ORIGIN + articlePath);
    const related = reader.getByRole('region', { name: '関連する記事・作品' });
    await expect(related.getByText('この記事を紐づけた作品', { exact: true })).toBeVisible();
    await reader.screenshot({
      path: info.outputPath('article-with-project.png'),
      fullPage: true,
      scale: 'css',
    });
    await related.getByRole('link', { name: projectTitle, exact: true }).click();
    await expect(reader).toHaveURL(ORIGIN + projectPath);
    await expect(reader.getByRole('heading', { name: projectTitle, exact: true })).toBeVisible();
  } finally {
    await guest.close();
  }
});
