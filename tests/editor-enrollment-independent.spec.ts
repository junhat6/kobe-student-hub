import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const ORIGIN = 'https://127.0.0.1:8788';
const endpoint = '**/api/private/enrollment';
const region = (page: Page) =>
  page.getByRole('region', { name: '入学年度と卒業予定年度', exact: true });
const admission = (form: Locator) => form.getByLabel('入学年度 必須', { exact: true });
const graduation = (form: Locator) => form.getByLabel('卒業予定年度 必須', { exact: true });
const save = (form: Locator) => form.getByRole('button', { name: /^年度を(?:訂正して)?保存$/ });
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
  await expect(admission(region(page))).toBeVisible();
  return { csrf, form: region(page) };
}
async function shot(target: Locator, info: TestInfo, name: string) {
  const directory = path.join('/tmp/ksh-enrollment-independent-20261108', info.project.name);
  await mkdir(directory, { recursive: true });
  await target.screenshot({ path: path.join(directory, name), scale: 'css' });
}
async function stored(page: Page) {
  const result = await page.context().request.get('/api/private/enrollment');
  expect(result.status()).toBe(200);
  return result.json();
}

test('independent field errors are associated with both private labels and same-year declaration saves without extra steps', async ({
  page,
}, info) => {
  const { form } = await open(page);
  let puts = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/private/enrollment' && request.method() === 'PUT')
      puts++;
  });
  await admission(form).fill('２０２６');
  await graduation(form).fill('1899');
  await expect(admission(form)).toHaveAttribute('aria-invalid', 'true');
  await expect(graduation(form)).toHaveAttribute('aria-invalid', 'true');
  await expect(
    form.getByText('入学年度は1900〜2199の西暦4桁で入力してください。', { exact: true }),
  ).toBeVisible();
  await expect(
    form.getByText('卒業予定年度は1900〜2199の西暦4桁で入力してください。', { exact: true }),
  ).toBeVisible();
  for (const input of [admission(form), graduation(form)]) {
    const descriptions = await input.getAttribute('aria-describedby');
    expect(descriptions).toBeTruthy();
    for (const id of descriptions!.split(' '))
      await expect(page.locator('[id="' + id + '"]')).toBeVisible();
  }
  await expect(save(form)).toBeDisabled();
  expect(puts).toBe(0);
  await shot(form, info, '01-validation-labels-and-help.png');
  await admission(form).fill('2027');
  await graduation(form).fill('2026');
  await expect(
    form.getByText('卒業予定年度は入学年度と同じか、それより後にしてください。', { exact: true }),
  ).toBeVisible();
  await expect(save(form)).toBeDisabled();
  await admission(form).fill('2026');
  await graduation(form).fill('2026');
  await expect(save(form)).toBeEnabled();
  await save(form).click();
  await expect(form.getByRole('status')).toContainText('年度を保存しました。');
  expect(await stored(page)).toMatchObject({
    enrollment: { admissionYear: 2026, graduationYear: 2026, version: 1 },
  });
  expect(puts).toBe(1);
  await expect(
    form.getByText('登録した年度に基づく利用期間内です。年度はこの画面で訂正できます。', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(form.getByRole('textbox')).toHaveCount(2);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shot(form, info, '02-same-year-explicit-save.png');
});

test('independent same-session conceal and failed proof retain the exact unsaved year inputs without writing', async ({
  page,
}, info) => {
  const { form } = await open(page);
  await admission(form).fill('2024');
  await graduation(form).fill('2029');
  await graduation(form).evaluate((element) => {
    (element as HTMLInputElement & { __qaEnrollmentMarker?: boolean }).__qaEnrollmentMarker = true;
  });
  let puts = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/private/enrollment' && request.method() === 'PUT')
      puts++;
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/private/session', async (route) => {
    await held;
    await route.continue();
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.session-private')).toBeHidden();
  expect(
    await page.locator('.session-private').evaluate((element) => (element as HTMLElement).inert),
  ).toBe(true);
  expect(await page.locator('.account-enrollment input').count()).toBe(2);
  release();
  await expect(graduation(form)).toBeVisible();
  await expect(admission(form)).toHaveValue('2024');
  await expect(graduation(form)).toHaveValue('2029');
  expect(
    await graduation(form).evaluate((element) =>
      Boolean(
        (element as HTMLInputElement & { __qaEnrollmentMarker?: boolean }).__qaEnrollmentMarker,
      ),
    ),
  ).toBe(true);
  await page.unroute('**/api/private/session');
  await page.route('**/api/private/session', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"synthetic_unverified"}',
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    page.getByText(/手元の編集はこのページのメモリ内に保持したまま隠しています/),
  ).toBeVisible();
  await expect(page.locator('.session-private')).toBeHidden();
  expect(await page.locator('.account-enrollment input').count()).toBe(2);
  await shot(
    page.locator('.session-account-lab'),
    info,
    '03-unverified-private-years-concealed.png',
  );
  await page.unroute('**/api/private/session');
  await page.getByRole('button', { name: 'セッションを再確認', exact: true }).click();
  await expect(graduation(form)).toBeVisible();
  await expect(admission(form)).toHaveValue('2024');
  await expect(graduation(form)).toHaveValue('2029');
  expect(
    await graduation(form).evaluate((element) =>
      Boolean(
        (element as HTMLInputElement & { __qaEnrollmentMarker?: boolean }).__qaEnrollmentMarker,
      ),
    ),
  ).toBe(true);
  await expect(save(form)).toBeEnabled();
  expect(await stored(page)).toEqual({ enrollment: null, participation: 'missing' });
  expect(puts).toBe(0);
  await shot(form, info, '04-same-session-unsaved-years-resumed.png');
});

test('independent delayed old-session enrollment read cannot reveal old years after a cookie switch', async ({
  page,
}, info) => {
  const { form, csrf } = await open(page);
  const response = await page.context().request.put('/api/private/enrollment', {
    headers: { Origin: ORIGIN, Authorization: 'Bearer csrf.' + csrf },
    data: { admissionYear: 2024, graduationYear: 2028, expectedVersion: 0 },
  });
  expect(response.status()).toBe(200);
  await form.getByRole('button', { name: '保存状態を確認', exact: true }).click();
  await expect(
    form.getByRole('button', { name: '確認した保存版を基準にする', exact: true }),
  ).toBeVisible();
  let release!: () => void, arrived!: () => void;
  const held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    ready = new Promise<void>((resolve) => {
      arrived = resolve;
    });
  await page.route(endpoint, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const old = await route.fetch();
    expect(old.status()).toBe(200);
    expect(await old.json()).toMatchObject({
      enrollment: { admissionYear: 2024, graduationYear: 2028 },
    });
    arrived();
    await held;
    try {
      await route.fulfill({ response: old });
    } catch {}
  });
  await form.getByRole('button', { name: '保存状態を確認', exact: true }).click();
  await ready;
  await seed(page);
  release();
  await expect(
    page.getByText(
      '別のセッションを検出したため、前の編集画面を閉じました。セッションを再確認してから続行してください。',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.locator('.account-enrollment')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新しい下書き', exact: true })).toHaveCount(0);
  await shot(page.locator('.session-account-lab'), info, '05-old-session-response-discarded.png');
  await page.unroute(endpoint);
  await page.getByRole('button', { name: 'セッションを再確認', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '確認したセッションで編集を開く', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.account-enrollment')).toHaveCount(0);
  await page.getByRole('button', { name: '確認したセッションで編集を開く', exact: true }).click();
  await expect(admission(region(page))).toHaveValue('');
  await expect(graduation(region(page))).toHaveValue('');
  await expect(save(region(page))).toBeDisabled();
  expect(await stored(page)).toEqual({ enrollment: null, participation: 'missing' });
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shot(region(page), info, '06-new-session-starts-with-blank-private-years.png');
});
