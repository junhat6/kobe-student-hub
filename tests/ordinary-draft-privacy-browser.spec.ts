import { expectBody } from './helpers/body-editor';
import { fulfillGoogleFormPost } from './helpers/google-form-post';
import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { createProfileOnAccount } from './helpers/profile';

// C08: a draft written in one browser resumes in a separate browser (no shared cookies or storage),
// is never visible to another account, a guest or public pages, and a failed save keeps the text.
const ORIGIN = 'https://127.0.0.1:8790';
const provider = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;
const title = (page: Page) => page.getByLabel('タイトル', { exact: true });
const body = (page: Page) => page.getByLabel('Markdown本文', { exact: true });
const saveState = (page: Page) => page.locator('.editor-save-state');

async function signIn(page: Page, actor: string, mode: 'signup' | 'login') {
  await page.route(provider, async (route) => {
    const url = new URL(route.request().url()),
      state = url.searchParams.get('state')!,
      nonce = url.searchParams.get('nonce')!;
    expect(url.searchParams.get('redirect_uri')).toBe(ORIGIN + '/api/auth/callback');
    expect(
      (
        await page.request.get('/__control/token?' + new URLSearchParams({ state, nonce, actor }))
      ).status(),
    ).toBe(200);
    await fulfillGoogleFormPost(route, ORIGIN, { state, code: state });
  });
  await page.goto('/' + mode);
  if (mode === 'signup') {
    await page.getByLabel('入学', { exact: true }).selectOption('2026');
    await page.getByLabel('卒業予定', { exact: true }).selectOption('2028');
    await page.getByRole('button', { name: '学校Googleで登録', exact: true }).click();
  } else {
    await page.getByRole('button', { name: '学校Googleでログイン', exact: true }).click();
  }
  await expect(page).toHaveURL(ORIGIN + '/account');
  if (mode === 'signup') await createProfileOnAccount(page);
  await expect(page.getByRole('link', { name: '記事の管理', exact: true })).toBeVisible();
  await page.unroute(provider);
}
async function separateBrowser(browser: Browser, page: Page): Promise<BrowserContext> {
  // A new context shares no cookies, localStorage or sessionStorage with the first one.
  return browser.newContext({
    baseURL: ORIGIN,
    ignoreHTTPSErrors: true,
    viewport: page.viewportSize() ?? undefined,
  });
}
async function noBrowserCopy(page: Page) {
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(new URL(page.url()).search).toBe('');
  expect(new URL(page.url()).hash).toBe('');
}
async function startDraft(page: Page, heading: string, text: string) {
  await page.getByRole('link', { name: '記事の管理', exact: true }).click();
  await expect(page).toHaveURL(ORIGIN + '/drafts');
  await page.getByRole('button', { name: '新しい下書き', exact: true }).click();
  await expect(title(page)).toBeEditable();
  await title(page).fill(heading);
  await body(page).fill(text);
  await page.getByRole('button', { name: 'プレビュー', exact: true }).click();
  await expect(page.getByRole('heading', { name: '続きの条件', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '編集', exact: true }).click();
  await expect(saveState(page)).toHaveText('保存済み', { timeout: 7000 });
}

test('a draft resumes in a separate browser and later edits come back to the first one', async ({
  page,
  browser,
}, info) => {
  const actor = `fictional-draft-privacy-${info.project.name}-${Date.now().toString(36)}`;
  const heading = '架空の端末をまたぐ下書き';
  await signIn(page, actor, 'signup');
  await startDraft(page, heading, '## 続きの条件\n\n一台目で書いた架空の本文。');
  await noBrowserCopy(page);

  const other = await separateBrowser(browser, page);
  try {
    const second = await other.newPage();
    await second.goto('/drafts');
    await expect(second.getByRole('button', { name: heading, exact: true })).toHaveCount(0);
    await signIn(second, actor, 'login');
    await second.getByRole('link', { name: '記事の管理', exact: true }).click();
    await second.getByRole('button', { name: heading, exact: true }).click();
    await expectBody(body(second), /一台目で書いた/);
    await body(second).fill(
      '## 続きの条件\n\n一台目で書いた架空の本文。\n\n二台目で続きを書いた。',
    );
    await expect(saveState(second)).toHaveText('保存済み', { timeout: 7000 });
    await noBrowserCopy(second);
    expect(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await second.screenshot({
      path: info.outputPath('draft-resumed-in-second-browser.png'),
      fullPage: true,
      scale: 'css',
    });
  } finally {
    await other.close();
  }

  await page.reload();
  await page.getByRole('button', { name: heading, exact: true }).click();
  await expectBody(body(page), /二台目で続きを書いた。/);
  await noBrowserCopy(page);
});

test('a draft is invisible to another account, a guest and every public page', async ({
  page,
  browser,
}, info) => {
  const key = Date.now().toString(36);
  const heading = '架空の非公開下書き-' + key;
  await signIn(page, `fictional-draft-owner-${info.project.name}-${key}`, 'signup');
  await startDraft(page, heading, '## 続きの条件\n\n本人だけが読める架空の本文-' + key);
  const [draft] = (await (await page.request.get('/api/private/drafts')).json()) as {
    id: string;
    version: number;
  }[];
  expect(draft.id).toMatch(/^[0-9a-f-]{36}$/);

  const peerContext = await separateBrowser(browser, page);
  const guestContext = await separateBrowser(browser, page);
  try {
    const peer = await peerContext.newPage();
    await signIn(peer, `fictional-draft-peer-${info.project.name}-${key}`, 'signup');
    await peer.getByRole('link', { name: '記事の管理', exact: true }).click();
    await expect(peer.getByText('保存した下書きはまだありません。', { exact: true })).toBeVisible();
    await expect(peer.locator('main')).not.toContainText(heading);
    expect(await (await peer.request.get('/api/private/drafts')).json()).toEqual([]);
    // Another owner's draft is indistinguishable from a missing one for read, update and delete.
    const read = await peer.request.get('/api/private/drafts/' + draft.id);
    expect(read.status()).toBe(404);
    expect(await read.text()).not.toContain(key);
    const { csrfToken } = await (await peer.request.get('/api/private/session')).json();
    const mutation = { Origin: ORIGIN, Authorization: 'Bearer csrf.' + csrfToken };
    expect(
      (
        await peer.request.patch('/api/private/drafts/' + draft.id, {
          headers: mutation,
          data: { title: '乗っ取り', body: '乗っ取り', expectedVersion: draft.version },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await peer.request.delete('/api/private/drafts/' + draft.id, {
          headers: mutation,
          data: { expectedVersion: draft.version },
        })
      ).status(),
    ).toBe(404);

    const guest = await guestContext.newPage();
    expect((await guest.request.get('/api/private/drafts')).status()).toBe(401);
    expect((await guest.request.get('/api/private/drafts/' + draft.id)).status()).toBe(401);
    await guest.goto('/search?' + new URLSearchParams({ q: key }));
    await expect(guest.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(guest.locator('main')).not.toContainText(heading);
    await guest.goto('/');
    await expect(guest.locator('main')).not.toContainText(heading);
    for (const path of ['/api/catalog', '/api/articles', '/api/discovery'])
      expect(await (await guest.request.get(path)).text()).not.toContain(key);
  } finally {
    await peerContext.close();
    await guestContext.close();
  }

  // The owner still has the untouched draft after the attempts.
  await page.reload();
  await page.getByRole('button', { name: heading, exact: true }).click();
  await expectBody(body(page), new RegExp('本人だけが読める架空の本文-' + key));
  await expect(title(page)).toHaveValue(heading);
});

async function storedBody(page: Page) {
  const [row] = (await (await page.request.get('/api/private/drafts')).json()) as { id: string }[];
  return (
    (await (await page.request.get('/api/private/drafts/' + row.id)).json()) as { body: string }
  ).body;
}

test('a server-side save failure keeps the text on screen, says so, and saves after recovery', async ({
  page,
}, info) => {
  await signIn(
    page,
    `fictional-draft-failure-${info.project.name}-${Date.now().toString(36)}`,
    'signup',
  );
  await startDraft(page, '架空の保存失敗ノート', '## 続きの条件\n\n保存済みの本文。');
  let failed = 0;
  await page.route('**/api/private/drafts/*', (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    failed++;
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"synthetic_save_failure"}',
    });
  });
  await body(page).fill('## 続きの条件\n\n保存済みの本文。\n\n保存に失敗している間に書いた文。');
  await expect(
    page.getByText('保存結果を確認できませんでした。手元の編集はこの画面に残っています。', {
      exact: true,
    }),
  ).toBeVisible({ timeout: 7000 });
  await expect(page.getByRole('alert', { name: '保存結果の確認' })).toBeVisible();
  await expect(saveState(page)).toHaveText('未保存の変更あり');
  await expectBody(body(page), /保存に失敗している間に書いた文。/);
  await noBrowserCopy(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: info.outputPath('draft-save-failed.png'),
    fullPage: true,
    scale: 'css',
  });
  // Autosave does not keep retrying, and the server still holds only the last confirmed version.
  await page.waitForTimeout(2500);
  expect(failed).toBe(1);
  expect(await storedBody(page)).not.toContain('保存に失敗している間');

  await page.unroute('**/api/private/drafts/*');
  await page.getByRole('button', { name: '保存済みの版を確認', exact: true }).click();
  await expect(page.getByLabel('保存済みタイトル', { exact: true })).toHaveValue(
    '架空の保存失敗ノート',
  );
  await page.getByRole('button', { name: '確認した版を基準にする', exact: true }).click();
  // Rebasing never overwrites silently; the writer saves deliberately once.
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  await expectBody(body(page), /保存に失敗している間に書いた文。/);
  await expect(saveState(page)).toHaveText('保存済み', { timeout: 7000 });
  expect(await storedBody(page)).toContain('保存に失敗している間に書いた文。');
});

test('a dropped connection hides the editor without losing the text and resumes it after a recheck', async ({
  page,
}, info) => {
  await signIn(
    page,
    `fictional-draft-offline-${info.project.name}-${Date.now().toString(36)}`,
    'signup',
  );
  await startDraft(page, '架空の通信断ノート', '## 続きの条件\n\n保存済みの本文。');
  await page.route('**/api/private/drafts/*', (route) =>
    route.request().method() === 'PATCH' ? route.abort('internetdisconnected') : route.fallback(),
  );
  await body(page).fill('## 続きの条件\n\n保存済みの本文。\n\n通信が切れている間に書いた文。');
  const check = page.getByRole('region', { name: '下書きのセッション確認', exact: true });
  await expect(check).toContainText('編集中の内容は残したまま隠しています', { timeout: 7000 });
  await expect(
    check.getByRole('button', { name: 'ログイン状態を確認', exact: true }),
  ).toBeVisible();
  await expect(body(page)).toBeHidden();
  await noBrowserCopy(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: info.outputPath('draft-offline-kept.png'),
    fullPage: true,
    scale: 'css',
  });
  expect(await storedBody(page)).not.toContain('通信が切れている間');

  await page.unroute('**/api/private/drafts/*');
  await check.getByRole('button', { name: 'ログイン状態を確認', exact: true }).click();
  await expectBody(body(page), /通信が切れている間に書いた文。/);
  await expect(saveState(page)).toHaveText('未保存の変更あり');
  await page.getByRole('button', { name: '保存済みの版を確認', exact: true }).click();
  await page.getByRole('button', { name: '確認した版を基準にする', exact: true }).click();
  // Rebasing never overwrites silently; the writer saves deliberately once.
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  await expect(saveState(page)).toHaveText('保存済み', { timeout: 7000 });
  expect(await storedBody(page)).toContain('通信が切れている間に書いた文。');
});
