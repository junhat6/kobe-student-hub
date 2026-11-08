import { test, expect, chromium, type Page, type Route, type Request } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const origin = 'https://127.0.0.1:8788';
const buffer = 'Fictional unsaved lifecycle input';
const recheck = (page: Page) =>
  page.getByRole('button', { name: 'セッションを再確認', exact: true });
const panel = (page: Page) => page.locator('.session-private');
async function hidden(page: Page) {
  await expect(panel(page)).toBeHidden();
  expect(await panel(page).evaluate((e) => (e as HTMLElement).inert)).toBe(true);
}
// Synthetic lifecycle tests deliberately override visibility; the actual-tab test below does not.
async function visibility(page: Page, value: 'hidden' | 'visible') {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, value);
}
async function seed(page: Page) {
  expect(
    (
      await page.context().request.post(origin + '/__fixture/session', {
        headers: { Origin: origin },
        data: { account: 'a' },
        ignoreHTTPSErrors: true,
      })
    ).status(),
  ).toBe(200);
}
async function open(page: Page) {
  await seed(page);
  await page.goto(origin + '/lab/account');
  await expect(page.getByRole('button', { name: '新しい下書き', exact: true })).toBeVisible();
}
async function edit(page: Page) {
  const pending = new Set<Request>();
  const start = (r: Request) => {
    if (r.url().startsWith(origin + '/api/')) pending.add(r);
  };
  const end = (r: Request) => pending.delete(r);
  page.on('request', start);
  page.on('requestfinished', end);
  page.on('requestfailed', end);
  await page.getByRole('button', { name: '新しい下書き', exact: true }).click();
  await page.getByLabel('Markdown本文', { exact: true }).fill(buffer);
  await expect.poll(() => pending.size).toBe(0);
  page.off('request', start);
  page.off('requestfinished', end);
  page.off('requestfailed', end);
  await page.locator('#draft-body').evaluate((e) => {
    (e as HTMLTextAreaElement & { qaSame?: boolean }).qaSame = true;
  });
}
async function queue(page: Page) {
  const proof = await page
    .context()
    .request.get(origin + '/api/private/session', { ignoreHTTPSErrors: true });
  expect(proof.status()).toBe(200);
  const body = await proof.text();
  let closed = false;
  const entries: { route: Route; release: (status: number) => void; done: Promise<void> }[] = [];
  await page.route('**/api/private/session', async (route) => {
    if (closed) {
      await route.continue();
      return;
    }
    let release!: (status: number) => void, done!: () => void;
    const status = new Promise<number>((r) => (release = r));
    const finished = new Promise<void>((r) => (done = r));
    entries.push({ route, release, done: finished });
    try {
      const code = await status;
      await route.fulfill({
        status: code,
        contentType: 'application/json',
        body: code === 200 ? body : '{"error":"fictional"}',
      });
    } catch {
      /* aborted proof may no longer have a network request */
    } finally {
      done();
    }
  });
  return {
    async at(n: number) {
      await expect.poll(() => entries.length).toBe(n + 1);
    },
    async release(n: number, status = 200) {
      entries[n].release(status);
      await entries[n].done;
    },
    async close() {
      closed = true;
      for (const e of entries) e.release(200);
      await Promise.all(entries.map((e) => e.done));
      await page.unroute('**/api/private/session');
    },
  };
}
for (const status of [200, 401, 503])
  test(
    'synthetic hidden ignores stale ' + status + ' and its finally cannot finish a fresh proof',
    async ({ page }) => {
      await open(page);
      await edit(page);
      const q = await queue(page);
      try {
        await recheck(page).click();
        await q.at(0);
        await visibility(page, 'hidden');
        await hidden(page);
        await visibility(page, 'visible');
        await q.at(1);
        await q.release(0, status);
        await expect(recheck(page)).toBeDisabled();
        await hidden(page);
        await expect(page.locator('#draft-body')).toHaveValue(buffer);
        await visibility(page, 'hidden');
        await q.release(1, status);
        await hidden(page);
        await visibility(page, 'visible');
        await q.at(2);
        await expect(recheck(page)).toBeDisabled();
        await hidden(page);
        await q.release(2);
        await expect(page.locator('#draft-body')).toBeVisible();
        await expect(recheck(page)).toBeEnabled();
        await expect(page.locator('#draft-body')).toHaveValue(buffer);
        expect(
          await page
            .locator('#draft-body')
            .evaluate((e) => Boolean((e as HTMLTextAreaElement & { qaSame?: boolean }).qaSame)),
        ).toBe(true);
      } finally {
        await q.close();
      }
    },
  );
test('initial proof interrupted before token installation restarts only after return', async ({
  page,
}) => {
  await seed(page);
  const q = await queue(page);
  try {
    await page.goto(origin + '/lab/account');
    await q.at(0);
    await visibility(page, 'hidden');
    await q.release(0);
    await hidden(page);
    await expect(page.locator('#draft-body')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '新しい下書き', exact: true })).toHaveCount(0);
    await visibility(page, 'visible');
    await q.at(1);
    await hidden(page);
    await q.release(1);
    // The initial proof installs the editor; its private SDKs then request their own proofs.
    await q.close();
    await expect(page.getByRole('button', { name: '新しい下書き', exact: true })).toBeVisible();
  } finally {
    await q.close();
  }
});
test('explicit continuation interrupted by pagehide requires fresh proof and explicit continuation again', async ({
  page,
}) => {
  await page.goto(origin + '/lab/account');
  await expect(page.getByText(/現在ログインしていません/)).toBeVisible();
  await seed(page);
  await recheck(page).click();
  const proceed = page.getByRole('button', { name: '確認したセッションで編集を開く', exact: true });
  await expect(proceed).toBeVisible();
  const q = await queue(page);
  try {
    await proceed.click();
    await q.at(0);
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })),
    );
    await hidden(page);
    await q.release(0);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await hidden(page);
    await expect(page.getByRole('button', { name: '新しい下書き', exact: true })).toHaveCount(0);
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
    );
    await q.at(1);
    await expect(proceed).toBeDisabled();
    await q.release(1);
    await hidden(page);
    await expect(proceed).toBeEnabled();
    await q.close();
    await proceed.click();
    await expect(page.getByRole('button', { name: '新しい下書き', exact: true })).toBeVisible();
  } finally {
    await q.close();
  }
});
test('repeated synthetic pagehide/pageshow preserves input but never reveals before new proof', async ({
  page,
}) => {
  await open(page);
  await edit(page);
  const q = await queue(page);
  try {
    for (let n = 0; n < 3; n++) {
      await page.evaluate(() =>
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })),
      );
      await hidden(page);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await hidden(page);
      await page.evaluate(() =>
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
      );
      await q.at(n);
      await hidden(page);
      await q.release(n);
      await expect(page.locator('#draft-body')).toBeVisible();
      await expect(page.locator('#draft-body')).toHaveValue(buffer);
    }
  } finally {
    await q.close();
  }
});
for (const status of [200, 503])
  test(
    'logout ' + status + ' completes across hide and return without resurrecting input',
    async ({ page }) => {
      await open(page);
      await edit(page);
      let release!: () => void, arrived!: () => void;
      const held = new Promise<void>((r) => (release = r)),
        ready = new Promise<void>((r) => (arrived = r));
      let inspections = 0;
      page.on('request', (r) => {
        if (r.url().endsWith('/api/private/session')) inspections++;
      });
      await page.route('**/api/private/logout', async (route) => {
        arrived();
        await held;
        await route.fulfill({
          status,
          contentType: 'application/json',
          body: status === 200 ? '{"loggedOut":true}' : '{"error":"fictional"}',
        });
      });
      page.once('dialog', (d) => d.accept());
      await page.getByRole('button', { name: 'このブラウザをログアウト', exact: true }).click();
      await ready;
      await visibility(page, 'hidden');
      await page.evaluate(() =>
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })),
      );
      await visibility(page, 'visible');
      await page.evaluate(() =>
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
      );
      await expect(recheck(page)).toBeDisabled();
      await expect(page.locator('#draft-body')).toHaveCount(0);
      release();
      await expect(recheck(page)).toBeEnabled();
      await expect(
        page.getByText(
          status === 200
            ? 'このブラウザのセッションをログアウトしました。他のセッションの終了は確認していません。'
            : /ログアウトの結果を確認できませんでした/,
          { exact: status === 200 },
        ),
      ).toBeVisible();
      await hidden(page);
      expect(inspections).toBe(0);
    },
  );

test('actual background tab cannot reveal after delayed proof; fresh foreground proof retains input', async ({}, info) => {
  test.skip(
    info.project.name !== 'editor-desktop',
    'one isolated actual-tab run; synthetic cases also cover mobile viewport',
  );
  const profile = await mkdtemp(join(tmpdir(), 'kobe-lifecycle-test-'));
  const child = spawn(chromium.executablePath(), [
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    ...(process.env.PRIVACY_HEADED === '1' ? [] : ['--headless=new']),
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    'about:blank',
  ]);
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      let log = '';
      const timer = setTimeout(() => reject(Error('isolated browser startup timed out')), 10000);
      child.stderr.on('data', (part) => {
        log += part;
        const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      child.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(Error('isolated browser exited'));
      });
    });
    // noDefaults avoids Playwright's forced focus/visibility override on its normal pages.
    browser = await chromium.connectOverCDP(endpoint, { noDefaults: true });
    const context = browser.contexts()[0];
    await context.route('**/*', (r) =>
      r.request().url().startsWith(origin) ? r.continue() : r.abort(),
    );
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Security.setIgnoreCertificateErrors', { ignore: true });
    await open(page);
    await edit(page);
    const other = await context.newPage();
    await other.goto(origin + '/api/health');
    await page.bringToFront();
    await expect(page.locator('#draft-body')).toBeVisible();
    const q = await queue(page);
    try {
      await recheck(page).click();
      await q.at(0);
      await other.bringToFront();
      await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('hidden');
      await hidden(page);
      await q.release(0);
      await hidden(page);
      expect(await page.evaluate(() => document.visibilityState)).toBe('hidden');
      expect(await panel(page).evaluate((e) => getComputedStyle(e).display)).toBe('none');
      await page.bringToFront();
      await q.at(1);
      await hidden(page);
      await expect(recheck(page)).toBeDisabled();
      await q.release(1);
      await expect(page.locator('#draft-body')).toBeVisible();
      await expect(page.locator('#draft-body')).toHaveValue(buffer);
    } finally {
      await q.close();
    }
  } finally {
    if (browser) await browser.close();
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise<void>((r) => child.once('exit', () => r()));
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
