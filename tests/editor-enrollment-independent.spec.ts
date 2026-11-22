import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

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

test('independent choices cannot express an invalid period and a same-year declaration saves without extra steps', async ({
  page,
}, info) => {
  const { form } = await open(page);
  let puts = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/private/enrollment' && request.method() === 'PUT')
      puts++;
  });
  // Graduation waits for an admission, and only offers months on or after it.
  await expect(graduation(form)).toBeDisabled();
  await admission(form).selectOption('2026');
  const offered = await graduation(form)
    .locator('option:not([disabled])')
    .evaluateAll((options) => options.map((o) => Number((o as HTMLOptionElement).value)));
  expect(Math.min(...offered)).toBe(2026);
  for (const select of [admission(form), graduation(form)]) {
    const id = await select.getAttribute('id');
    await expect(page.locator('label[for="' + id + '"]')).toBeVisible();
  }
  expect(puts).toBe(0);
  await shot(form, info, '01-choices-only-valid.png');
  await graduation(form).selectOption('2026');
  await expect(graduation(form).locator('option:checked')).toHaveText('2027年3月');
  await save(form).click();
  await expect(form.getByRole('status')).toHaveText('在学期間を保存しました。');
  expect(await stored(page)).toMatchObject({
    enrollment: { admissionYear: 2026, graduationYear: 2026, version: 1 },
  });
  expect(puts).toBe(1);
  await expect(form.getByRole('combobox')).toHaveCount(2);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shot(form, info, '02-same-year-explicit-save.png');
});

test('independent same-session conceal and failed proof retain the exact unsaved year inputs without writing', async ({
  page,
}, info) => {
  const { form } = await open(page);
  await admission(form).selectOption('2024');
  await graduation(form).selectOption('2029');
  await graduation(form).evaluate((element) => {
    (element as unknown as { __qaEnrollmentMarker?: boolean }).__qaEnrollmentMarker = true;
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
  expect(await page.locator('.account-enrollment select').count()).toBe(2);
  release();
  await expect(graduation(form)).toBeVisible();
  await expect(admission(form)).toHaveValue('2024');
  await expect(graduation(form)).toHaveValue('2029');
  expect(
    await graduation(form).evaluate((element) =>
      Boolean((element as unknown as { __qaEnrollmentMarker?: boolean }).__qaEnrollmentMarker),
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
  expect(await page.locator('.account-enrollment select').count()).toBe(2);
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
      Boolean((element as unknown as { __qaEnrollmentMarker?: boolean }).__qaEnrollmentMarker),
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
  // Without a manual check button, the page reads back after an unclear save: hold that read.
  await admission(form).selectOption('2025');
  let release!: () => void, arrived!: () => void;
  const held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    ready = new Promise<void>((resolve) => {
      arrived = resolve;
    });
  await page.route(endpoint, async (route) => {
    if (route.request().method() === 'PUT')
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
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
  await save(form).click();
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
  await expect(save(region(page))).toHaveCount(0);
  expect(await stored(page)).toEqual({ enrollment: null, participation: 'missing' });
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shot(region(page), info, '06-new-session-starts-with-blank-private-years.png');
});
