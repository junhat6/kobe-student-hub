import { completeGoogleFormPost } from './helpers/google-form-post';
import { test, expect } from '@playwright/test';

// #263: with a profile, my page on a wide screen puts the person on the left and their
// activity on the right (as /students/:id does); phones keep one column. Layout only.
const ORIGIN = 'https://127.0.0.1:8790';

test('my page splits into the person and their activity on a wide screen only', async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    ...testInfo.project.use,
    baseURL: ORIGIN,
    ignoreHTTPSErrors: true,
  });
  try {
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
    const token = await context.request.get(
      '/__control/token?' +
        new URLSearchParams({ state, nonce, actor: 'fictional-layout-' + crypto.randomUUID() }),
    );
    expect(token.status()).toBe(200);
    const callback = await completeGoogleFormPost(context.request, ORIGIN, { state, code: state });
    expect(callback.status()).toBe(303);
    const { csrfToken } = await (await context.request.get('/api/private/session')).json();
    const page = await context.newPage();

    // Before a profile exists the page is only about making one: a single column.
    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'プロフィールをつくる' })).toBeVisible();
    await expect(page.locator('.account-layout-split')).toHaveCount(0);

    const created = await context.request.post('/api/private/profile', {
      headers: { ...headers, Authorization: 'Bearer csrf.' + csrfToken },
      data: {
        displayName: '架空の並び',
        department: 'ゲーム開発',
        yearLabel: '2年',
        bio: '架空の自己紹介',
        confirmPublic: true,
      },
    });
    expect(created.status()).toBe(201);
    await page.reload();
    const profile = page.locator('#profile');
    const publications = page.locator('#publications');
    await expect(page.getByRole('button', { name: 'プロフィールを編集' })).toBeVisible();
    await expect(publications).toBeVisible();
    const actions = page.getByRole('navigation', { name: 'マイページの操作' });
    await expect(actions).toBeVisible();
    const [p, a, pub] = await Promise.all([
      profile.boundingBox(),
      actions.boundingBox(),
      publications.boundingBox(),
    ]);
    const viewport = page.viewportSize()!;
    const wide = viewport.width > 860;
    if (wide) {
      // Person and actions on the left, activity on the right, starting at the same height.
      expect(p!.x + p!.width).toBeLessThanOrEqual(pub!.x);
      expect(a!.x + a!.width).toBeLessThanOrEqual(pub!.x);
      expect(p!.width).toBeLessThan(viewport.width / 3);
      const firstMain = await page.locator('.account-main > *').first().boundingBox();
      expect(Math.abs(firstMain!.y - p!.y)).toBeLessThan(2);
    } else {
      // One column: everything shares the same left edge and follows the profile.
      expect(Math.abs(pub!.x - p!.x)).toBeLessThan(2);
      expect(pub!.y).toBeGreaterThan(p!.y + p!.height);
    }
    // No sideways scroll at either width.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    if (process.env.LAYOUT_SHOTS)
      await page.screenshot({
        path: `${process.env.LAYOUT_SHOTS}/account-${testInfo.project.name}.png`,
        fullPage: true,
      });

    // Editing stays in place in the narrow column and fits it.
    await page.getByRole('button', { name: 'プロフィールを編集' }).click();
    await expect(page.getByLabel('表示名')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const field = await page.getByLabel('表示名').boundingBox();
    const box = await profile.boundingBox();
    expect(field!.x + field!.width).toBeLessThanOrEqual(box!.x + box!.width);
    if (process.env.LAYOUT_SHOTS)
      await page.screenshot({
        path: `${process.env.LAYOUT_SHOTS}/account-edit-${testInfo.project.name}.png`,
        fullPage: true,
      });
  } finally {
    await context.close();
  }
});
