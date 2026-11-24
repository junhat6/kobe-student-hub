import AxeBuilder from '@axe-core/playwright';
import { fulfillGoogleFormPost } from './helpers/google-form-post';
import { test, expect, type Page, type TestInfo } from '@playwright/test';

// #275: a project can be published as 制作中, shows a small labelled mark on its public page and in
// the works list, and only its owner switches it to 完成 (which removes the mark, as before #275).
const ORIGIN = 'https://127.0.0.1:8790';
const provider = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;

async function register(page: Page, info: TestInfo) {
  const actor = `fictional-stage-${info.project.name}-${Date.now().toString(36)}`;
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
  await profile.getByLabel('表示名', { exact: true }).fill('架空の制作中投稿者');
  await profile.getByRole('button', { name: '公開する', exact: true }).click();
  await expect(page.getByRole('button', { name: 'プロフィールを編集', exact: true })).toBeVisible();
}

async function serious(page: Page) {
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

const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test('a project published as 制作中 is marked publicly and only its owner switches it to 完成', async ({
  page,
  browser,
}, info) => {
  const title = `架空の制作中の作品-${info.project.name}-${Date.now().toString(36)}`;
  await register(page, info);
  await page.goto('/works/new');
  await page.getByLabel('作品タイトル', { exact: true }).fill(title);
  await page.getByLabel('作品の説明', { exact: true }).fill('まだ途中の架空の作品です。');
  await page.getByRole('button', { name: '作品を保存', exact: true }).click();
  await expect(page.getByText('保存済みです。', { exact: false })).toBeVisible();
  const publish = page.getByRole('button', { name: '作品を公開する', exact: true });
  await expect(publish).toBeEnabled();
  const choice = page.getByRole('group', { name: '作品の状態' });
  // 完成 stays the default, so publishing as before keeps today's behaviour.
  await expect(choice.getByRole('radio', { name: '完成', exact: true })).toBeChecked();
  // #284: the two choices explain themselves; no note sits under them.
  await expect(choice.getByRole('paragraph')).toHaveCount(0);
  await choice.getByRole('radio', { name: '制作中', exact: true }).check();
  expect(await serious(page)).toEqual([]);
  expect(await noSideScroll(page)).toBe(true);
  await page.screenshot({ path: info.outputPath('stage-choice.png'), fullPage: true });
  await publish.click();
  const open = page.getByRole('link', { name: 'ログインなしで作品を見る' });
  await expect(open).toBeVisible();
  const projectPath = (await open.getAttribute('href'))!;
  const owner = page.getByRole('group', { name: '公開中の作品の状態' });
  await expect(owner).toContainText('いまの状態：制作中');

  const guest = await browser.newContext({
    baseURL: ORIGIN,
    ignoreHTTPSErrors: true,
    viewport: page.viewportSize() ?? undefined,
  });
  try {
    const reader = await guest.newPage();
    await reader.goto(projectPath);
    const heading = reader.getByRole('heading', { level: 1 });
    await expect(heading).toContainText(title);
    await expect(heading.getByRole('img', { name: '制作中', exact: true })).toBeVisible();
    // The reader sees no switch: only the owner's editor has one.
    await expect(
      reader.getByRole('button', { name: /「完成」にする|「制作中」に戻す/ }),
    ).toHaveCount(0);
    expect(await serious(reader)).toEqual([]);
    expect(await noSideScroll(reader)).toBe(true);
    await reader.screenshot({ path: info.outputPath('stage-detail.png'), fullPage: true });
    await reader.goto('/works');
    const card = reader.locator('article.content-card', { hasText: title });
    await expect(card.getByRole('img', { name: '制作中', exact: true })).toBeVisible();
    expect(await serious(reader)).toEqual([]);
    expect(await noSideScroll(reader)).toBe(true);
    await reader.screenshot({ path: info.outputPath('stage-works.png'), fullPage: true });

    await owner.getByRole('button', { name: '「完成」にする', exact: true }).click();
    await expect(owner).toContainText('いまの状態：完成');
    await expect(
      owner.getByRole('button', { name: '「制作中」に戻す', exact: true }),
    ).toBeVisible();
    // 完成 draws nothing, exactly like every project before #275.
    await reader.goto(projectPath);
    await expect(reader.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(reader.getByRole('img', { name: '制作中', exact: true })).toHaveCount(0);
    await reader.goto('/works');
    await expect(
      reader
        .locator('article.content-card', { hasText: title })
        .getByRole('img', { name: '制作中', exact: true }),
    ).toHaveCount(0);
  } finally {
    await guest.close();
  }
});
