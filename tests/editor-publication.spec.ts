import { test, expect, type Page } from '@playwright/test';
const confirmName =
  '保存済みの版と公開情報を確認し、ログインしていない読者にも見える記事としてローカルで公開します';
async function open(page: Page, withProfile = true) {
  let csrf = '';
  await page.route('**/__fixture/session', async (route) => {
    if (csrf) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ csrfToken: csrf }),
      });
      return;
    }
    const response = await route.fetch({ url: 'https://127.0.0.1:8788/__fixture/profile-session' });
    expect(response.status()).toBe(200);
    csrf = ((await response.json()) as { csrfToken: string }).csrfToken;
    await route.fulfill({ response });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '新しい下書き', exact: true })).toBeVisible();
  if (withProfile) await profile(page);
  return () => csrf;
}
async function profile(page: Page) {
  const region = page.getByRole('region', { name: '公開プロフィールの初回作成' });
  await region.getByText('公開プロフィールを準備する', { exact: true }).click();
  await region.getByLabel('表示名', { exact: false }).fill('ローカル投稿者');
  await region.getByLabel('自己紹介（任意）', { exact: true }).fill('本人が入力した紹介');
  await region
    .getByRole('checkbox', {
      name: 'この内容をログインしていない人にも表示することを確認しました',
      exact: true,
    })
    .check();
  await region
    .getByRole('button', { name: '確認した内容でプロフィールを作成', exact: true })
    .click();
  await expect(
    region.getByText('公開プロフィールを作成しました。このローカル検証内でのみ保存されています。', {
      exact: true,
    }),
  ).toBeVisible();
}
async function draft(
  page: Page,
  title = '保存済みの記事',
  body = '# 保存した本文\n\nローカルの架空の経験です。',
) {
  await page.getByRole('button', { name: '新しい下書き', exact: true }).click();
  await page.getByLabel('タイトル', { exact: true }).fill(title);
  await page.getByLabel('Markdown本文', { exact: true }).fill(body);
  await save(page);
}
async function save(page: Page) {
  const button = page.getByRole('button', { name: '下書きを保存', exact: true });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByRole('status')).toHaveText('下書きを保存しました。');
  await expect(button).toBeDisabled();
}
const composer = (page: Page) => page.getByRole('region', { name: '保存済み版のローカル公開' });
async function prepare(page: Page, summary = '公開する記事の概要') {
  const region = composer(page);
  await region.getByText('公開前の確認（ローカル専用）', { exact: true }).click();
  await region.getByLabel('記事の概要（300文字以内）', { exact: true }).fill(summary);
  await region.getByLabel('タグ（カンマ区切り、5件まで）', { exact: true }).fill(' Ｇｉｔ, 学び ');
  await region.getByLabel('読了時間の目安（分）', { exact: true }).fill('5');
  return region;
}
const publish = (page: Page) =>
  composer(page).getByRole('button', { name: '確認した保存済み版をローカルで公開', exact: true });
const confirm = (page: Page) =>
  composer(page).getByRole('checkbox', { name: confirmName, exact: true });
const inspect = (page: Page) =>
  composer(page).getByRole('button', { name: '公開準備・記録を確認', exact: true });
const readerLink = (page: Page) =>
  composer(page).getByRole('link', { name: 'ログインなしの読者画面を開く ↗', exact: true });
async function id(page: Page) {
  return await page.evaluate(async () => {
    const rows = (await (await fetch('/api/private/drafts')).json()) as { id: string }[];
    return rows[0].id;
  });
}
test('saved preview and explicit confirmation publish the snapshot to a cookie-free local reader', async ({
  page,
  browser,
}) => {
  let posts = 0;
  let payload: Record<string, unknown> | undefined;
  page.on('request', (request) => {
    if (request.url().includes('/api/private/publications/') && request.method() === 'POST') {
      posts++;
      payload = request.postDataJSON() as Record<string, unknown>;
    }
  });
  await open(page);
  const body =
    '# 保存した本文\n\n<script>window.__publicationInjected=true</script>\n\n![hidden](https://publication-exfil.invalid/private)\n\nローカルの架空の経験です。';
  await draft(page, undefined, body);
  const region = await prepare(page);
  await expect(confirm(page)).not.toBeChecked();
  await expect(publish(page)).toBeDisabled();
  expect(posts).toBe(0);
  await region.getByText('保存済みの版 2 の本文を確認', { exact: true }).click();
  await expect(region.getByRole('heading', { name: '保存した本文', exact: true })).toBeVisible();
  await expect(region.getByLabel('公開されるタグ')).toHaveText('Git学び');
  await confirm(page).check();
  await region.getByLabel('記事の概要（300文字以内）', { exact: true }).fill('確認し直した概要');
  await expect(confirm(page)).not.toBeChecked();
  await expect(publish(page)).toBeDisabled();
  await confirm(page).check();
  await publish(page).click();
  await expect(readerLink(page)).toBeVisible();
  expect(posts).toBe(1);
  expect(payload).toMatchObject({
    expectedVersion: 2,
    confirmPublic: true,
    summary: '確認し直した概要',
    tags: ['Git', '学び'],
    minutes: 5,
  });
  for (const key of ['title', 'body', 'ownerId', 'publicProfileId'])
    expect(payload).not.toHaveProperty(key);
  await expect(readerLink(page)).toHaveAttribute('target', '_blank');
  const href = (await readerLink(page).getAttribute('href'))!;
  const device = test.info().project.use;
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: 'https://127.0.0.1:8788',
    viewport: page.viewportSize(),
    screen: device.screen,
    isMobile: device.isMobile,
    hasTouch: device.hasTouch,
    deviceScaleFactor: device.deviceScaleFactor,
    userAgent: device.userAgent,
  });
  const reader = await context.newPage();
  expect(reader.viewportSize()).toEqual(page.viewportSize());
  let bootstraps = 0,
    images = 0;
  reader.on('request', (request) => {
    if (request.url().includes('/__fixture/')) bootstraps++;
    if (request.url().includes('publication-exfil.invalid')) images++;
    if (request.url().includes('/__lab/articles/')) {
      expect(request.headers().cookie).toBeUndefined();
      expect(request.headers()['x-csrf-token']).toBeUndefined();
    }
  });
  try {
    await reader.goto(href);
    await expect(
      reader.getByRole('heading', { name: '保存済みの記事', exact: true }),
    ).toBeVisible();
    await expect(reader.getByRole('region', { name: '投稿者' })).toContainText('ローカル投稿者');
    await expect(reader.getByRole('article', { name: '記事本文' })).toContainText(
      'ローカルの架空の経験です。',
    );
    await expect(reader.locator('img')).toHaveCount(0);
    expect(await reader.evaluate(() => '__publicationInjected' in window)).toBe(false);
    expect(bootstraps).toBe(0);
    expect(images).toBe(0);
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await reader.route('**/__lab/articles/*', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: '{"error":"unavailable"}',
      }),
    );
    await reader.reload();
    await expect(
      reader.getByRole('heading', { name: 'この記事を表示できません', exact: true }),
    ).toBeVisible();
    expect(bootstraps).toBe(0);
  } finally {
    await context.close();
  }
});
test('missing profile, unsaved source and changed saved version prevent publication without losing metadata', async ({
  page,
}) => {
  await open(page, false);
  await draft(page);
  const region = await prepare(page);
  await expect(region.getByText(/公開プロフィールがまだありません/)).toBeVisible();
  await expect(confirm(page)).toBeDisabled();
  let dialogs = 0;
  page.once('dialog', async (dialog) => {
    dialogs++;
    expect(dialog.message()).toContain('未保存');
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: '新しい下書き', exact: true }).click();
  expect(dialogs).toBe(1);
  await expect(region.getByLabel('記事の概要（300文字以内）', { exact: true })).toHaveValue(
    '公開する記事の概要',
  );
  await profile(page);
  await inspect(page).click();
  await expect(confirm(page)).toBeEnabled();
  await confirm(page).check();
  await page.getByLabel('Markdown本文', { exact: true }).fill('新しい手元の変更');
  await expect(confirm(page)).not.toBeChecked();
  await expect(publish(page)).toBeDisabled();
  await save(page);
  await expect(confirm(page)).not.toBeChecked();
  await expect(region.getByText('保存済みの版 3 の本文を確認', { exact: true })).toBeVisible();
  await expect(region.getByLabel('記事の概要（300文字以内）', { exact: true })).toHaveValue(
    '公開する記事の概要',
  );
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});
test('typing during a pending publication stays private while navigation and saving are locked', async ({
  page,
}) => {
  await open(page);
  await draft(page);
  await prepare(page);
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let posts = 0;
  await page.route('**/api/private/publications/*', async (route) => {
    if (route.request().method() === 'POST') {
      posts++;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await pending;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await confirm(page).check();
  await publish(page).click();
  await expect(page.getByRole('button', { name: '新しい下書き', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '下書きを保存', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Markdown本文', { exact: true })).toBeEditable();
  await page.getByLabel('Markdown本文', { exact: true }).fill('公開していない追加の文章');
  release();
  await expect(readerLink(page)).toBeVisible();
  await expect(page.getByLabel('Markdown本文', { exact: true })).toHaveValue(
    '公開していない追加の文章',
  );
  await expect(composer(page).getByText(/手元の追加編集は公開していません/)).toBeVisible();
  await save(page);
  await expect(
    composer(page).getByRole('heading', { name: '公開した保存済みの版 2', exact: true }),
  ).toBeVisible();
  expect(posts).toBe(1);
  const href = (await readerLink(page).getAttribute('href'))!;
  const body = await page.evaluate(async (path) => {
    const value = (await (
      await fetch(path.replace('/lab/articles/', '/__lab/articles/'), {
        credentials: 'omit',
        cache: 'no-store',
      })
    ).json()) as { entry: { body: string } };
    return value.entry.body;
  }, href);
  expect(body).toBe('# 保存した本文\n\nローカルの架空の経験です。');
});
test('an uncertain committed response requires a manual matching receipt and never retries POST', async ({
  page,
}) => {
  await open(page);
  await draft(page);
  await prepare(page);
  let posts = 0;
  await page.route('**/api/private/publications/*', async (route) => {
    if (route.request().method() === 'POST') {
      posts++;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"synthetic_lost_ack"}',
      });
    } else await route.continue();
  });
  await confirm(page).check();
  await publish(page).click();
  await expect(composer(page).getByText(/公開結果を確認できませんでした/)).toBeVisible();
  await expect(publish(page)).toBeDisabled();
  expect(posts).toBe(1);
  await inspect(page).click();
  await expect(readerLink(page)).toBeVisible();
  await expect(
    composer(page).getByText(/公開を確認しました。手元の追加編集は公開していません/),
  ).toBeVisible();
  expect(posts).toBe(1);
});
test('unavailable receipts never mean absence and a confirmed null requires renewed consent', async ({
  page,
}) => {
  await open(page);
  await draft(page);
  await prepare(page);
  let posts = 0;
  let unavailable = false;
  await page.route('**/api/private/publications/*', (route) => {
    if (route.request().method() === 'POST') {
      posts++;
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"synthetic_no_commit"}',
      });
    }
    if (unavailable)
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: '{"error":"unavailable"}',
      });
    return route.continue();
  });
  await confirm(page).check();
  await publish(page).click();
  await expect(composer(page).getByText(/公開結果を確認できませんでした/)).toBeVisible();
  unavailable = true;
  await inspect(page).click();
  await expect(composer(page).getByText(/未公開とは判断せず/)).toBeVisible();
  await expect(publish(page)).toBeDisabled();
  expect(posts).toBe(1);
  unavailable = false;
  await inspect(page).click();
  await expect(composer(page).getByText(/公開をまだ確認できませんでした/)).toBeVisible();
  await expect(confirm(page)).not.toBeChecked();
  await expect(publish(page)).toBeDisabled();
  await expect(composer(page).getByLabel('記事の概要（300文字以内）', { exact: true })).toHaveValue(
    '公開する記事の概要',
  );
  expect(posts).toBe(1);
});
test('a different existing publication is read-only and never overwrites the held proposal', async ({
  page,
}) => {
  const csrf = await open(page);
  await draft(page);
  await prepare(page, '手元に保持する概要');
  const draftId = await id(page);
  const status = await page.evaluate(
    async ({ id, token }) =>
      (
        await fetch('/api/private/publications/' + id, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer csrf.' + token },
          body: JSON.stringify({
            expectedVersion: 2,
            confirmPublic: true,
            summary: '先に公開された概要',
            tags: [],
            minutes: 3,
          }),
        })
      ).status,
    { id: draftId, token: csrf() },
  );
  expect(status).toBe(201);
  await confirm(page).check();
  await publish(page).click();
  await expect(composer(page).getByText(/公開結果を確認できませんでした/)).toBeVisible();
  await inspect(page).click();
  await expect(composer(page).getByText(/異なる内容の公開記録が見つかりました/)).toBeVisible();
  await expect(composer(page).getByRole('region', { name: '公開済みの記録' })).toContainText(
    '先に公開された概要',
  );
  await expect(composer(page).getByLabel('記事の概要（300文字以内）', { exact: true })).toHaveValue(
    '手元に保持する概要',
  );
  await expect(
    composer(page).getByLabel('記事の概要（300文字以内）', { exact: true }),
  ).not.toBeEditable();
  await expect(publish(page)).toBeDisabled();
  await expect(page.getByLabel('Markdown本文', { exact: true })).toHaveValue(
    '# 保存した本文\n\nローカルの架空の経験です。',
  );
});
