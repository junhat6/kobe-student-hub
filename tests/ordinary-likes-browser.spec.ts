import AxeBuilder from '@axe-core/playwright';
import { completeGoogleFormPost } from './helpers/google-form-post';
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

// C13: like and unlike through the article UI, the public nature of a like, and the
// signed-out / no-profile guidance. Uses the local signed-Google HTTPS fixture and real D1.
const ORIGIN = 'https://127.0.0.1:8790';
type Actor = { context: BrowserContext; csrf: string; profileId: string | null };

async function actor(
  browser: Browser,
  contexts: BrowserContext[],
  name: string | null,
): Promise<Actor> {
  const context = await browser.newContext({ baseURL: ORIGIN, ignoreHTTPSErrors: true });
  contexts.push(context);
  const headers = { Origin: ORIGIN };
  expect((await context.request.post('/api/auth/bootstrap', { headers })).status()).toBe(204);
  const command = await context.request.post('/api/auth/command?action=self-registration', {
    headers,
  });
  expect(command.status()).toBe(200);
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
          new URLSearchParams({ state, nonce, actor: 'fictional-likes-' + crypto.randomUUID() }),
      )
    ).status(),
  ).toBe(200);
  const callback = await completeGoogleFormPost(context.request, ORIGIN, { state, code: state });
  expect(callback.status()).toBe(303);
  const session = await context.request.get('/api/private/session');
  expect(session.status()).toBe(200);
  const { csrfToken } = await session.json();
  if (name === null) return { context, csrf: csrfToken, profileId: null };
  const profile = await context.request.post('/api/private/profile', {
    headers: { ...headers, Authorization: 'Bearer csrf.' + csrfToken },
    data: { displayName: name, department: '', yearLabel: '', bio: '', confirmPublic: true },
  });
  expect(profile.status()).toBe(201);
  return { context, csrf: csrfToken, profileId: (await profile.json()).profile.id };
}

async function write(owner: Actor, path: string, data: object) {
  const response = await owner.context.request.post(path, {
    headers: { Origin: ORIGIN, Authorization: 'Bearer csrf.' + owner.csrf },
    data,
  });
  expect(response.status()).toBe(201);
  return response.json();
}

async function article(owner: Actor, title: string) {
  const draft = await write(owner, '/api/private/drafts', {
    title,
    body: '## 架空の公開本文\n\nいいねの確認に使う架空の記事です。',
  });
  const published = await write(owner, '/api/private/publications/' + draft.id, {
    expectedVersion: draft.version,
    confirmPublic: true,
    summary: 'いいねの確認に使う架空の記事',
    tags: ['AI'],
    minutes: 1,
    audience: '',
    prerequisite: '',
    outcome: '',
  });
  return published.contentId as string;
}

function likeWrites(page: Page) {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname.startsWith('/api/private/article-likes/') &&
      request.method() !== 'GET'
    )
      writes.push(request.method());
  });
  return writes;
}

const publicNote =
  'いいねは公開されます。あなたの公開プロフィールに、いいねした記事として表示されます。';

test('a signed-in student likes and unlikes; the like is public and the guidance is clear', async ({
  page,
  browser,
}, info) => {
  const contexts: BrowserContext[] = [];
  const key = 'likes-' + info.project.name + '-' + Date.now().toString(36);
  const title = 'いいね確認の記事-' + key;
  try {
    const owner = await actor(browser, contexts, '架空制作者-' + key),
      liker = await actor(browser, contexts, '架空読者-' + key),
      noProfile = await actor(browser, contexts, null);
    const id = await article(owner, title);
    const articlePath = '/articles/' + id;
    const likesPath = '/students/' + liker.profileId + '/likes';

    // Signed out: the button tells the reader that liking needs a login, and sends nothing.
    const outWrites = likeWrites(page);
    await page.goto(articlePath);
    await expect(page.getByText(publicNote, { exact: true })).toBeVisible();
    const outButton = page.getByRole('button', { name: 'いいね', exact: true });
    await expect(outButton).not.toHaveAttribute('aria-pressed');
    await outButton.click();
    await expect(page.locator('.article-like-note')).toHaveText(
      'いいねするにはログインしてください。',
    );
    await expect(
      page.locator('.article-like-note').getByRole('link', { name: 'ログイン', exact: true }),
    ).toHaveAttribute('href', '/login');
    expect(outWrites).toHaveLength(0);

    // Signed in without a public profile: the reader learns why a profile is needed first.
    const bare = await noProfile.context.newPage();
    const bareWrites = likeWrites(bare);
    await bare.goto(articlePath);
    const bareButton = bare.getByRole('button', { name: 'いいね', exact: true });
    await expect(bareButton).toHaveAttribute('aria-pressed', 'false');
    await bareButton.click();
    await expect(bare.locator('.article-like-note')).toContainText(
      'いいねは公開プロフィールに表示されます。',
    );
    await expect(
      bare.getByRole('link', { name: 'マイページで公開プロフィールを作成', exact: true }),
    ).toHaveAttribute('href', '/account');
    expect(bareWrites).toHaveLength(0);

    // Signed in with a profile: the note says the like is public before it is pressed.
    const reader = await liker.context.newPage();
    await reader.goto(articlePath);
    await expect(reader.getByText(publicNote, { exact: true })).toBeVisible();
    await reader.getByRole('button', { name: 'いいね', exact: true }).click();
    const liked = reader.getByRole('button', { name: 'いいね済み', exact: true });
    await expect(liked).toHaveAttribute('aria-pressed', 'true');
    await expect(
      reader.getByText('あなたの公開プロフィールの「いいね」に表示されます。', { exact: true }),
    ).toBeVisible();
    // #175: the pointer still rests on the button right after pressing it; the liked label
    // must stay readable in that hover state (it used to be white on a pale pink, 1.08:1).
    await liked.hover();
    await expect(liked).toHaveCSS('background-color', 'rgb(184, 36, 63)');
    const hovered = await new AxeBuilder({ page: reader })
      .include('.like-toggle')
      .withRules(['color-contrast'])
      .analyze();
    expect(hovered.violations).toEqual([]);
    await reader.screenshot({
      path: info.outputPath('likes-liked.png'),
      fullPage: true,
      scale: 'css',
    });
    await reader.reload();
    await expect(reader.getByRole('button', { name: 'いいね済み', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Public information: a signed-out visitor sees the like on the liker's public page.
    await page.goto(likesPath);
    await expect(
      page.getByRole('heading', { name: '架空読者-' + key + 'の公開いいね', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();

    // Unlike: the button returns to "いいね", it persists, and the public page drops it.
    await reader.getByRole('button', { name: 'いいね済み', exact: true }).click();
    await expect(reader.getByRole('button', { name: 'いいね', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await reader.reload();
    await expect(reader.getByRole('button', { name: 'いいね', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await page.goto(likesPath);
    await expect(page.getByText('公開いいねはまだありません。', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(0);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(page.viewportSize()!.width);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
