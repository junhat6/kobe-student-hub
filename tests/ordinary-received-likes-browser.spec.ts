import AxeBuilder from '@axe-core/playwright';
import { completeGoogleFormPost } from './helpers/google-form-post';
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

// #222: likes on one's own public articles come back to the author on their own page, with what
// arrived since the last visit. Real D1 behind the signed-Google HTTPS fixture.
const ORIGIN = 'https://127.0.0.1:8790';
type Actor = { context: BrowserContext; csrf: string; profileId: string };

async function actor(browser: Browser, contexts: BrowserContext[], name: string): Promise<Actor> {
  const context = await browser.newContext({ baseURL: ORIGIN, ignoreHTTPSErrors: true });
  contexts.push(context);
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
  const actorId = 'fictional-received-' + crypto.randomUUID();
  expect(
    (
      await context.request.get(
        '/__control/token?' + new URLSearchParams({ state, nonce, actor: actorId }),
      )
    ).status(),
  ).toBe(200);
  const callback = await completeGoogleFormPost(context.request, ORIGIN, { state, code: state });
  expect(callback.status()).toBe(303);
  const { csrfToken } = await (await context.request.get('/api/private/session')).json();
  const profile = await context.request.post('/api/private/profile', {
    headers: { ...headers, Authorization: 'Bearer csrf.' + csrfToken },
    data: { displayName: name, department: '', yearLabel: '', bio: '', confirmPublic: true },
  });
  expect(profile.status()).toBe(201);
  return { context, csrf: csrfToken, profileId: (await profile.json()).profile.id };
}

async function article(owner: Actor, title: string) {
  const auth = { Origin: ORIGIN, Authorization: 'Bearer csrf.' + owner.csrf };
  const draft = await (
    await owner.context.request.post('/api/private/drafts', {
      headers: auth,
      data: { title, body: '## 架空の本文\n\n届いたいいねの確認に使う架空の記事です。' },
    })
  ).json();
  const published = await owner.context.request.post('/api/private/publications/' + draft.id, {
    headers: auth,
    data: {
      expectedVersion: draft.version,
      confirmPublic: true,
      summary: '届いたいいねの確認',
      tags: [],
      minutes: 1,
      audience: '',
      prerequisite: '',
      outcome: '',
    },
  });
  expect(published.status()).toBe(201);
  return (await published.json()).contentId as string;
}

async function like(liker: Actor, id: string) {
  const response = await liker.context.request.put('/api/private/article-likes/' + id, {
    headers: { Origin: ORIGIN, Authorization: 'Bearer csrf.' + liker.csrf },
    data: { liked: true, confirmPublic: true },
  });
  expect(response.status()).toBe(200);
}

const received = (page: Page) =>
  page.getByRole('region', { name: '届いたいいね（自分だけに見えます）', exact: true });

test('likes on own articles come back on the account page with what arrived since last time', async ({
  browser,
}, info) => {
  const contexts: BrowserContext[] = [];
  const key = info.project.name + '-' + Date.now().toString(36);
  const title = '届いたいいねの記事-' + key;
  try {
    const owner = await actor(browser, contexts, '架空の書き手-' + key);
    const first = await actor(browser, contexts, '架空の読者A-' + key);
    const second = await actor(browser, contexts, '架空の読者B-' + key);
    const id = await article(owner, title);
    const page = await owner.context.newPage();

    // No likes yet: nothing extra on the page (the grass is there, the likes block is not).
    await page.goto('/account');
    await expect(page.getByRole('region', { name: '草', exact: true })).toBeVisible();
    await expect(received(page)).toHaveCount(0);

    // A like arrives: the total, the article and "+1" since the previous visit.
    await like(first, id);
    await page.goto('/account');
    await expect(
      received(page).getByRole('img', { name: '届いたいいね 1、前回から +1' }),
    ).toBeVisible();
    const row = received(page).getByRole('listitem');
    await expect(row.getByRole('link', { name: title })).toHaveAttribute('href', '/articles/' + id);
    await expect(row.getByRole('img', { name: 'いいね 1、前回から +1' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const axe = await new AxeBuilder({ page }).include('.received-likes').analyze();
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
    await page.screenshot({ path: info.outputPath('received-likes.png'), fullPage: true });

    // Seen once, it is no longer new; the next like is.
    await page.goto('/account');
    await expect(received(page).getByRole('img', { name: '届いたいいね 1' })).toBeVisible();
    await expect(received(page).locator('.received-added')).toHaveCount(0);
    // With reduced motion the "+n" is still there but does not pop.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await like(second, id);
    await page.goto('/account');
    await expect(
      received(page).getByRole('img', { name: '届いたいいね 2、前回から +1' }),
    ).toBeVisible();
    expect(
      await received(page)
        .locator('.received-total .received-added')
        .evaluate((n) => getComputedStyle(n).animationName),
    ).toBe('none');

    // The public profile never shows the block, even to its owner.
    await page.goto('/students/' + owner.profileId);
    await expect(page.getByText('架空の書き手-' + key).first()).toBeVisible();
    await expect(page.getByRole('link', { name: title })).toBeVisible();
    await expect(received(page)).toHaveCount(0);
  } finally {
    for (const context of contexts) await context.close();
  }
});
