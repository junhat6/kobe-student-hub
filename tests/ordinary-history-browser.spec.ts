import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { accountMenu } from './helpers/header';
import { fulfillGoogleFormPost } from './helpers/google-form-post';
const ORIGIN = 'https://127.0.0.1:8790';
const provider = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;
async function register(page: Page, info: TestInfo, who = 'a') {
  const actor = `fictional-history-${who}-${info.project.name}-${Date.now().toString(36)}`;
  await page.route(provider, async (route) => {
    const u = new URL(route.request().url()),
      state = u.searchParams.get('state')!,
      nonce = u.searchParams.get('nonce')!;
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
  await expect(page.getByRole('link', { name: '記事を書く', exact: true })).toBeVisible();
  await page.unroute(provider);
}
const recorded = (page: Page) =>
  page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/private/reading-history' &&
      r.request().method() === 'PUT' &&
      r.status() === 200,
  );
test('logged-in read → private history → single/all delete → collection disabled, with guest isolation', async ({
  page,
  browser,
}, info) => {
  await register(page, info);
  let saved = recorded(page);
  await page.goto('/articles/learning-notes');
  expect(await (await saved).json()).toEqual({ recorded: true });
  await expect(
    page.getByRole('heading', {
      name: '「動いた」で終わらせない、制作ノートの残し方',
      exact: true,
    }),
  ).toBeVisible();
  await accountMenu(page, '閲覧履歴');
  const panel = page.getByRole('region', { name: '自分の閲覧履歴', exact: true });
  await expect(
    panel.getByRole('link', { name: '「動いた」で終わらせない、制作ノートの残し方', exact: true }),
  ).toBeVisible();
  await expect(panel.getByText('記事 · 架空サンプル', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('private-reading-history.png'), fullPage: true });
  await panel
    .getByRole('button', {
      name: '「動いた」で終わらせない、制作ノートの残し方を履歴から削除',
      exact: true,
    })
    .click();
  await expect(panel.getByText('閲覧履歴はまだありません。', { exact: true })).toBeVisible();
  saved = recorded(page);
  await page.goto('/projects/tiny-notes');
  expect(await (await saved).json()).toEqual({ recorded: true });
  await accountMenu(page, '閲覧履歴');
  await expect(panel.getByRole('link', { name: 'ひとこと制作ノート', exact: true })).toBeVisible();
  await expect(panel.getByText('作品 · 架空サンプル', { exact: true })).toBeVisible();
  await panel
    .getByRole('checkbox', { name: 'これから読む記事・作品を履歴に残す', exact: true })
    .uncheck();
  await expect(panel.getByRole('status')).toContainText('これからの履歴の記録を停止しました');
  await expect(panel.getByRole('link', { name: 'ひとこと制作ノート', exact: true })).toBeVisible();
  saved = recorded(page);
  await page.goto('/articles/git-branches');
  expect(await (await saved).json()).toEqual({ recorded: false });
  await accountMenu(page, '閲覧履歴');
  await expect(panel.getByRole('checkbox')).not.toBeChecked();
  await expect(panel.locator('li')).toHaveCount(1);
  page.once('dialog', (d) => d.accept());
  await panel.getByRole('button', { name: '履歴をすべて削除', exact: true }).click();
  await expect(panel.getByText('閲覧履歴はまだありません。', { exact: true })).toBeVisible();
  const guest = await browser.newContext({
    baseURL: ORIGIN,
    ignoreHTTPSErrors: true,
    viewport: page.viewportSize() ?? undefined,
  });
  try {
    const reader = await guest.newPage();
    const historyWrites: string[] = [];
    reader.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/private/reading-history' && r.method() !== 'GET')
        historyWrites.push(r.method());
    });
    await reader.goto('/articles/learning-notes');
    await expect(reader.locator('h1')).toContainText('制作ノート');
    await reader.goto('/history');
    await expect(
      reader.getByRole('link', { name: 'ログインして履歴を見る', exact: true }),
    ).toBeVisible();
    await expect(reader.getByRole('region', { name: '自分の閲覧履歴', exact: true })).toHaveCount(
      0,
    );
    expect(historyWrites).toEqual([]);
  } finally {
    await guest.close();
  }
});

test('history body arriving after logout is not displayed by the EOF session guard', async ({
  page,
  context,
}, info) => {
  await register(page, info);
  const saved = recorded(page);
  await page.goto('/articles/learning-notes');
  expect(await (await saved).json()).toEqual({ recorded: true });
  let release: () => void = () => {},
    entered: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const ready = new Promise<void>((r) => {
    entered = r;
  });
  await page.route('**/api/private/reading-history', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    entered();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page.goto('/history');
    await ready;
    await context.clearCookies();
    release();
    await expect(page.getByRole('region', { name: '自分の閲覧履歴', exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: 'ログインして履歴を見る', exact: true }),
    ).toBeVisible();
    await expect(page.locator('main')).not.toContainText(
      '「動いた」で終わらせない、制作ノートの残し方',
    );
  } finally {
    release();
    await page.unroute('**/api/private/reading-history');
  }
});

test('history next/previous controls retain the requested page with bounded synthetic responses', async ({
  page,
}, info) => {
  await register(page, info);
  await page.route('**/api/private/reading-history*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const offset = Number(new URL(route.request().url()).searchParams.get('offset') ?? 0);
    const entries = Array.from({ length: offset === 0 ? 20 : 1 }, (_, i) => ({
      kind: 'article',
      contentId: 'fictional-page-' + (offset + i),
      title: '架空の履歴 ' + (offset + i),
      isSample: false,
      lastViewedAt: 1800000000000 - i,
    }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entries,
        enabled: true,
        capacity: 500,
        nextOffset: offset === 0 ? 20 : null,
      }),
    });
  });
  await page.goto('/history');
  const panel = page.getByRole('region', { name: '自分の閲覧履歴', exact: true });
  await expect(panel.getByRole('link', { name: '架空の履歴 0', exact: true })).toBeVisible();
  await expect(panel.getByText('記事 · 架空サンプル', { exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: '次の20件', exact: true }).click();
  await expect(panel.getByRole('link', { name: '架空の履歴 20', exact: true })).toBeVisible();
  await expect(panel.getByRole('link', { name: '架空の履歴 0', exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: '前の20件', exact: true }).click();
  await expect(panel.getByRole('link', { name: '架空の履歴 0', exact: true })).toBeVisible();
  await expect(panel.getByRole('link', { name: '架空の履歴 20', exact: true })).toHaveCount(0);
});

test('history stays private to its owner across logged-in accounts, and stopping survives reload until resumed', async ({
  page,
  browser,
}, info) => {
  await register(page, info, 'owner');
  let saved = recorded(page);
  await page.goto('/articles/learning-notes');
  expect(await (await saved).json()).toEqual({ recorded: true });
  await page.goto('/history');
  const panel = page.getByRole('region', { name: '自分の閲覧履歴', exact: true });
  const toggle = panel.getByRole('checkbox', {
    name: 'これから読む記事・作品を履歴に残す',
    exact: true,
  });
  await toggle.uncheck();
  await expect(panel.getByRole('status')).toContainText('これからの履歴の記録を停止しました');
  await page.reload();
  await expect(toggle).not.toBeChecked();
  saved = recorded(page);
  await page.goto('/projects/tiny-notes');
  expect(await (await saved).json()).toEqual({ recorded: false });

  const other = await browser.newContext({
    baseURL: ORIGIN,
    ignoreHTTPSErrors: true,
    viewport: page.viewportSize() ?? undefined,
  });
  try {
    const peer = await other.newPage();
    await register(peer, info, 'peer');
    await peer.goto('/history');
    const peerPanel = peer.getByRole('region', { name: '自分の閲覧履歴', exact: true });
    await expect(peerPanel.getByText('閲覧履歴はまだありません。', { exact: true })).toBeVisible();
    await expect(peerPanel).not.toContainText('制作ノートの残し方');
    await expect(
      peerPanel.getByRole('checkbox', { name: 'これから読む記事・作品を履歴に残す', exact: true }),
    ).toBeChecked();
    for (const suffix of ['?owner=x', '?accountId=x'])
      expect((await peer.request.get('/api/private/reading-history' + suffix)).status()).toBe(404);
    const peerSaved = recorded(peer);
    await peer.goto('/articles/git-branches');
    expect(await (await peerSaved).json()).toEqual({ recorded: true });
  } finally {
    await other.close();
  }

  await page.goto('/history');
  await expect(panel.locator('li')).toHaveCount(1);
  await expect(
    panel.getByRole('link', { name: '「動いた」で終わらせない、制作ノートの残し方', exact: true }),
  ).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(panel.getByRole('status')).toContainText('履歴の記録を有効にしました');
  saved = recorded(page);
  await page.goto('/projects/tiny-notes');
  expect(await (await saved).json()).toEqual({ recorded: true });
  await page.goto('/history');
  await expect(panel.getByRole('link', { name: 'ひとこと制作ノート', exact: true })).toBeVisible();
  await expect(panel).not.toContainText('ブランチの考え方');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('history-owner-only.png'), fullPage: true });
});
