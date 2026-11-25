import { completeGoogleFormPost } from './helpers/google-form-post';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';

const ORIGIN = 'https://127.0.0.1:8790';

// #272: React 19 holds a Suspense boundary's content for ~300 ms once its fallback shows, so a
// private screen whose chunk was fetched on click replaced the whole body with one line and then
// waited. The header menus fetch the screens they lead to when reached for, so choosing an item
// goes straight to the screen (its own session check and placeholder are unchanged).
async function signUp(context: BrowserContext, name: string) {
  const headers = { Origin: ORIGIN };
  expect((await context.request.post('/api/auth/bootstrap', { headers })).status()).toBe(204);
  const command = await context.request.post('/api/auth/command?action=self-registration', {
    headers,
  });
  const { commandToken } = await command.json();
  const start = await context.request.post('/api/auth/register', {
    headers: { ...headers, Authorization: 'Bearer command.' + commandToken },
    data: { admissionYear: 2026, graduationYear: 2028 },
  });
  expect(start.status()).toBe(200);
  const authorization = new URL((await start.json()).authorizationUrl);
  const state = authorization.searchParams.get('state')!;
  const nonce = authorization.searchParams.get('nonce')!;
  expect(
    (
      await context.request.get(
        '/__control/token?' +
          new URLSearchParams({ state, nonce, actor: 'fictional-preload-' + crypto.randomUUID() }),
      )
    ).status(),
  ).toBe(200);
  expect(
    (await completeGoogleFormPost(context.request, ORIGIN, { state, code: state })).status(),
  ).toBe(303);
  const { csrfToken } = await (await context.request.get('/api/private/session')).json();
  const profile = await context.request.post('/api/private/profile', {
    headers: { ...headers, Authorization: 'Bearer csrf.' + csrfToken },
    data: { displayName: name, department: '', yearLabel: '', bio: '', confirmPublic: true },
  });
  expect(profile.status()).toBe(201);
}

/** Records every route-level Suspense fallback that appears from now on. */
async function watchFallbacks(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __fallbacks: string[] }).__fallbacks = seen;
    new MutationObserver(() => {
      for (const node of document.querySelectorAll('main > p.shell.empty[role="status"]'))
        if (!seen.includes(node.textContent ?? '')) seen.push(node.textContent ?? '');
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}
const fallbacks = (page: Page) =>
  page.evaluate(() => (window as unknown as { __fallbacks: string[] }).__fallbacks);

async function choose(page: Page, item: string) {
  await page.getByRole('button', { name: 'アカウントメニュー' }).click();
  const link = page.getByRole('menuitem', { name: item });
  await expect(link).toBeVisible();
  // The click itself must not race the chunk: the menu hint has to have fetched it already.
  await page.waitForTimeout(300);
  await link.click();
}

test('header menu opens private screens without the loading fallback', async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    ...info.project.use,
    baseURL: ORIGIN,
    ignoreHTTPSErrors: true,
  });
  try {
    await signUp(context, '先読み 花子');
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'アカウントメニュー' })).toBeVisible();
    await watchFallbacks(page);

    await choose(page, '記事の管理');
    await expect(page).toHaveURL(/\/drafts$/);
    await expect(page.locator('.editor-list-empty').first()).toBeVisible();

    await choose(page, '閲覧履歴');
    await expect(page).toHaveURL(/\/history$/);
    await expect(page.getByRole('region', { name: '自分の閲覧履歴' })).toBeVisible();

    await choose(page, 'マイページ');
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.locator('.session-private')).toBeVisible();

    expect(await fallbacks(page)).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  } finally {
    await context.close();
  }
});
