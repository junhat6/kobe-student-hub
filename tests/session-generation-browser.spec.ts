import { fulfillGoogleFormPost } from './helpers/google-form-post';
import { readFileSync } from 'node:fs';
import { test, expect, type Page, type Route } from '@playwright/test';
const A = 'fictional-browser-a',
  B = 'fictional-browser-b';
async function call(p: Page, path: string, method = 'GET', headers: Record<string, string> = {}) {
  return p.evaluate(
    async ({ path, method, headers }) => {
      const r = await fetch(path, { method, headers, redirect: 'manual' });
      return { status: r.status, body: await r.text() };
    },
    { path, method, headers },
  );
}
async function bootstrap(p: Page) {
  await p.goto('/');
  expect((await call(p, '/api/auth/bootstrap', 'POST')).status).toBe(204);
}
async function start(p: Page, actor: string) {
  const proof = await call(p, '/api/auth/command?action=login', 'POST');
  expect(proof.status).toBe(200);
  const token = JSON.parse(proof.body).commandToken;
  // Consume the JSON acknowledgement inside the actual browser fetch, as the ordinary client does.
  const response = await call(p, '/api/auth/start', 'POST', {
    Authorization: 'Bearer command.' + token,
  });
  expect(response.status).toBe(200);
  const location = new URL(JSON.parse(response.body).authorizationUrl);
  expect(location.searchParams.get('response_mode')).toBe('form_post');
  const state = location.searchParams.get('state')!;
  expect(
    (
      await call(
        p,
        '/__control/token?' +
          new URLSearchParams({ state, nonce: location.searchParams.get('nonce')!, actor }),
      )
    ).status,
  ).toBe(200);
  return state;
}
async function complete(p: Page, state: string, hold?: string) {
  const provider = 'https://accounts.google.com/o/oauth2/v2/auth?fixture=form-post';
  const form = async (route: Route) =>
    fulfillGoogleFormPost(route, 'https://127.0.0.1:8790', { state, code: state });
  const intercept = async (route: Route) =>
    route.continue({
      headers: { ...(await route.request().allHeaders()), 'X-Test-Callback-Hold': hold! },
    });
  await p.route(provider, form);
  if (hold) await p.route('**/api/auth/callback/complete', intercept);
  try {
    await p.goto(provider);
    await expect(p).toHaveURL('https://127.0.0.1:8790/account');
  } finally {
    if (!p.isClosed()) {
      await p.unroute(provider, form);
      if (hold) await p.unroute('**/api/auth/callback/complete', intercept);
    }
  }
}
async function actor(p: Page, expected: string) {
  const r = await call(p, '/fixture/private');
  expect(r.status).toBe(200);
  expect(JSON.parse(r.body).actor).toBe(expected);
}
async function logout(p: Page) {
  const s = await call(p, '/api/private/session');
  const csrf = JSON.parse(s.body).csrfToken;
  expect(
    (await call(p, '/api/private/logout', 'POST', { Authorization: 'Bearer csrf.' + csrf })).status,
  ).toBe(200);
}
async function waitHeld(p: Page, tag: string) {
  await expect
    .poll(async () => JSON.parse((await call(p, '/__control/ready?tag=' + tag)).body).entered)
    .toBe(true);
}
test('real delayed A headers overwrite B cookie but private access fails closed and explicit B login recovers', async ({
  page,
  context,
}) => {
  await bootstrap(page);
  const a = await start(page, A),
    other = await context.newPage();
  await other.goto('/');
  const delayed = complete(other, a, 'late-a-' + test.info().project.name);
  await waitHeld(page, 'late-a-' + test.info().project.name);
  const b = await start(page, B);
  await complete(page, b);
  await actor(page, B);
  const bCookie = (await context.cookies()).find((c) => c.name === '__Host-kobe-session')!.value;
  await call(
    page,
    '/__control/release?' + new URLSearchParams({ tag: 'late-a-' + test.info().project.name }),
  );
  await delayed;
  expect((await context.cookies()).find((c) => c.name === '__Host-kobe-session')!.value).not.toBe(
    bCookie,
  );
  const denied = await call(page, '/fixture/private');
  expect(denied.status).toBe(401);
  expect(denied.body).not.toContain('PRIVATE-');
  expect((await call(page, '/api/private/session')).status).toBe(401);
  await complete(page, await start(page, B));
  await actor(page, B);
  const cookies = await context.cookies();
  for (const name of ['__Host-kobe-session', '__Host-kobe-browser']) {
    const c = cookies.find((c) => c.name === name);
    expect(c).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
  }
  expect(await page.evaluate(() => document.cookie)).not.toContain('__Host-kobe-');
});
test('pending A callback after logout cannot restore access; stale session command logout recovers', async ({
  page,
  context,
}) => {
  await bootstrap(page);
  await complete(page, await start(page, B));
  const a = await start(page, A),
    other = await context.newPage();
  await other.goto('/');
  const delayed = complete(other, a, 'logout-a-' + test.info().project.name);
  await waitHeld(page, 'logout-a-' + test.info().project.name);
  const proof = await call(page, '/api/private/logout-command', 'POST');
  expect(proof.status).toBe(200);
  expect(
    (
      await call(page, '/api/private/logout', 'POST', {
        Authorization: 'Bearer command.' + JSON.parse(proof.body).commandToken,
      })
    ).status,
  ).toBe(200);
  await call(
    page,
    '/__control/release?' + new URLSearchParams({ tag: 'logout-a-' + test.info().project.name }),
  );
  await delayed;
  expect((await call(page, '/fixture/private')).status).toBe(401);
  await complete(page, await start(page, B));
  await actor(page, B);
  await logout(page);
  expect((await call(page, '/fixture/private')).status).toBe(401);
});
test('browser contexts isolate devices and expired context rejects retained cookies', async ({
  page,
  browser,
}) => {
  await bootstrap(page);
  await complete(page, await start(page, A));
  const c = await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: 'https://127.0.0.1:8790',
  });
  const second = await c.newPage();
  await bootstrap(second);
  await complete(second, await start(second, B));
  await logout(page);
  await actor(second, B);
  await call(second, '/__control/expire');
  expect((await call(second, '/fixture/private')).status).toBe(401);
  expect((await call(second, '/api/auth/command?action=login', 'POST')).status).toBe(409);
  await c.close();
});

test('ordinary account stage opens authentication while authoring remains source closed', () => {
  expect(readFileSync('worker/index.ts', 'utf8')).toMatch(
    /^[\t ]*const[\t ]+OAUTH_HTTP_RELEASE_ENABLED[\t ]*=[\t ]*true[\t ]*;[\t ]*$/m,
  );
  expect(readFileSync('worker/index.ts', 'utf8')).toMatch(
    /^[\t ]*const[\t ]+ORDINARY_DRAFT_HTTP_RELEASE_ENABLED[\t ]*=[\t ]*false[\t ]*;[\t ]*$/m,
  );
});

test('existing AccountSessionLab conceals stale private UI and requires explicit continuation after real B relogin', async ({
  page,
  context,
}) => {
  await bootstrap(page);
  const a = await start(page, A),
    callbackTab = await context.newPage();
  await callbackTab.goto('/');
  const delayed = complete(callbackTab, a, 'ui-late-a-' + test.info().project.name);
  await waitHeld(page, 'ui-late-a-' + test.info().project.name);
  await complete(page, await start(page, B));
  await page.goto('/lab/account');
  await expect(page.getByRole('button', { name: '新しい下書き', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新しい下書き', exact: true }).click();
  await page.getByLabel('タイトル', { exact: true }).fill('fictional unsaved private input');
  await call(
    page,
    '/__control/release?' + new URLSearchParams({ tag: 'ui-late-a-' + test.info().project.name }),
  );
  await delayed;
  await page.getByRole('button', { name: 'セッションを再確認', exact: true }).click();
  await expect(page.locator('.session-private')).toBeHidden();
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '確認したセッションで編集を開く', exact: true }),
  ).toHaveCount(0);
  // Login is explicitly requested in another tab; the existing UI is retained throughout.
  await complete(callbackTab, await start(callbackTab, B));
  await actor(page, B);
  await page.getByRole('button', { name: 'セッションを再確認', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '確認したセッションで編集を開く', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.session-private')).toBeHidden();
  await page.getByRole('button', { name: '確認したセッションで編集を開く', exact: true }).click();
  await expect(page.getByRole('button', { name: '新しい下書き', exact: true })).toBeVisible();
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});
