import {
  test,
  expect,
  type BrowserContext,
  type Page,
  type Route,
  type TestInfo,
} from '@playwright/test';

const ORIGIN = 'https://127.0.0.1:8790';
const A = 'fictional-browser-a',
  B = 'fictional-browser-b';
const googleAuthorization = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;
const admission = (page: Page) => page.getByLabel('入学年度 必須', { exact: true });
const graduation = (page: Page) => page.getByLabel('卒業予定年度 必須', { exact: true });
const google = (page: Page, login = false) =>
  page.getByRole('button', {
    name: login ? '学校Googleでログイン' : '学校Googleで登録',
    exact: true,
  });
const privatePanel = (page: Page) => page.locator('.session-private');
const accountCheck = (page: Page) =>
  page.getByRole('button', { name: 'ログイン状態を確認', exact: true });
const continueAccount = (page: Page) =>
  page.getByRole('button', { name: '確認したアカウントを開く', exact: true });
const registrationCheck = (page: Page) =>
  page.getByRole('button', { name: '登録状態を確認', exact: true });
const fictional = (info: TestInfo) =>
  'fictional-independent-' + info.project.name + '-' + Date.now().toString(36);
function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function starts(page: Page) {
  const calls: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && ['/api/auth/start', '/api/auth/register'].includes(path))
      calls.push(path);
  });
  return calls;
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(name + '.png'), fullPage: true, scale: 'css' });
}
async function fakeGoogle(page: Page, actor: string) {
  await page.route(googleAuthorization, async (route) => {
    const authorization = new URL(route.request().url()),
      state = authorization.searchParams.get('state')!,
      nonce = authorization.searchParams.get('nonce')!;
    expect(authorization.searchParams.get('response_mode')).toBe('fragment');
    expect(authorization.searchParams.get('redirect_uri')).toBe(ORIGIN + '/api/auth/callback');
    expect(
      (
        await page
          .context()
          .request.get(ORIGIN + '/__control/token?' + new URLSearchParams({ state, nonce, actor }))
      ).status(),
    ).toBe(200);
    await route.fulfill({
      status: 302,
      headers: {
        Location: ORIGIN + '/api/auth/callback#' + new URLSearchParams({ state, code: state }),
        'Cache-Control': 'no-store',
      },
      body: '',
    });
  });
}
async function signIn(page: Page, actor: string, info?: TestInfo) {
  await fakeGoogle(page, actor);
  await page.goto('/login');
  await expect(google(page, true)).toBeEnabled();
  if (info) await screenshot(page, info, 'independent-login');
  await google(page, true).click();
  await expect(page).toHaveURL(ORIGIN + '/account');
  await expect(admission(page)).toBeEditable();
  await page.unroute(googleAuthorization);
}
// Real fixture HTTP changes the cookie without giving the observed page a focus/pageshow event.
// Proofs stay in this call's memory and are never returned, stored, or included in assertions.
async function replaceSession(context: BrowserContext, actor: string) {
  const headers = { Origin: ORIGIN };
  const boot = await context.request.post(ORIGIN + '/api/auth/bootstrap', { headers });
  expect([204, 409]).toContain(boot.status());
  const command = await context.request.post(ORIGIN + '/api/auth/command?action=login', {
    headers,
  });
  expect(command.status()).toBe(200);
  const proof = await command.json();
  const started = await context.request.post(ORIGIN + '/api/auth/start', {
    headers: { ...headers, Authorization: 'Bearer command.' + proof.commandToken },
  });
  expect(started.status()).toBe(200);
  const authorization = new URL((await started.json()).authorizationUrl),
    state = authorization.searchParams.get('state')!,
    nonce = authorization.searchParams.get('nonce')!;
  expect(
    (
      await context.request.get(
        ORIGIN + '/__control/token?' + new URLSearchParams({ state, nonce, actor }),
      )
    ).status(),
  ).toBe(200);
  expect(
    (
      await context.request.post(ORIGIN + '/api/auth/callback', {
        headers: { Origin: ORIGIN },
        form: { state, code: state },
        maxRedirects: 0,
      })
    ).status(),
  ).toBe(303);
  const confirmed = await context.request.get(ORIGIN + '/fixture/private');
  expect(confirmed.status()).toBe(200);
  expect((await confirmed.json()).actor).toBe(actor);
}

test('account pagehide conceals unsaved years immediately and a failed check recovers the same in-memory buffer', async ({
  page,
}, info) => {
  await signIn(page, A, info);
  const saved = {
    admission: await admission(page).inputValue(),
    graduation: await graduation(page).inputValue(),
  };
  let enrollmentReads = 0,
    writes = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/private/enrollment') {
      if (request.method() === 'GET') enrollmentReads++;
      else writes++;
    }
  });
  await admission(page).fill('2091');
  await graduation(page).fill('2092');
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })),
  );
  await expect(privatePanel(page)).toBeHidden();
  await expect(privatePanel(page)).toHaveAttribute('inert', '');
  await expect(admission(page)).toBeHidden();
  await expect(admission(page)).toHaveValue('2091');
  const unavailable = async (route: Route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"synthetic_session_unavailable"}',
    });
  await page.route('**/api/private/session', unavailable);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  );
  await expect(
    page.getByText(
      'セッションを確認できませんでした。このページの入力をメモリ内に保持したまま隠しています。再確認できるまで年度やアカウントの操作はできません。',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(privatePanel(page)).toBeHidden();
  await expect(continueAccount(page)).toHaveCount(0);
  await screenshot(page, info, 'independent-account-unknown');
  await page.unroute('**/api/private/session', unavailable);
  await accountCheck(page).click();
  await expect(admission(page)).toBeVisible();
  await expect(admission(page)).toHaveValue('2091');
  await expect(graduation(page)).toHaveValue('2092');
  await expect(
    page.getByText('同じセッションを確認しました。手元の年度の入力を保持して再開しています。', {
      exact: true,
    }),
  ).toBeVisible();
  expect(enrollmentReads).toBe(0);
  expect(writes).toBe(0);
  const persisted = await page.context().request.get(ORIGIN + '/api/private/enrollment');
  expect(persisted.status()).toBe(200);
  expect((await persisted.json()).enrollment).toMatchObject({
    admissionYear: Number(saved.admission),
    graduationYear: Number(saved.graduation),
  });
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test('a changed account destroys the old buffer and rechecks a changed continuation candidate before opening private data', async ({
  page,
  context,
}) => {
  await signIn(page, A);
  await admission(page).fill('2091');
  await graduation(page).fill('2092');
  const other = await context.newPage();
  try {
    await other.goto('/account');
    await expect(
      other.getByRole('button', { name: 'このブラウザをログアウト', exact: true }),
    ).toBeEnabled();
    other.once('dialog', (dialog) => dialog.accept());
    await other.getByRole('button', { name: 'このブラウザをログアウト', exact: true }).click();
    await expect(other.getByRole('link', { name: 'ログインする', exact: true })).toBeVisible();
    await signIn(other, B);
  } finally {
    await other.close();
  }
  await page.bringToFront();
  await accountCheck(page).click();
  await expect(continueAccount(page)).toBeVisible();
  await expect(privatePanel(page)).toBeHidden();
  await expect(admission(page)).toHaveCount(0);
  let enrollmentReads = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/private/enrollment') enrollmentReads++;
  });
  await replaceSession(context, A);
  await continueAccount(page).click();
  await expect(
    page.getByText(
      '確認後にセッションが変わりました。アカウント情報は開かず、改めて続行の確認を待っています。',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(privatePanel(page)).toBeHidden();
  await expect(admission(page)).toHaveCount(0);
  expect(enrollmentReads).toBe(0);
  await continueAccount(page).click();
  await expect(admission(page)).toBeEditable();
  await expect(admission(page)).not.toHaveValue('2091');
  await expect(graduation(page)).not.toHaveValue('2092');
  expect(enrollmentReads).toBe(1);
  const persisted = await context.request.get(ORIGIN + '/api/private/enrollment');
  expect(persisted.status()).toBe(200);
  const years = (await persisted.json()).enrollment;
  await expect(admission(page)).toHaveValue(String(years.admissionYear));
  await expect(graduation(page)).toHaveValue(String(years.graduationYear));
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

for (const returnKind of ['cancel', 'pageshow'] as const)
  test(
    'Google navigation ' +
      returnKind +
      ' leaves a status-check path and never restarts authentication automatically',
    async ({ page }, info) => {
      const calls = starts(page);
      let visits = 0;
      // Abort the local provider navigation as a browser cancellation. This keeps the
      // original document, while allowing Playwright to settle its navigation barrier.
      await page.route(googleAuthorization, async (route) => {
        visits++;
        await route.abort('aborted');
      });
      await page.goto('/signup');
      await expect(admission(page)).toBeEditable();
      await admission(page).fill('2026');
      await graduation(page).fill('2028');
      const interrupted = page.waitForEvent('requestfailed', (request) =>
        googleAuthorization.test(request.url()),
      );
      await google(page).click();
      await interrupted;
      await expect(
        page.getByRole('button', { name: 'Googleへの移動を中止', exact: true }),
      ).toBeVisible();
      if (returnKind === 'cancel')
        await page.getByRole('button', { name: 'Googleへの移動を中止', exact: true }).click();
      await page.evaluate(() =>
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
      );
      await expect(registrationCheck(page)).toBeEnabled();
      await expect(admission(page)).toHaveValue('2026');
      await expect(graduation(page)).toHaveValue('2028');
      await expect(admission(page)).not.toBeEditable();
      await expect(google(page)).toBeDisabled();
      expect(calls).toEqual(['/api/auth/register']);
      expect(visits).toBe(1);
      await registrationCheck(page).click();
      await expect(
        page.getByRole('button', { name: '入力を確認してやり直す', exact: true }),
      ).toBeEnabled();
      expect(calls).toHaveLength(1);
      expect(visits).toBe(1);
      await page.getByRole('button', { name: '入力を確認してやり直す', exact: true }).click();
      await expect(admission(page)).toBeEditable();
      await expect(google(page)).toBeEnabled();
      expect(calls).toHaveLength(1);
      expect(visits).toBe(1);
      if (returnKind === 'cancel') {
        await page
          .getByRole('navigation', { name: 'メイン' })
          .getByRole('link', { name: 'アカウント', exact: true })
          .click();
        await expect(
          page.getByText('現在ログインしていません。アカウント情報を開くにはログインが必要です。', {
            exact: true,
          }),
        ).toBeVisible();
        await screenshot(page, info, 'independent-signed-out');
      }
    },
  );

test('browser back from the intercepted Google page restores a usable signup without another auth start', async ({
  page,
}) => {
  const calls = starts(page);
  let visits = 0;
  await page.route(googleAuthorization, async (route) => {
    visits++;
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      headers: { 'Cache-Control': 'no-store' },
      body: '<!doctype html><html lang="en"><title>Fictional local provider</title><p>Local provider navigation fixture. Use browser back to cancel.</p></html>',
    });
  });
  await page.goto('/signup');
  await expect(admission(page)).toBeEditable();
  await admission(page).fill('2026');
  await graduation(page).fill('2028');
  await google(page).click();
  await expect(page).toHaveTitle('Fictional local provider');
  await page.goBack();
  await expect(page).toHaveURL(ORIGIN + '/signup');
  await expect(
    page.getByRole('heading', { name: '学生として登録する', exact: true }),
  ).toBeVisible();
  // A fresh document checks signed-out state; a restored document requires explicit readback.
  await expect
    .poll(
      async () =>
        (await admission(page).isEditable()) || (await registrationCheck(page).isVisible()),
    )
    .toBe(true);
  if (await registrationCheck(page).isVisible()) {
    await registrationCheck(page).click();
    await page.getByRole('button', { name: '入力を確認してやり直す', exact: true }).click();
  }
  await expect(admission(page)).toBeEditable();
  await admission(page).fill('2026');
  await graduation(page).fill('2028');
  await expect(google(page)).toBeEnabled();
  expect(calls).toEqual(['/api/auth/register']);
  expect(visits).toBe(1);
  expect((await page.context().request.get(ORIGIN + '/api/private/enrollment')).status()).toBe(401);
});

test('registration inspection withholds private years until the final proof and rejects a session changed at EOF', async ({
  page,
  context,
}, info) => {
  await fakeGoogle(page, fictional(info));
  await page.goto('/signup');
  await expect(admission(page)).toBeEditable();
  await admission(page).fill('2026');
  await graduation(page).fill('2028');
  await google(page).click();
  await expect(page).toHaveURL(ORIGIN + '/account');
  await expect(admission(page)).toHaveValue('2026');
  await page.unroute(googleAuthorization);
  const entered = latch(),
    released = latch(),
    finished = latch();
  let enrollmentSent = false,
    checksAfterEnrollment = 0;
  await page.route('**/api/private/enrollment', async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    enrollmentSent = true;
    await route.fulfill({ response });
  });
  await page.route('**/api/private/session', async (route) => {
    if (enrollmentSent && ++checksAfterEnrollment === 2) {
      entered.resolve();
      await released.promise;
      try {
        await route.continue();
      } finally {
        finished.resolve();
      }
    } else await route.continue();
  });
  try {
    await page.goto('/signup');
    await entered.promise;
    expect(checksAfterEnrollment).toBe(2);
    expect(page.url()).toBe(ORIGIN + '/signup');
    await expect(admission(page)).toHaveValue('');
    await expect(graduation(page)).toHaveValue('');
    await expect(page.locator('.account-enrollment')).toHaveCount(0);
    await replaceSession(context, B);
    released.resolve();
    await finished.promise;
    await expect(registrationCheck(page)).toBeEnabled();
    expect(page.url()).toBe(ORIGIN + '/signup');
    await expect(page.locator('.account-enrollment')).toHaveCount(0);
    await expect(admission(page)).toHaveValue('');
    await expect(graduation(page)).toHaveValue('');
    await expect(google(page)).toBeDisabled();
    await page.unroute('**/api/private/enrollment');
    await page.unroute('**/api/private/session');
    await registrationCheck(page).click();
    await expect(page).toHaveURL(ORIGIN + '/account');
    await expect(admission(page)).toBeEditable();
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  } finally {
    released.resolve();
  }
});
