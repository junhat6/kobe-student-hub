import { fulfillGoogleFormPost } from './helpers/google-form-post';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page, type TestInfo } from '@playwright/test';

const ORIGIN = 'https://127.0.0.1:8790';
const provider = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;

async function register(page: Page, info: TestInfo) {
  const actor = `fictional-journal-${info.project.name}-${Date.now().toString(36)}`;
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
  await profile.getByLabel('表示名', { exact: true }).fill('架空の日誌投稿者');
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

async function seriousViolations(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => !(a instanceof CSSTransition) || a.playState !== 'running'),
  );
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(' ')) }));
}

// #273: a project published first gains its owner's later articles as a 制作日誌, and readers
// follow them oldest first on the project page.
test('owner adds and removes later articles as the project journal; readers see them by date', async ({
  page,
  browser,
}, info) => {
  const projectTitle = `架空の日誌の作品-${info.project.name}`;
  const day1 = `架空の日誌1日目-${info.project.name}`,
    day2 = `架空の日誌2日目-${info.project.name}`;
  await register(page, info);

  await page.goto('/works/new');
  await page.getByLabel('作品タイトル', { exact: true }).fill(projectTitle);
  await page.getByLabel('作品の説明', { exact: true }).fill('架空の作品説明');
  await page.getByRole('button', { name: '作品を保存', exact: true }).click();
  await expect(page.getByText('保存済みです。', { exact: false })).toBeVisible();
  const before = page.getByRole('group', { name: 'この作品の記事（任意・3件まで）' });
  await expect(
    before.getByText('記事は作品の公開後に「制作日誌」として足せます。', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '作品を公開する', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '作品を公開する', exact: true }).click();
  const open = page.getByRole('link', { name: 'ログインなしで作品を見る' });
  await expect(open).toBeVisible();
  const projectPath = (await open.getAttribute('href'))!;
  // Right after publishing, with no articles yet, the journal says how to start one.
  const empty = page.getByRole('group', { name: '制作日誌' });
  await expect(empty.getByText('日誌にできる公開中の記事はまだありません。')).toBeVisible();
  await expect(empty.getByRole('link', { name: '記事を公開' })).toHaveAttribute('href', '/drafts');

  // Articles published after the project.
  const path1 = await publishArticle(page, day1);
  const path2 = await publishArticle(page, day2);

  await page.goto('/works/new');
  await page.getByRole('button', { name: '続きを編集：' + projectTitle, exact: true }).click();
  const journal = page.getByRole('group', { name: '制作日誌' });
  await expect(journal.getByRole('checkbox', { name: day1, exact: true })).not.toBeChecked();
  // Each box changes only once the server confirms the link, so the spec clicks and then waits.
  // Link day 2 first: the page still lists day 1 first, by publication date.
  await journal.getByRole('checkbox', { name: day2, exact: true }).click();
  await expect(journal.getByRole('checkbox', { name: day2, exact: true })).toBeChecked();
  await expect(journal.getByRole('checkbox', { name: day2, exact: true })).toBeEnabled();
  await journal.getByRole('checkbox', { name: day1, exact: true }).click();
  await expect(journal.getByRole('checkbox', { name: day1, exact: true })).toBeChecked();
  await expect(journal.getByRole('checkbox', { name: day1, exact: true })).toBeEnabled();
  await expect(
    page.getByRole('status').filter({ hasText: 'を制作日誌に足しました。' }),
  ).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await journal.screenshot({ path: info.outputPath('project-journal-editor.png') });
  expect(await seriousViolations(page)).toEqual([]);

  // The links survive a reload.
  await page.reload();
  await page.getByRole('button', { name: '続きを編集：' + projectTitle, exact: true }).click();
  const reloaded = page.getByRole('group', { name: '制作日誌' });
  await expect(reloaded.getByRole('checkbox', { name: day1, exact: true })).toBeChecked();
  await expect(reloaded.getByRole('checkbox', { name: day2, exact: true })).toBeChecked();

  const guest = await browser.newContext({
    baseURL: ORIGIN,
    ignoreHTTPSErrors: true,
    viewport: page.viewportSize() ?? undefined,
  });
  try {
    const reader = await guest.newPage();
    await reader.goto(projectPath);
    const section = reader.getByRole('region', { name: '制作日誌' });
    await expect(section.getByRole('link')).toHaveText([day1, day2]);
    await expect(section.locator('time')).toHaveCount(2);
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await reader.screenshot({
      path: info.outputPath('project-journal-page.png'),
      fullPage: true,
      scale: 'css',
    });
    expect(await seriousViolations(reader)).toEqual([]);
    await section.getByRole('link', { name: day1, exact: true }).click();
    await expect(reader).toHaveURL(ORIGIN + path1);

    // The owner removes day 2; the reader no longer sees it.
    await reloaded.getByRole('checkbox', { name: day2, exact: true }).click();
    await expect(reloaded.getByRole('checkbox', { name: day2, exact: true })).not.toBeChecked();
    await expect(reloaded.getByRole('checkbox', { name: day2, exact: true })).toBeEnabled();
    await reader.goto(projectPath);
    await expect(reader.getByRole('region', { name: '制作日誌' }).getByRole('link')).toHaveText([
      day1,
    ]);
    expect(path2).toMatch(/^\/articles\/[0-9a-f-]{36}$/);

    // Day 1 stops being public: readers no longer see it, and the owner can still remove its link.
    await page.goto('/account');
    const records = page.getByRole('region', { name: '自分の公開記録', exact: true });
    await records.getByRole('button', { name: '公開を止める：' + day1, exact: true }).click();
    const stop = page.getByRole('alertdialog', { name: /の公開を止めますか/ });
    await stop.getByRole('button', { name: '公開を止める', exact: true }).click();
    await expect(stop).toBeHidden();
    await reader.goto(projectPath);
    await expect(reader.getByRole('heading', { name: projectTitle, exact: true })).toBeVisible();
    await expect(reader.getByRole('region', { name: '制作日誌' })).toHaveCount(0);
    await page.goto('/works/new');
    await page.getByRole('button', { name: '続きを編集：' + projectTitle, exact: true }).click();
    const left = page.getByRole('group', { name: '制作日誌' });
    const gone = left.getByRole('checkbox', { name: day1 + '（公開を止めた記事）', exact: true });
    await expect(gone).toBeChecked();
    await gone.click();
    await expect(gone).toHaveCount(0);
    await expect(left.getByRole('checkbox', { name: day2, exact: true })).not.toBeChecked();
  } finally {
    await guest.close();
  }
});
