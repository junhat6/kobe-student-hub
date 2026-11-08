import { test, expect, type Page } from '@playwright/test';
const endpoint = '**/api/private/profile';
async function open(page: Page) {
  let csrfToken = '';
  // Each test gets a fresh fictional owner; reload retains its actual session cookie.
  await page.route('**/__fixture/session', async (route) => {
    if (csrfToken) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ csrfToken }),
      });
      return;
    }
    const response = await route.fetch({ url: 'https://127.0.0.1:8788/__fixture/profile-session' });
    expect(response.status()).toBe(200);
    csrfToken = ((await response.json()) as { csrfToken: string }).csrfToken;
    await route.fulfill({ response });
  });
  await page.goto('/');
  const region = page.getByRole('region', { name: '公開プロフィールの初回作成' });
  await region.getByText('公開プロフィールを準備する', { exact: true }).click();
  await expect(region.getByLabel('表示名', { exact: false })).toBeVisible();
  return { region, csrf: () => csrfToken };
}
async function fill(page: Page, name = '  白紙の書き手  ', bio = '自分で入力した紹介です。') {
  await page.getByLabel('表示名', { exact: false }).fill(name);
  await page.getByLabel('学科（任意）', { exact: true }).fill('IT');
  await page.getByLabel('学年の表示（任意）', { exact: true }).fill('2年');
  await page.getByLabel('自己紹介（任意）', { exact: true }).fill(bio);
}
const create = (page: Page) =>
  page.getByRole('button', { name: '確認した内容でプロフィールを作成', exact: true });
const confirm = (page: Page) =>
  page.getByRole('checkbox', {
    name: 'この内容をログインしていない人にも表示することを確認しました',
    exact: true,
  });
test('explicit blank input, anonymous preview and confirmation create only the submitted public fields', async ({
  page,
}) => {
  let posts = 0;
  let external = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/private/profile') && request.method() === 'POST') posts++;
    if (request.url().includes('profile-exfil.invalid')) external++;
  });
  const { region } = await open(page);
  for (const label of ['表示名', '学科（任意）', '学年の表示（任意）', '自己紹介（任意）'])
    await expect(page.getByLabel(label, { exact: label !== '表示名' })).toHaveValue('');
  await expect(create(page)).toBeDisabled();
  await expect(confirm(page)).not.toBeChecked();
  const bio = '<img src="https://profile-exfil.invalid/x" onerror="alert(1)">';
  await fill(page, undefined, bio);
  const preview = region.getByRole('article', { name: '公開プロフィールのプレビュー' });
  await expect(preview.getByRole('heading')).toHaveText('  白紙の書き手  ', {
    useInnerText: false,
  });
  await expect(preview.locator('.profile-public-avatar')).toHaveText('白');
  await expect(preview.getByText(bio, { exact: true })).toBeVisible();
  await expect(preview.locator('img')).toHaveCount(0);
  expect(external).toBe(0);
  expect(posts).toBe(0);
  await confirm(page).check();
  await expect(create(page)).toBeEnabled();
  await page.getByLabel('自己紹介（任意）', { exact: true }).fill(bio + '\n追記');
  await expect(confirm(page)).not.toBeChecked();
  await expect(create(page)).toBeDisabled();
  expect(posts).toBe(0);
  await confirm(page).check();
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/private/profile') && r.request().method() === 'POST',
  );
  await create(page).click();
  expect((await response).status()).toBe(201);
  await expect(
    region.getByText('公開プロフィールを作成しました。このローカル検証内でのみ保存されています。', {
      exact: true,
    }),
  ).toBeVisible();
  expect(posts).toBe(1);
  await expect(create(page)).toHaveCount(0);
  await expect(region.getByRole('article', { name: '登録されたプロフィール' })).toContainText(
    '白紙の書き手',
  );
  await page.reload();
  await region.getByText('公開プロフィールを準備する', { exact: true }).click();
  await expect(region.getByRole('article', { name: '登録されたプロフィール' })).toContainText(
    bio + '\n追記',
  );
  await expect(create(page)).toHaveCount(0);
  expect(posts).toBe(1);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(page.url()).not.toContain('白紙');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('lost successful acknowledgement keeps input until manual GET confirms the same profile without resending', async ({
  page,
}) => {
  const { region } = await open(page);
  await fill(page, '受付を確認する名前', 'この紹介は手元に残ります');
  let posts = 0;
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(endpoint, async (route) => {
    if (route.request().method() === 'POST') {
      posts++;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await pending;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"synthetic_lost_ack"}',
      });
    } else await route.continue();
  });
  await confirm(page).check();
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/private/profile') && r.request().method() === 'POST',
  );
  await create(page).click();
  await expect(page.getByLabel('表示名', { exact: false })).toBeDisabled();
  release();
  expect((await response).status()).toBe(503);
  await expect(
    region.getByText(
      '作成結果を確認できませんでした。入力内容は残しています。再送せず、登録状態を確認してください。',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByLabel('表示名', { exact: false })).toHaveValue('受付を確認する名前');
  await expect(page.getByLabel('表示名', { exact: false })).not.toBeEditable();
  await expect(create(page)).toBeDisabled();
  expect(posts).toBe(1);
  await region.getByRole('button', { name: '登録状態を確認', exact: true }).click();
  await expect(
    region.getByText('同じ内容のプロフィールを確認できました。作成を確認しました。', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(create(page)).toHaveCount(0);
  expect(posts).toBe(1);
});
test('a different stored profile is displayed without overwriting it or discarding the held input', async ({
  page,
}) => {
  const { region, csrf } = await open(page);
  await fill(page, '保持している入力', '上書きせず保持する紹介');
  const status = await page.evaluate(
    async (token) =>
      (
        await fetch('/api/private/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer csrf.' + token },
          body: JSON.stringify({
            displayName: '先に登録された名前',
            department: '',
            yearLabel: '',
            bio: 'すでに登録された紹介',
            confirmPublic: true,
          }),
        })
      ).status,
    csrf(),
  );
  expect(status).toBe(201);
  await confirm(page).check();
  await create(page).click();
  await expect(
    region.getByText(
      '作成結果を確認できませんでした。入力内容は残しています。再送せず、登録状態を確認してください。',
      { exact: true },
    ),
  ).toBeVisible();
  await region.getByRole('button', { name: '登録状態を確認', exact: true }).click();
  await expect(
    region.getByText(
      '異なる内容のプロフィールが登録されています。この画面から上書きしません。手元の入力は残しています。',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(region.getByRole('article', { name: '登録されたプロフィール' })).toContainText(
    '先に登録された名前',
  );
  await expect(page.getByLabel('表示名', { exact: false })).toHaveValue('保持している入力');
  await expect(page.getByLabel('自己紹介（任意）', { exact: true })).toHaveValue(
    '上書きせず保持する紹介',
  );
  await expect(create(page)).toHaveCount(0);
});
test('an uncommitted failure requires manual absence check and renewed confirmation before a new attempt', async ({
  page,
}) => {
  const { region } = await open(page);
  await fill(page, '確認し直す名前');
  let posts = 0;
  await page.route(endpoint, (route) => {
    if (route.request().method() === 'POST') {
      posts++;
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"synthetic_no_commit"}',
      });
    }
    return route.continue();
  });
  await confirm(page).check();
  await create(page).click();
  await expect(region.getByRole('button', { name: '登録状態を確認', exact: true })).toBeVisible();
  await expect(create(page)).toBeDisabled();
  await region.getByRole('button', { name: '登録状態を確認', exact: true }).click();
  await expect(region.getByText(/登録をまだ確認できませんでした/)).toBeVisible();
  await expect(page.getByLabel('表示名', { exact: false })).toHaveValue('確認し直す名前');
  await expect(page.getByLabel('表示名', { exact: false })).toBeEditable();
  await expect(confirm(page)).not.toBeChecked();
  await expect(create(page)).toBeDisabled();
  expect(posts).toBe(1);
});
