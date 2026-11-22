import { test, expect, type Locator, type Page } from '@playwright/test';

const ORIGIN = 'https://127.0.0.1:8788';
const endpoint = '**/api/private/enrollment';
const region = (page: Page) => page.getByRole('region', { name: '在学期間', exact: true });
const admission = (form: Locator) => form.getByLabel('入学', { exact: true });
const graduation = (form: Locator) => form.getByLabel('卒業予定', { exact: true });
const save = (form: Locator) => form.getByRole('button', { name: '保存', exact: true });
async function seed(page: Page) {
  const response = await page
    .context()
    .request.post('/__fixture/profile-session?enrollment=missing', { headers: { Origin: ORIGIN } });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { csrfToken: string }).csrfToken;
}
async function open(page: Page) {
  const csrf = await seed(page);
  await page.goto('/lab/account');
  const form = region(page);
  await expect(admission(form)).toBeVisible();
  return { form, csrf };
}
async function fill(form: Locator, admissionYear = '2026', graduationYear = '2027') {
  await admission(form).selectOption(admissionYear);
  await graduation(form).selectOption(graduationYear);
}
async function stored(page: Page) {
  const response = await page.context().request.get('/api/private/enrollment');
  expect(response.status()).toBe(200);
  return response.json();
}
async function remoteSave(page: Page, csrf: string, graduationYear = 2027) {
  const response = await page.context().request.put('/api/private/enrollment', {
    headers: { Origin: ORIGIN, Authorization: 'Bearer csrf.' + csrf },
    data: { admissionYear: 2026, graduationYear, expectedVersion: 0 },
  });
  expect(response.status()).toBe(200);
}
async function saved(form: Locator) {
  await expect(form.getByRole('status')).toHaveText('在学期間を保存しました。');
  await expect(form.getByRole('img', { name: '保存しました', exact: true })).toBeVisible();
}

test('two blank private choices save explicitly, reload, and never populate the public profile', async ({
  page,
}, info) => {
  const writes: unknown[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/private/enrollment' && request.method() === 'PUT')
      writes.push(request.postDataJSON());
  });
  const { form } = await open(page);
  await expect(form.getByRole('combobox')).toHaveCount(2);
  await expect(admission(form)).toHaveValue('');
  await expect(graduation(form)).toHaveValue('');
  // Months students know, instead of an academic-year rule to compute.
  await expect(admission(form).locator('option[value="2026"]')).toHaveText('2026年4月');
  await admission(form).selectOption('2026');
  // Choosing the admission suggests the common two-year course.
  await expect(graduation(form)).toHaveValue('2027');
  await expect(graduation(form).locator('option:checked')).toHaveText('2028年3月');
  expect(writes).toEqual([]);
  await save(form).click();
  await saved(form);
  expect(writes).toEqual([{ admissionYear: 2026, graduationYear: 2027, expectedVersion: 0 }]);
  expect(await stored(page)).toMatchObject({
    enrollment: { admissionYear: 2026, graduationYear: 2027, version: 1 },
  });
  await page.reload();
  await expect(admission(form)).toHaveValue('2026');
  await expect(graduation(form)).toHaveValue('2027');
  await expect(save(form)).toHaveCount(0);
  expect(writes).toHaveLength(1);
  const profile = await page.context().request.get('/api/private/profile');
  expect(profile.status()).toBe(200);
  expect(await profile.json()).toEqual({ profile: null });
  const profileForm = page.getByRole('region', { name: '公開プロフィールの初回作成', exact: true });
  await profileForm.getByText('公開プロフィールを準備する', { exact: true }).click();
  await expect(profileForm.getByLabel('表示名', { exact: false })).toHaveValue('');
  await expect(profileForm.getByLabel('学年の表示（任意）', { exact: true })).toHaveValue('');
  await expect(
    profileForm.getByRole('article', { name: '公開プロフィールのプレビュー' }),
  ).not.toContainText('2027');
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(page.url()).toBe(ORIGIN + '/lab/account');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await form.screenshot({ path: info.outputPath('enrollment-private-saved.png'), scale: 'css' });
});

test('the owner corrects both years in the same form with a new expected version', async ({
  page,
}, info) => {
  const { form } = await open(page);
  await fill(form);
  await save(form).click();
  await saved(form);
  await fill(form, '2025', '2028');
  const response = page.waitForResponse(
    (value) =>
      new URL(value.url()).pathname === '/api/private/enrollment' &&
      value.request().method() === 'PUT',
  );
  await save(form).click();
  const acknowledged = await response;
  expect(acknowledged.status()).toBe(200);
  expect(acknowledged.request().postDataJSON()).toEqual({
    admissionYear: 2025,
    graduationYear: 2028,
    expectedVersion: 1,
  });
  await saved(form);
  expect(await stored(page)).toMatchObject({
    enrollment: { admissionYear: 2025, graduationYear: 2028, version: 2 },
  });
  await form.screenshot({ path: info.outputPath('enrollment-owner-correction.png'), scale: 'css' });
});

test('a lost committed save acknowledgement is read back by the page itself without another PUT', async ({
  page,
}) => {
  const { form } = await open(page);
  await fill(form, '2026', '2028');
  let puts = 0;
  await page.route(endpoint, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    puts++;
    const committed = await route.fetch();
    expect(committed.status()).toBe(200);
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"synthetic_lost_ack"}',
    });
  });
  await save(form).click();
  await saved(form);
  await expect(admission(form)).toHaveValue('2026');
  await expect(graduation(form)).toHaveValue('2028');
  await expect(save(form)).toHaveCount(0);
  expect(puts).toBe(1);
  expect(await stored(page)).toMatchObject({
    enrollment: { admissionYear: 2026, graduationYear: 2028, version: 1 },
  });
});

test('a changed saved version keeps the owner choice, says it failed, and one more tap saves on the new version', async ({
  page,
}, info) => {
  const { form, csrf } = await open(page);
  await fill(form, '2026', '2029');
  await remoteSave(page, csrf);
  let puts = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/private/enrollment' && request.method() === 'PUT')
      puts++;
  });
  await save(form).click();
  await expect(form.getByRole('alert')).toContainText('保存できませんでした');
  await expect(admission(form)).toHaveValue('2026');
  await expect(graduation(form)).toHaveValue('2029');
  expect(puts).toBe(1);
  await form.screenshot({
    path: info.outputPath('enrollment-conflict-retains-correction.png'),
    scale: 'css',
  });
  await save(form).click();
  await saved(form);
  expect(puts).toBe(2);
  expect(await stored(page)).toMatchObject({
    enrollment: { admissionYear: 2026, graduationYear: 2029, version: 2 },
  });
});

test('an initial read failure never becomes blank registration and a retry loads existing private years', async ({
  page,
}) => {
  const csrf = await seed(page);
  await remoteSave(page, csrf, 2028);
  let fail = true,
    puts = 0;
  await page.route(endpoint, (route) => {
    if (route.request().method() === 'PUT') puts++;
    return fail && route.request().method() === 'GET'
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"error":"synthetic_read_failure"}',
        })
      : route.continue();
  });
  await page.goto('/lab/account');
  const form = region(page);
  await expect(form.getByRole('alert')).toContainText('読み込めませんでした');
  await expect(form.getByRole('combobox')).toHaveCount(0);
  expect(puts).toBe(0);
  fail = false;
  await form.getByRole('button', { name: 'もう一度', exact: true }).click();
  await expect(admission(form)).toHaveValue('2026');
  await expect(graduation(form)).toHaveValue('2028');
  await expect(save(form)).toHaveCount(0);
  expect(puts).toBe(0);
});
