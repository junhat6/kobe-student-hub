import { fulfillGoogleFormPost } from './helpers/google-form-post';
import { test, expect, type Page, type TestInfo } from '@playwright/test';

const ORIGIN = 'https://127.0.0.1:8790';

test('a rejected callback removes query credentials and a browser-only fragment before opening account', async ({
  page,
}) => {
  const callbacks: string[] = [];
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/api/auth/callback')
      callbacks.push(response.headers()['location']);
  });
  await page.goto(
    '/api/auth/callback?error=access_denied&state=synthetic-private-state#synthetic-private-fragment',
  );
  await expect(page).toHaveURL(ORIGIN + '/account#authentication-failed');
  expect(callbacks).toEqual([ORIGIN + '/account#authentication-failed']);
  expect(await page.locator('body').innerText()).not.toMatch(/synthetic-private/);
  expect(
    await page.evaluate(() => [
      location.search,
      location.hash,
      localStorage.length,
      sessionStorage.length,
    ]),
  ).toEqual(['', '#authentication-failed', 0, 0]);
});
const A = 'fictional-browser-a',
  B = 'fictional-browser-b';
const registerPath = '**/api/auth/register';
const googleAuthorization = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;
const admission = (page: Page) => page.getByLabel('入学年度 必須', { exact: true });
const graduation = (page: Page) => page.getByLabel('卒業予定年度 必須', { exact: true });
const google = (page: Page, login = false) =>
  page.getByRole('button', {
    name: login ? '学校Googleでログイン' : '学校Googleで登録',
    exact: true,
  });
const enrollment = (page: Page) =>
  page.getByRole('region', { name: '入学年度と卒業予定年度', exact: true });
const fictional = (info: TestInfo, kind: string) =>
  'fictional-ordinary-' +
  kind +
  '-' +
  info.project.name.replace(/[^a-z0-9-]/gi, '-') +
  '-' +
  Date.now().toString(36);
async function fillYears(page: Page) {
  await admission(page).fill('2026');
  await graduation(page).fill('2028');
}
async function signup(page: Page) {
  await page.goto('/signup');
  await expect(admission(page)).toBeEditable();
  await expect(graduation(page)).toBeEditable();
}
function starts(page: Page) {
  const calls: { path: string; body: unknown }[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && ['/api/auth/register', '/api/auth/start'].includes(path))
      calls.push({ path, body: request.postData() ? JSON.parse(request.postData()!) : null });
  });
  return calls;
}
async function privateYears(page: Page) {
  const response = await page.context().request.get(ORIGIN + '/api/private/enrollment');
  expect(response.status()).toBe(200);
  return response.json();
}
async function signedOutAccount(page: Page, failed = false) {
  await expect(page).toHaveURL(ORIGIN + '/account' + (failed ? '#authentication-failed' : ''));
  if (failed)
    await expect(page.getByRole('alert')).toHaveText(
      'ログイン・登録を完了できませんでした。もう一度やり直してください。',
    );
  await expect(
    page.getByText('現在ログインしていません。アカウント情報を開くにはログインが必要です。', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(enrollment(page)).toHaveCount(0);
}
async function fakeGoogle(page: Page, actor: string, denied = false, legacyFragment = false) {
  const visits: string[] = [];
  await page.route(googleAuthorization, async (route) => {
    const url = new URL(route.request().url());
    visits.push(url.pathname);
    expect(url.searchParams.get('response_mode')).toBe('form_post');
    expect(url.searchParams.get('redirect_uri')).toBe(ORIGIN + '/api/auth/callback');
    const state = url.searchParams.get('state')!,
      nonce = url.searchParams.get('nonce')!;
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    if (!denied) {
      const token = await page
        .context()
        .request.get(ORIGIN + '/__control/token?' + new URLSearchParams({ state, nonce, actor }));
      expect(token.status()).toBe(200);
    }
    const fields = {
      state,
      ...(denied ? { error: 'access_denied' } : { code: state }),
      iss: 'https://accounts.google.com',
      provider_extra: 'discarded-provider-metadata',
    };
    if (legacyFragment) {
      await route.fulfill({
        status: 302,
        headers: {
          Location: ORIGIN + '/api/auth/callback#' + new URLSearchParams(fields),
          'Cache-Control': 'no-store',
        },
        body: '',
      });
    } else await fulfillGoogleFormPost(route, ORIGIN, fields);
  });
  return visits;
}

test('ordinary signup requires two blank private years and confirms persisted data after one Google interaction', async ({
  page,
  context,
}, info) => {
  const callbackPosts: {
    path: string;
    search: string;
    providerOrigin: string | undefined;
    originalCookies: boolean;
    fields: string[];
  }[] = [];
  const completionGets: { search: string; browser: boolean; oauth: boolean }[] = [];
  const handoffRedirects: string[] = [];
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/api/auth/callback')
      handoffRedirects.push(response.headers()['location']);
  });
  const observedRequests: Promise<void>[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/auth/callback' && request.method() === 'POST') {
      observedRequests.push(
        (async () => {
          const headers = await request.allHeaders();
          callbackPosts.push({
            path: url.pathname,
            search: url.search,
            providerOrigin: headers.origin,
            originalCookies: /__Host-kobe-(?:browser|oauth)=/.test(headers.cookie ?? ''),
            fields: [...new URLSearchParams(request.postData() ?? '').keys()].sort(),
          });
        })(),
      );
    }
    if (url.pathname === '/api/auth/callback/complete' && request.method() === 'GET') {
      observedRequests.push(
        (async () => {
          const headers = await request.allHeaders();
          completionGets.push({
            search: url.search,
            browser: (headers.cookie ?? '').includes('__Host-kobe-browser='),
            oauth: (headers.cookie ?? '').includes('__Host-kobe-oauth='),
          });
        })(),
      );
    }
  });
  const calls = starts(page),
    visits = await fakeGoogle(page, fictional(info, 'signup'));
  const initial = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/private/session' && response.status() === 401,
  );
  await signup(page);
  await initial;
  await expect(
    page.getByRole('heading', { name: '学生として登録する', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.account-entry input')).toHaveCount(2);
  await expect(admission(page)).toHaveValue('');
  await expect(graduation(page)).toHaveValue('');
  await expect(admission(page)).toHaveAttribute('required', '');
  await expect(graduation(page)).toHaveAttribute('required', '');
  await expect(google(page)).toBeDisabled();
  await admission(page).fill('2026');
  await graduation(page).fill('2025');
  await expect(google(page)).toBeDisabled();
  await expect(
    page.getByText('卒業予定年度は入学年度と同じか、それより後にしてください。', { exact: true }),
  ).toBeVisible();
  await graduation(page).fill('2028');
  expect(calls).toEqual([]);
  await google(page).click();
  await expect(page).toHaveURL(ORIGIN + '/account');
  await expect(admission(page)).toHaveValue('2026');
  await expect(graduation(page)).toHaveValue('2028');
  expect(visits).toHaveLength(1);
  await Promise.all(observedRequests);
  expect(callbackPosts).toEqual([
    {
      path: '/api/auth/callback',
      search: '',
      providerOrigin: 'https://accounts.google.com',
      originalCookies: false,
      fields: ['code', 'iss', 'provider_extra', 'state'],
    },
  ]);
  expect(completionGets).toEqual([{ search: '', browser: true, oauth: true }]);
  expect(handoffRedirects).toEqual([ORIGIN + '/api/auth/callback/complete#']);
  expect(calls).toEqual([
    { path: '/api/auth/register', body: { admissionYear: 2026, graduationYear: 2028 } },
  ]);
  expect(await privateYears(page)).toMatchObject({
    enrollment: { admissionYear: 2026, graduationYear: 2028, version: 1 },
  });
  const profile = await context.request.get(ORIGIN + '/api/private/profile');
  expect(profile.status()).toBe(200);
  expect(await profile.json()).toEqual({ profile: null });
  const catalog = await context.request.get(ORIGIN + '/api/catalog');
  expect(catalog.status()).toBe(200);
  const publicBody = await catalog.text();
  for (const field of [
    'admissionYear',
    'graduationYear',
    'owner_account_id',
    'google_subject',
    '@st.kobedenshi.ac.jp',
  ])
    expect(publicBody).not.toContain(field);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.evaluate(() => document.cookie)).not.toContain('__Host-kobe-');
  for (const name of [
    '__Host-kobe-browser',
    '__Host-kobe-oauth',
    '__Host-kobe-oauth-return',
    '__Host-kobe-session',
  ]) {
    const cookie = (await context.cookies()).find((candidate) => candidate.name === name);
    expect(
      cookie && {
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
        path: cookie.path,
      },
    ).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
    });
  }
  await page.reload();
  await expect(admission(page)).toHaveValue('2026');
  await expect(graduation(page)).toHaveValue('2028');
  expect(calls).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: info.outputPath('ordinary-signup-account.png'),
    fullPage: true,
    scale: 'css',
  });
});

test('ordinary A/B login sends no years or registration call and an unknown login remains signed out', async ({
  page,
  context,
}, info) => {
  const calls = starts(page);
  for (const actor of [A, B, fictional(info, 'unknown-login')]) {
    await context.clearCookies();
    const visits = await fakeGoogle(page, actor);
    await page.goto('/login');
    await expect(google(page, true)).toBeEnabled();
    await expect(page.locator('.account-entry input')).toHaveCount(0);
    await google(page, true).click();
    await expect(page).toHaveURL(
      ORIGIN + '/account' + (actor === A || actor === B ? '' : '#authentication-failed'),
    );
    expect(visits).toHaveLength(1);
    const response = await context.request.get(ORIGIN + '/fixture/private');
    if (actor === A || actor === B) {
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({ actor });
      await expect(enrollment(page)).toBeVisible();
    } else {
      expect(response.status()).toBe(401);
      await signedOutAccount(page, true);
    }
    await page.unroute(googleAuthorization);
  }
  expect(calls).toEqual(Array.from({ length: 3 }, () => ({ path: '/api/auth/start', body: null })));
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  // Actual-D1 unit evidence establishes account-row absence; this browser check observes no registration request/session.
});

test('provider denial lands on a clean signed-out account page without success or private state', async ({
  page,
  context,
}, info) => {
  const calls = starts(page),
    visits = await fakeGoogle(page, fictional(info, 'denied'), true);
  await signup(page);
  await fillYears(page);
  await google(page).click();
  await signedOutAccount(page, true);
  expect(visits).toHaveLength(1);
  expect(calls).toHaveLength(1);
  expect(new URL(page.url()).search).toBe('');
  expect(new URL(page.url()).hash).toBe('#authentication-failed');
  expect((await context.cookies()).some((cookie) => cookie.name === '__Host-kobe-session')).toBe(
    false,
  );
  expect((await context.request.get(ORIGIN + '/api/private/enrollment')).status()).toBe(401);
  await expect(page.getByRole('link', { name: 'ログインする', exact: true })).toBeVisible();
});

test('fragment receiver clears its URL before POST and never automatically retries after pagehide', async ({
  page,
}, info) => {
  let posts = 0;
  let enter!: () => void, release!: () => void, finish!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route('**/api/auth/callback', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posts++;
    enter();
    await released;
    try {
      await route.continue();
    } catch {
      /* The real receiver's abort may already have cancelled the request. */
    } finally {
      finish();
    }
  });
  await fakeGoogle(page, fictional(info, 'receiver-hidden'), false, true);
  await signup(page);
  await fillYears(page);
  try {
    await google(page).click();
    await entered;
    expect(page.url()).toBe(ORIGIN + '/api/auth/callback');
    expect(await page.evaluate(() => [location.search, location.hash])).toEqual(['', '']);
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
      window.dispatchEvent(new PageTransitionEvent('pageshow'));
    });
    await expect(page.getByRole('status')).toHaveText(
      'ログインを確認できませんでした。アカウント画面からやり直してください。',
    );
    release();
    await finished;
    expect(posts).toBe(1);
    await page.reload();
    await expect(page.getByRole('status')).toHaveText(
      'ログインを確認できませんでした。アカウント画面からやり直してください。',
    );
    expect(posts).toBe(1);
    expect(page.url()).toBe(ORIGIN + '/api/auth/callback');
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  } finally {
    release();
  }
});

test('a lost start acknowledgement retains input and requires status readback before an explicit new start', async ({
  page,
}) => {
  const calls = starts(page);
  let providerVisits = 0;
  await page.route(/^https:\/\/accounts\.google\.com\//, async (route) => {
    providerVisits++;
    await route.abort();
  });
  await page.route(registerPath, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.fulfill({
      response,
      status: 503,
      contentType: 'application/json',
      body: '{"error":"synthetic_lost_start_ack"}',
    });
  });
  await signup(page);
  await fillYears(page);
  await google(page).click();
  await expect(page.getByRole('button', { name: '登録状態を確認', exact: true })).toBeVisible();
  await expect(admission(page)).toHaveValue('2026');
  await expect(graduation(page)).toHaveValue('2028');
  await expect(admission(page)).not.toBeEditable();
  await expect(google(page)).toBeDisabled();
  expect(calls).toHaveLength(1);
  expect(providerVisits).toBe(0);
  await page.getByRole('button', { name: '登録状態を確認', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '入力を確認してやり直す', exact: true }),
  ).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(providerVisits).toBe(0);
  await page.getByRole('button', { name: '入力を確認してやり直す', exact: true }).click();
  await expect(admission(page)).toBeEditable();
  await expect(graduation(page)).toHaveValue('2028');
  await expect(google(page)).toBeEnabled();
  expect(calls).toHaveLength(1);
  expect(providerVisits).toBe(0);
  expect(page.url()).toBe(ORIGIN + '/signup');
});

test('duplicate clicks and a late cancelled start never navigate or automatically send another start', async ({
  page,
}) => {
  const calls = starts(page);
  let providerVisits = 0;
  await page.route(/^https:\/\/accounts\.google\.com\//, async (route) => {
    providerVisits++;
    await route.abort();
  });
  let entered!: () => void, release!: () => void, finished!: () => void;
  const held = new Promise<void>((resolve) => {
      entered = resolve;
    }),
    released = new Promise<void>((resolve) => {
      release = resolve;
    }),
    settled = new Promise<void>((resolve) => {
      finished = resolve;
    });
  await page.route(registerPath, async (route) => {
    try {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      entered();
      await released;
      try {
        await route.fulfill({ response });
      } catch {
        /* The browser may already have cancelled this intercepted response. */
      }
    } finally {
      finished();
    }
  });
  try {
    await signup(page);
    await fillYears(page);
    await google(page).evaluate((element) => {
      (element as HTMLButtonElement).click();
      (element as HTMLButtonElement).click();
    });
    await held;
    expect(calls).toHaveLength(1);
    const failed = page.waitForEvent(
      'requestfailed',
      (request) => new URL(request.url()).pathname === '/api/auth/register',
    );
    await page.getByRole('button', { name: '通信を中止', exact: true }).click();
    await expect(page.getByRole('button', { name: '登録状態を確認', exact: true })).toBeVisible();
    release();
    await Promise.all([failed, settled]);
    expect(page.url()).toBe(ORIGIN + '/signup');
    expect(providerVisits).toBe(0);
    expect(calls).toHaveLength(1);
    await expect(admission(page)).toHaveValue('2026');
    await expect(graduation(page)).toHaveValue('2028');
    await expect(admission(page)).not.toBeEditable();
    await expect(google(page)).toBeDisabled();
  } finally {
    release();
  }
});

test('signup and account confirmation work after an initial catalog failure in the actual application', async ({
  page,
}, info) => {
  const visits = await fakeGoogle(page, fictional(info, 'catalog-failure'));
  await page.route('**/api/articles', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"synthetic_catalog_failure"}',
    }),
  );
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '記事一覧を表示できませんでした', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: 'メイン' })
    .getByRole('link', { name: 'アカウント', exact: true })
    .click();
  await signedOutAccount(page);
  await page.getByRole('link', { name: '初めての方は学生として登録する', exact: true }).click();
  await expect(admission(page)).toBeEditable();
  await fillYears(page);
  await google(page).click();
  await expect(page).toHaveURL(ORIGIN + '/account');
  await expect(admission(page)).toHaveValue('2026');
  await expect(graduation(page)).toHaveValue('2028');
  expect(visits).toHaveLength(1);
  await expect(
    page.getByRole('heading', { name: '記事・作品を読み込めませんでした', exact: true }),
  ).toHaveCount(0);
});

test('unknown start recovers a session completed in another tab by readback without a second Google start', async ({
  page,
  context,
}, info) => {
  const calls = starts(page),
    initialVisits = await fakeGoogle(page, fictional(info, 'unused'));
  let authorizationUrl = '';
  await page.route(registerPath, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    authorizationUrl = (await response.json()).authorizationUrl;
    await route.fulfill({
      response,
      status: 503,
      contentType: 'application/json',
      body: '{"error":"synthetic_lost_start_ack"}',
    });
  });
  await signup(page);
  await fillYears(page);
  await google(page).click();
  await expect(page.getByRole('button', { name: '登録状態を確認', exact: true })).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(initialVisits).toHaveLength(0);
  expect(authorizationUrl).not.toBe('');
  const other = await context.newPage();
  const completedVisits = await fakeGoogle(other, fictional(info, 'readback'));
  try {
    await other.goto(authorizationUrl);
    await expect(other).toHaveURL(ORIGIN + '/account');
    await expect(admission(other)).toHaveValue('2026');
    await expect(graduation(other)).toHaveValue('2028');
  } finally {
    await other.close();
  }
  await page.bringToFront();
  await page.getByRole('button', { name: '登録状態を確認', exact: true }).click();
  await expect(page).toHaveURL(ORIGIN + '/account');
  await expect(admission(page)).toHaveValue('2026');
  await expect(graduation(page)).toHaveValue('2028');
  expect(calls).toHaveLength(1);
  expect(initialVisits).toHaveLength(0);
  expect(completedVisits).toHaveLength(1);
  expect(await privateYears(page)).toMatchObject({
    enrollment: { version: 1, admissionYear: 2026, graduationYear: 2028 },
  });
});
