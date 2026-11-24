import { completeGoogleFormPost } from './helpers/google-form-post';
import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';

const ORIGIN = 'https://127.0.0.1:8790';

// #272: every reading screen keeps the same placeholder while its read is in flight, instead of a
// bare sentence that collapses the page. Reads are held with a route gate, never faked.
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
          new URLSearchParams({ state, nonce, actor: 'fictional-skeleton-' + crypto.randomUUID() }),
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

/** Holds matching GET reads until `open()`; other requests pass straight through. */
async function gate(page: Page, match: (url: URL) => boolean) {
  const held: Route[] = [];
  let closed = true;
  await page.route(
    (url) => match(url),
    (route) => {
      if (closed && route.request().method() === 'GET') held.push(route);
      else void route.continue();
    },
  );
  return {
    waitHeld: () => expect.poll(() => held.length).toBeGreaterThan(0),
    open: async () => {
      closed = false;
      for (const route of held.splice(0)) await route.continue();
    },
  };
}

async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

// PC (1280) and mobile (390) come from the account-desktop and account-mobile projects.
test('reading screens hold their place while loading', async ({ browser }, info) => {
  const context = await browser.newContext({
    ...info.project.use,
    baseURL: ORIGIN,
    ignoreHTTPSErrors: true,
  });
  try {
    const page = await context.newPage();

    // Public works list: card-shaped placeholders announced once by name.
    let reads = await gate(page, (url) => url.pathname === '/api/projects');
    await page.goto('/works');
    await reads.waitHeld();
    const works = page.getByRole('status', { name: '作品を読み込んでいます…' });
    await expect(works).toBeVisible();
    await expect(works.locator('.skeleton-card')).toHaveCount(3);
    await noSideways(page);
    await reads.open();
    await expect(works).toHaveCount(0);
    await page.unrouteAll();

    // Search: the count line already says what is loading, so the placeholder stays silent.
    reads = await gate(page, (url) => url.pathname === '/api/articles');
    await page.goto('/search?q=' + encodeURIComponent('架空'));
    await reads.waitHeld();
    await expect(page.locator('.search-result-count')).toContainText('記事：読み込み中');
    const searching = page.locator('.community-search [data-skeleton="cards"]');
    await expect(searching).toBeVisible();
    await expect(searching).toHaveAttribute('aria-hidden', 'true');
    await noSideways(page);
    await reads.open();
    await expect(searching).toHaveCount(0);
    await page.unrouteAll();

    await signUp(context, '架空の読み込み確認');

    // Session check: the private panel stays hidden and a neutral placeholder holds its place.
    reads = await gate(page, (url) => url.pathname === '/api/private/session');
    await page.goto('/history');
    await reads.waitHeld();
    const checking = page.locator('.session-skeleton');
    await expect(checking).toBeVisible();
    await expect(page.locator('.session-private')).toBeHidden();
    await noSideways(page);
    await reads.open();
    await expect(checking).toHaveCount(0);
    await page.unrouteAll();

    // History, after the session is confirmed: list rows announced by name.
    reads = await gate(page, (url) => url.pathname === '/api/private/reading-history');
    await page.reload();
    await reads.waitHeld();
    const history = page.getByRole('status', { name: '履歴を読み込んでいます…' });
    await expect(history).toBeVisible();
    await expect(history.locator('.skeleton-row')).toHaveCount(3);
    await reads.open();
    await expect(history).toHaveCount(0);
    await expect(page.getByText('閲覧履歴はまだありません。')).toBeVisible();
    await page.unrouteAll();

    // Drafts list: rows hold the list's place, and 「まだありません」 waits for the answer.
    reads = await gate(page, (url) => url.pathname === '/api/private/drafts');
    await page.goto('/drafts');
    await reads.waitHeld();
    const drafts = page.locator('.editor-manage-drafts [data-skeleton="rows"]');
    await expect(drafts).toBeVisible();
    await expect(page.getByText('保存した下書きはまだありません。')).toHaveCount(0);
    await noSideways(page);
    await reads.open();
    await expect(drafts).toHaveCount(0);
    await expect(page.getByText('保存した下書きはまだありません。')).toBeVisible();
  } finally {
    await context.close();
  }
});
