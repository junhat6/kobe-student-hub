import { test, expect } from '@playwright/test';
const origin = 'https://127.0.0.1:8788';
test('independent explicit publication receipt opens anonymous recent feed without losing private edits and hides reported target', async ({
  page,
  browser,
  playwright,
}, info) => {
  const session = (await (
    await page.context().request.post(origin + '/__fixture/profile-session', {
      headers: { Origin: origin },
      data: {},
    })
  ).json()) as { csrfToken: string };
  await page.goto('/lab/account');
  await expect(page.getByRole('button', { name: '新しい下書き', exact: true })).toBeVisible();
  const title = '新着に公開する架空の記事-' + crypto.randomUUID().slice(0, 8),
    keepTitle = '一覧に残る架空の記事-' + crypto.randomUUID().slice(0, 8);
  const setup = await page.evaluate(
    async ({ csrf, title, keepTitle }) => {
      async function post(path: string, value: unknown) {
        const r = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer csrf.' + csrf },
          body: JSON.stringify(value),
        });
        if (r.status !== 201) throw Error('fictional setup unavailable');
        return r.json() as Promise<{ id: string; version: number; contentId: string }>;
      }
      await post('/api/private/profile', {
        displayName: '新着を共有する架空の投稿者',
        confirmPublic: true,
      });
      const keep = await post('/api/private/drafts', {
        title: keepTitle,
        body: '別の架空の公開本文',
      });
      const kept = await post('/api/private/publications/' + keep.id, {
        expectedVersion: keep.version,
        confirmPublic: true,
        summary: '一覧に残す概要',
        tags: [],
        minutes: 1,
      });
      const main = await post('/api/private/drafts', { title, body: '保存した架空の公開本文' });
      return { mainId: main.id, keepId: kept.contentId };
    },
    { csrf: session.csrfToken, title, keepTitle },
  );
  await page.getByRole('button', { name: '一覧を更新', exact: true }).click();
  await page.getByRole('button', { name: title, exact: true }).click();
  const composer = page.getByRole('region', { name: '保存済み版のローカル公開' });
  await composer.getByText('公開前の確認（ローカル専用）', { exact: true }).click();
  await composer
    .getByLabel('記事の概要（300文字以内）', { exact: true })
    .fill('新着から出会うための架空の概要');
  await composer.getByLabel('読了時間の目安（分）', { exact: true }).fill('2');
  await composer
    .getByRole('checkbox', {
      name: '保存済みの版と公開情報を確認し、ログインしていない読者にも見える記事としてローカルで公開します',
      exact: true,
    })
    .check();
  await composer
    .getByRole('button', { name: '確認した保存済み版をローカルで公開', exact: true })
    .click();
  const link = composer.getByRole('link', { name: '新しい公開記事の一覧を開く ↗', exact: true });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('target', '_blank');
  await page
    .getByLabel('Markdown本文', { exact: true })
    .fill('一覧タブを開いても保持する非公開の追記');
  await composer.screenshot({
    path: info.outputPath('01-published-receipt-feed-entry.png'),
    scale: 'css',
  });
  const headerChecks: Promise<void>[] = [];
  expect((await page.context().cookies()).some((c) => c.name === '__Host-kobe-session')).toBe(true);
  let feedRequests = 0;
  page.context().on('request', (request) => {
    if (request.url().endsWith('/__lab/discovery')) {
      feedRequests++;
      headerChecks.push(
        request.allHeaders().then((headers) => {
          expect(Object.hasOwn(headers, 'cookie')).toBe(false);
          expect(Object.hasOwn(headers, 'x-csrf-token')).toBe(false);
        }),
      );
    }
  });
  const popupReady = page.waitForEvent('popup');
  await link.click();
  const popup = await popupReady;
  await expect(popup.getByRole('heading', { name: '新しい公開記事', exact: true })).toBeVisible();
  const target = popup.getByRole('link', { name: title, exact: true });
  await expect(target).toBeVisible();
  const href = (await target.getAttribute('href'))!,
    contentId = href.split('/').pop()!;
  expect(feedRequests).toBeGreaterThan(0);
  await expect(page.getByLabel('Markdown本文', { exact: true })).toHaveValue(
    '一覧タブを開いても保持する非公開の追記',
  );
  await popup
    .getByRole('article')
    .filter({ has: target })
    .screenshot({ path: info.outputPath('02-new-publication-feed-card.png'), scale: 'css' });
  await target.click();
  await expect(popup.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await popup.getByRole('link', { name: '新着を共有する架空の投稿者', exact: true }).click();
  await expect(
    popup.getByRole('heading', { name: '新着を共有する架空の投稿者', exact: true }),
  ).toBeVisible();
  for (let n = 0; n < 3; n++) {
    const reporter = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: origin });
    try {
      const { csrfToken } = (await (
        await reporter.request.post('/__fixture/profile-session', {
          headers: { Origin: origin },
          data: {},
        })
      ).json()) as { csrfToken: string };
      expect(
        (
          await reporter.request.post('/api/private/reports/' + contentId, {
            headers: { Origin: origin, Authorization: 'Bearer csrf.' + csrfToken },
            data: { reason: '新着一覧から除外する架空の理由' + n },
          })
        ).status(),
      ).toBe(200);
    } finally {
      await reporter.close();
    }
  }
  const raw = await playwright.request.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    storageState: { cookies: [], origins: [] },
  });
  try {
    const response = await raw.get('/__lab/discovery');
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers['set-cookie']).toBeUndefined();
    expect(headers.location).toBeUndefined();
    expect(headers['cache-control']).toContain('no-store');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-robots-tag']).toBe('noindex, nofollow');
    const data = (await response.json()) as {
      cards: { entry: { id: string }; author: Record<string, unknown> }[];
    };
    expect(data.cards.some((c) => c.entry.id === contentId)).toBe(false);
    expect(data.cards.some((c) => c.entry.id === setup.keepId)).toBe(true);
    for (const card of data.cards) expect(card.author).not.toHaveProperty('bio');
    expect((await raw.get('/__lab/discovery?private=x')).status()).toBe(404);
    expect((await raw.post('/__lab/discovery')).status()).toBe(405);
    expect((await raw.get('/__lab/articles/' + contentId)).status()).toBe(404);
  } finally {
    await raw.dispose();
  }
  const device = info.project.use,
    anon = await browser.newContext({
      ignoreHTTPSErrors: true,
      baseURL: origin,
      viewport: page.viewportSize(),
      screen: device.screen,
      isMobile: device.isMobile,
      hasTouch: device.hasTouch,
      deviceScaleFactor: device.deviceScaleFactor,
      userAgent: device.userAgent,
    });
  try {
    const fresh = await anon.newPage();
    await fresh.goto('/lab/discover');
    await expect(fresh.getByRole('link', { name: title, exact: true })).toHaveCount(0);
    await expect(fresh.getByRole('link', { name: keepTitle, exact: true })).toBeVisible();
    expect(fresh.viewportSize()).toEqual(page.viewportSize());
    await fresh
      .getByRole('article')
      .filter({ has: fresh.getByRole('link', { name: keepTitle, exact: true }) })
      .screenshot({ path: info.outputPath('03-other-publication-remains.png'), scale: 'css' });
    expect(await anon.cookies()).toEqual([]);
    await Promise.all(headerChecks);
  } finally {
    await anon.close();
    await popup.close();
  }
});
