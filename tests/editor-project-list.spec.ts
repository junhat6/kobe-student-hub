import { test, expect, type Page } from '@playwright/test';
const origin = 'https://127.0.0.1:8788';
const region = (page: Page) => page.getByRole('region', { name: '画像なし作品の登録' });
async function setup(page: Page) {
  await page.goto('/lab/account');
  const csrf = await page.evaluate(async () => {
    const session = (await (
      await fetch('/__fixture/profile-session', { method: 'POST' })
    ).json()) as { csrfToken: string };
    const r = await fetch('/api/private/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer csrf.' + session.csrfToken,
      },
      body: JSON.stringify({
        displayName: '作品だけの投稿者',
        bio: '本人入力の紹介',
        confirmPublic: true,
      }),
    });
    if (r.status !== 201) throw Error('profile setup failed');
    return session.csrfToken;
  });
  await page.reload();
  await expect(region(page)).toBeVisible();
  await expect(
    region(page).getByRole('button', { name: '作品の保存一覧を更新', exact: true }),
  ).toBeEnabled();
  return csrf;
}
async function fill(page: Page, description = '架空の作品説明') {
  await region(page).getByLabel('作品タイトル', { exact: true }).fill('画像なしの架空作品');
  await region(page).getByLabel('作品説明（プレーンテキスト）', { exact: true }).fill(description);
  await region(page)
    .getByLabel('GitHub URL（任意）', { exact: true })
    .fill('https://example.invalid');
  await region(page)
    .getByLabel('デモ URL（任意）', { exact: true })
    .fill('https://demo.example.invalid?sample=public#view');
}
async function save(page: Page) {
  await region(page).getByRole('button', { name: '作品を保存', exact: true }).click();
  await expect(region(page).getByRole('status')).toContainText('確認した入力を保存しました。');
}
async function prepare(page: Page) {
  await region(page)
    .getByRole('button', { name: '作品の公開準備・記録を確認', exact: true })
    .click();
  await expect(
    region(page).getByRole('button', { name: '確認した保存版の作品をローカルで公開', exact: true }),
  ).toBeEnabled();
}
const list = (page: Page) => region(page).getByRole('list', { name: '確認済みの作品保存記録' });
const row = (page: Page, title: string) =>
  list(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: '保存版を確認：' + title, exact: true }) });
test('confirmed create and save snapshots update only known list rows while later typing stays private', async ({
  page,
}) => {
  await setup(page);
  let listReads = 0;
  page.on('request', (r) => {
    if (r.method() === 'GET' && r.url() === origin + '/api/private/project-drafts') listReads++;
  });
  await page.route('**/api/private/project-drafts', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"error":"synthetic_list_failure"}',
        })
      : route.continue(),
  );
  await region(page).getByRole('button', { name: '作品の保存一覧を更新', exact: true }).click();
  await expect(region(page).getByRole('alert')).toContainText('保存一覧を確認できません');
  await page.unroute('**/api/private/project-drafts');
  await fill(page);
  const before = listReads;
  let releaseCreate: () => void = () => {};
  const createGate = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });
  let createCommitted = false;
  await page.route('**/api/private/project-drafts', async (route) => {
    if (route.request().method() === 'POST') {
      const r = await route.fetch();
      expect(r.status()).toBe(201);
      createCommitted = true;
      await createGate;
      await route.fulfill({ response: r });
    } else await route.continue();
  });
  await region(page).getByRole('button', { name: '作品を保存', exact: true }).click();
  await expect.poll(() => createCommitted).toBe(true);
  await region(page).getByLabel('作品タイトル', { exact: true }).fill('後から入力したタイトル二');
  await region(page)
    .getByLabel('作品説明（プレーンテキスト）', { exact: true })
    .fill('作成待ち中の私的説明二');
  releaseCreate();
  await expect(row(page, '画像なしの架空作品')).toContainText('版 1');
  await expect(region(page).getByLabel('作品タイトル', { exact: true })).toHaveValue(
    '後から入力したタイトル二',
  );
  await expect(region(page).getByRole('alert')).toContainText('保存一覧を確認できません');
  expect(listReads).toBe(before);
  let releaseSave: () => void = () => {};
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let saveCommitted = false;
  await page.route('**/api/private/project-drafts/*', async (route) => {
    if (route.request().method() === 'PUT') {
      const r = await route.fetch();
      expect(r.status()).toBe(200);
      saveCommitted = true;
      await saveGate;
      await route.fulfill({ response: r });
    } else await route.continue();
  });
  await region(page).getByRole('button', { name: '作品を保存', exact: true }).click();
  await expect.poll(() => saveCommitted).toBe(true);
  await region(page).getByLabel('作品タイトル', { exact: true }).fill('まだ保存しないタイトル三');
  await region(page)
    .getByLabel('作品説明（プレーンテキスト）', { exact: true })
    .fill('保存待ち中の私的説明三');
  releaseSave();
  await expect(row(page, '後から入力したタイトル二')).toContainText('版 2');
  await expect(list(page).getByRole('listitem')).toHaveCount(1);
  await expect(region(page).getByLabel('作品タイトル', { exact: true })).toHaveValue(
    'まだ保存しないタイトル三',
  );
  await expect(
    region(page).getByLabel('作品説明（プレーンテキスト）', { exact: true }),
  ).toHaveValue('保存待ち中の私的説明三');
  await expect(region(page).getByRole('region', { name: '公開前の作品保存版' })).toContainText(
    '後から入力したタイトル二',
  );
  expect(listReads).toBe(before);
});
test('an uncertain committed save stays old until an explicit GET confirms its summary without replacing input', async ({
  page,
}) => {
  await setup(page);
  await fill(page);
  await save(page);
  await expect(row(page, '画像なしの架空作品')).toContainText('版 1');
  await region(page)
    .getByLabel('作品タイトル', { exact: true })
    .fill('サーバーで確定したタイトル二');
  await region(page)
    .getByLabel('作品説明（プレーンテキスト）', { exact: true })
    .fill('サーバーで確定した説明二');
  let puts = 0;
  await page.route('**/api/private/project-drafts/*', async (route) => {
    if (route.request().method() === 'PUT') {
      puts++;
      const r = await route.fetch();
      expect(r.status()).toBe(200);
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"synthetic_lost_ack"}',
      });
    } else await route.continue();
  });
  await region(page).getByRole('button', { name: '作品を保存', exact: true }).click();
  await expect(region(page).getByRole('status')).toContainText('保存結果を確認できませんでした');
  await expect(row(page, '画像なしの架空作品')).toContainText('版 1');
  await expect(
    list(page).getByRole('button', {
      name: '保存版を確認：サーバーで確定したタイトル二',
      exact: true,
    }),
  ).toHaveCount(0);
  await region(page).getByLabel('作品タイトル', { exact: true }).fill('手元に残すタイトル三');
  await region(page)
    .getByLabel('作品説明（プレーンテキスト）', { exact: true })
    .fill('手元に残す説明三');
  await region(page).getByRole('button', { name: '保存済みの作品を確認', exact: true }).click();
  await expect(row(page, 'サーバーで確定したタイトル二')).toContainText('版 2');
  await expect(region(page).getByRole('region', { name: '比較用の作品保存版' })).toContainText(
    'サーバーで確定した説明二',
  );
  await expect(region(page).getByRole('region', { name: '公開前の作品保存版' })).toContainText(
    '現在の保存版 1',
  );
  await expect(
    region(page).getByRole('button', { name: '作品を保存', exact: true }),
  ).toBeDisabled();
  await expect(region(page).getByLabel('作品タイトル', { exact: true })).toHaveValue(
    '手元に残すタイトル三',
  );
  await expect(
    region(page).getByLabel('作品説明（プレーンテキスト）', { exact: true }),
  ).toHaveValue('手元に残す説明三');
  await region(page).getByRole('button', { name: '確認した版を基準にする', exact: true }).click();
  await expect(region(page).getByRole('button', { name: '作品を保存', exact: true })).toBeEnabled();
  expect(puts).toBe(1);
});
test('a synthetic older owned GET cannot regress a known newer list row or replace the local buffer', async ({
  page,
}) => {
  await setup(page);
  await fill(page);
  await save(page);
  const previous = await page.evaluate(async () => {
    const rows = (await (await fetch('/api/private/project-drafts')).json()) as { id: string }[];
    return (await (await fetch('/api/private/project-drafts/' + rows[0].id)).json()) as {
      id: string;
      version: number;
      title: string;
    };
  });
  await region(page).getByLabel('作品タイトル', { exact: true }).fill('既に確認済みのタイトル二');
  await region(page)
    .getByLabel('作品説明（プレーンテキスト）', { exact: true })
    .fill('既に確認済みの説明二');
  await save(page);
  await expect(row(page, '既に確認済みのタイトル二')).toContainText('版 2');
  await region(page)
    .getByLabel('作品説明（プレーンテキスト）', { exact: true })
    .fill('未保存の説明三');
  await page.route(origin + '/api/private/project-drafts/' + previous.id, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(previous),
        })
      : route.continue(),
  );
  await list(page)
    .getByRole('button', { name: '保存版を確認：既に確認済みのタイトル二', exact: true })
    .click();
  await expect(region(page).getByRole('region', { name: '比較用の作品保存版' })).toContainText(
    '保存済みの版 1',
  );
  await expect(row(page, '既に確認済みのタイトル二')).toContainText('版 2');
  await expect(
    list(page).getByRole('button', { name: '保存版を確認：画像なしの架空作品', exact: true }),
  ).toHaveCount(0);
  await expect(
    region(page).getByLabel('作品説明（プレーンテキスト）', { exact: true }),
  ).toHaveValue('未保存の説明三');
  await expect(region(page).getByRole('region', { name: '公開前の作品保存版' })).toContainText(
    '現在の保存版 2',
  );
});
