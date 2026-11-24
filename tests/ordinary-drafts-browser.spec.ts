import AxeBuilder from '@axe-core/playwright';
import { completeGoogleFormPost, fulfillGoogleFormPost } from './helpers/google-form-post';
import { test, expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { createProfileOnAccount, ensureProfileByApi } from './helpers/profile';

const ORIGIN = 'https://127.0.0.1:8790';
const provider = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;
const title = (page: Page) => page.getByLabel('タイトル', { exact: true });
const body = (page: Page) => page.getByLabel('Markdown本文', { exact: true });
const newDraft = (page: Page) => page.getByRole('button', { name: '新しい下書き', exact: true });
const save = (page: Page) => page.getByRole('button', { name: '下書きを保存', exact: true });
const home = (page: Page) =>
  page
    .getByRole('navigation', { name: 'メイン' })
    .getByRole('link', { name: 'ホーム', exact: true });
const latch = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

async function register(page: Page, info: TestInfo, suffix = 'a', profile = true) {
  const actor =
    'fictional-drafts-' + info.project.name + '-' + suffix + '-' + Date.now().toString(36);
  await page.route(provider, async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('response_mode')).toBe('form_post');
    const state = url.searchParams.get('state')!,
      nonce = url.searchParams.get('nonce')!;
    expect(url.searchParams.get('redirect_uri')).toBe(ORIGIN + '/api/auth/callback');
    expect(
      (
        await page
          .context()
          .request.get(ORIGIN + '/__control/token?' + new URLSearchParams({ state, nonce, actor }))
      ).status(),
    ).toBe(200);
    await fulfillGoogleFormPost(route, ORIGIN, { state, code: state });
  });
  await page.goto('/signup');
  await page.getByLabel('入学', { exact: true }).selectOption('2026');
  await page.getByLabel('卒業予定', { exact: true }).selectOption('2028');
  await page.getByRole('button', { name: '学校Googleで登録', exact: true }).click();
  await expect(page).toHaveURL(ORIGIN + '/account');
  if (!profile) {
    await page.unroute(provider);
    return actor;
  }
  await createProfileOnAccount(page);
  await expect(page.getByRole('link', { name: '記事の管理', exact: true })).toBeVisible();
  await page.unroute(provider);
  return actor;
}
async function enterDrafts(page: Page) {
  await page.getByRole('link', { name: '記事の管理', exact: true }).click();
  await expect(page).toHaveURL(ORIGIN + '/drafts');
  await expect(newDraft(page)).toBeEnabled();
}
async function create(page: Page) {
  await newDraft(page).click();
  await expect(title(page)).toBeEditable();
}
async function confirmNavigation(page: Page, action: () => Promise<unknown>, leave = false) {
  const shown = page.waitForEvent('dialog');
  const acted = action();
  const dialog = await shown;
  expect(dialog.type()).toBe('confirm');
  expect(dialog.message()).toContain('送信済みの保存・作成は取り消せません');
  if (leave) await dialog.accept();
  else await dialog.dismiss();
  await acted;
}
// Use the existing signed-provider HTTP flow to replace a cookie without changing the observed page.
// Proofs remain local variables and are not returned or written to browser storage.
async function replaceSession(context: BrowserContext, actor = 'fictional-browser-b') {
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
  const url = new URL((await started.json()).authorizationUrl),
    state = url.searchParams.get('state')!,
    nonce = url.searchParams.get('nonce')!;
  expect(
    (
      await context.request.get(
        ORIGIN + '/__control/token?' + new URLSearchParams({ state, nonce, actor }),
      )
    ).status(),
  ).toBe(200);
  expect(
    (await completeGoogleFormPost(context.request, ORIGIN, { state, code: state })).status(),
  ).toBe(303);
  await ensureProfileByApi(context.request, ORIGIN, '架空の別アカウント');
  const drafts = await context.request.get(ORIGIN + '/api/private/drafts');
  expect(drafts.status()).toBe(200);
  return ((await drafts.json()) as unknown[]).length;
}
async function assertPrivateBuffer(page: Page, expected: string) {
  await expect(title(page)).toHaveValue(expected);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(new URL(page.url()).search).toBe('');
  expect(new URL(page.url()).hash).toBe('');
}

test('ordinary drafts offers signed-out login and is independent of catalog failure', async ({
  page,
}, info) => {
  let catalogCalls = 0,
    draftCalls = 0;
  await page.route('**/api/catalog', (route) => {
    catalogCalls++;
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"synthetic_catalog_failure"}',
    });
  });
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/private/drafts')) draftCalls++;
  });
  await page.goto('/drafts');
  await expect(page.getByRole('heading', { name: '下書き', exact: true })).toBeVisible();
  await expect(
    page.getByText('現在ログインしていません。下書きを開くにはログインが必要です。', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'ログインする', exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: '初めての方は学生として登録する', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.draft-editor')).toHaveCount(0);
  // Signed out, sign-in is the only next step: no manual re-check, no logout note (#251).
  const main = page.getByRole('main');
  await expect(main.getByRole('button')).toHaveCount(0);
  await expect(main.getByText('ログアウトと入力の保持について')).toHaveCount(0);
  expect(catalogCalls).toBe(0);
  expect(draftCalls).toBe(0);
  // Signing in from another tab is picked up when this tab regains focus, and private
  // drafts still open only on the explicit second step.
  const other = await page.context().newPage();
  await register(other, info, 'focus', false);
  await other.close();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('button', { name: '確認したセッションで下書きを開く', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'まずプロフィールをつくろう' })).toBeVisible();
});

test('ordinary signup asks for a profile first, then drafts save and reopen', async ({
  page,
}, info) => {
  await register(page, info, 'a', false);
  // Without a public profile the writing screen offers one way forward instead of the editor.
  await page.goto('/drafts');
  const first = page.getByRole('region', { name: 'まずプロフィールをつくろう', exact: true });
  await expect(first).toBeVisible();
  await expect(page.locator('.draft-editor')).toHaveCount(0);
  await first.getByRole('link', { name: 'つくる', exact: true }).click();
  await expect(page).toHaveURL(ORIGIN + '/account#profile');
  await createProfileOnAccount(page);
  await enterDrafts(page);
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('header')).toHaveCount(1);
  await expect(page.locator('footer')).toHaveCount(1);
  await expect(page.locator('.editor-header,.editor-footer,.editor-local-notice')).toHaveCount(0);
  // #230: the heading says the drafts are the owner's only; the lab's long 「公開について」
  // note is gone, and publishing waits behind 「公開する」 once a draft is open.
  await expect(page.locator('.editor-side-heading')).toContainText('本人だけに表示');
  await expect(page.locator('.editor-publish-note')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '公開する', exact: true })).toHaveCount(0);
  await expect(page.locator('.publication-composer')).toHaveCount(0);
  await create(page);
  await title(page).fill('AIと技術を選んだ理由');
  await body(page).fill(
    '## 条件\n\n100万行のCSVを集計する。\n\n```sql\nSELECT COUNT(*) FROM events;\n```',
  );
  await page.getByRole('button', { name: 'プレビュー', exact: true }).click();
  await expect(page.getByRole('heading', { name: '条件', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '編集', exact: true }).click();
  await save(page).click();
  await expect(
    page.getByRole('status').getByText('下書きを保存しました。', { exact: true }),
  ).toBeAttached();
  // Success is announced, not shown; the badge carries it and the routine notes are gone (原則1・6).
  await expect(page.locator('.editor-status')).toHaveClass(/sr-only/);
  await expect(page.getByText('入力を止めると', { exact: false })).toHaveCount(0);
  await expect(page.getByText('更新が新しい20件まで表示します。', { exact: true })).toHaveCount(0);
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み');
  // #278: autosave does the usual work, so the manual save is a small button at the top right
  // beside 「公開する」, and nothing big stays below the body while the draft is saved.
  await expect(page.locator('.editor-heading-actions').getByRole('button')).toHaveText([
    '下書きを保存',
    '公開する',
  ]);
  await expect(save(page)).toBeDisabled();
  await expect(page.locator('.editor-save-bar')).toHaveCount(0);
  const actions = await page.locator('.editor-heading-actions').boundingBox();
  const card = await page.locator('.editor-writing-card').boundingBox();
  expect(actions && card && actions.y + actions.height <= card.y).toBe(true);
  await page.screenshot({
    path: info.outputPath('ordinary-drafts-saved.png'),
    fullPage: true,
    scale: 'css',
  });
  // #193: the folded shop-review guide shows the shared rules and appends the body skeleton.
  const guide = page.locator('.shop-review-guide');
  await guide.locator('summary', { hasText: 'お店のレビューを書くとき' }).click();
  await expect(guide.getByText('店員や他の客を特定しない', { exact: true })).toBeVisible();
  await expect(guide.locator('code', { hasText: '北野川線沿い' })).toBeVisible();
  await guide.getByRole('button', { name: '本文の末尾に型を入れる', exact: true }).click();
  await expect(body(page)).toHaveValue(
    /100万行[\s\S]*## 学生向けのポイント\n- 昼休みに間に合うか：/,
  );
  const { violations } = await new AxeBuilder({ page }).include('.shop-review-guide').analyze();
  expect(
    violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => v.id),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await guide.screenshot({ path: info.outputPath('ordinary-drafts-shop-review-guide.png') });
  await save(page).click();
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み');
  await page.reload();
  await expect(newDraft(page)).toBeEnabled();
  await page.getByRole('button', { name: 'AIと技術を選んだ理由', exact: true }).click();
  await assertPrivateBuffer(page, 'AIと技術を選んだ理由');
  await expect(body(page)).toHaveValue(/100万行/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('internal links and browser Back cancel retain the editor; confirming leaves it', async ({
  page,
}, info) => {
  await register(page, info);
  await enterDrafts(page);
  await create(page);
  await title(page).fill('離れる前の手元の文章');
  await confirmNavigation(page, () => home(page).click());
  await expect(page).toHaveURL(ORIGIN + '/drafts');
  await assertPrivateBuffer(page, '離れる前の手元の文章');
  await confirmNavigation(page, () => page.evaluate(() => history.back()));
  await expect(page).toHaveURL(ORIGIN + '/drafts');
  await assertPrivateBuffer(page, '離れる前の手元の文章');
  await confirmNavigation(page, () => page.evaluate(() => history.back()), true);
  await expect(page).toHaveURL(ORIGIN + '/account');
  await expect(page.locator('.draft-editor')).toHaveCount(0);
});

test('browser Forward cancel retains edits and reload or close asks before losing them', async ({
  page,
}, info) => {
  await register(page, info);
  await enterDrafts(page);
  await create(page);
  await home(page).click();
  await expect(page).toHaveURL(ORIGIN + '/');
  // Wait until the drafts screen has really unmounted. Going Back before that raced the router
  // and kept the old writing screen, which is what this test used to see (#266).
  await expect(page.locator('.draft-editor')).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(ORIGIN + '/drafts');
  // Back remounts 記事の管理 with the saved draft listed; opening it returns to writing (#230 ①).
  await expect(title(page)).toHaveCount(0);
  await page.getByRole('button', { name: '無題の下書き', exact: true }).click();
  await expect(title(page)).toBeEditable();
  await title(page).fill('Forwardでも残す');
  await confirmNavigation(page, () => page.evaluate(() => history.forward()));
  await expect(page).toHaveURL(ORIGIN + '/drafts');
  await assertPrivateBuffer(page, 'Forwardでも残す');
  const reloadDialog = page.waitForEvent('dialog');
  const reloading = page.evaluate(() => location.reload());
  const reload = await reloadDialog;
  expect(reload.type()).toBe('beforeunload');
  await reload.dismiss();
  await reloading;
  await assertPrivateBuffer(page, 'Forwardでも残す');
  const closeDialog = page.waitForEvent('dialog');
  const closing = page.close({ runBeforeUnload: true });
  const close = await closeDialog;
  expect(close.type()).toBe('beforeunload');
  await close.dismiss();
  await closing;
  expect(page.isClosed()).toBe(false);
  await assertPrivateBuffer(page, 'Forwardでも残す');
});

test('a pending read of publication status does not block leaving an unchanged saved draft', async ({
  page,
}, info) => {
  await register(page, info);
  await enterDrafts(page);
  const entered = latch(),
    released = latch();
  let dialogs = 0;
  page.on('dialog', async (dialog) => {
    dialogs++;
    await dialog.dismiss();
  });
  await page.route('**/api/private/publications/*', async (route) => {
    expect(route.request().method()).toBe('GET');
    const response = await route.fetch();
    entered.release();
    await released.promise;
    await route.fulfill({ response });
  });
  try {
    await create(page);
    await entered.promise;
    await home(page).click();
    await expect(page).toHaveURL(ORIGIN + '/');
    expect(dialogs).toBe(0);
  } finally {
    released.release();
  }
});

test('pending creation is guarded and a late acknowledgement is not duplicated after cancel', async ({
  page,
}, info) => {
  await register(page, info);
  await enterDrafts(page);
  const entered = latch(),
    released = latch(),
    finished = latch();
  let creates = 0;
  await page.route('**/api/private/drafts', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    creates++;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    entered.release();
    try {
      await released.promise;
      await route.fulfill({ response });
    } finally {
      finished.release();
    }
  });
  try {
    await newDraft(page).click();
    await entered.promise;
    await confirmNavigation(page, () => home(page).click());
    await expect(page).toHaveURL(ORIGIN + '/drafts');
    expect(creates).toBe(1);
    released.release();
    await finished.promise;
    await expect(title(page)).toBeEditable();
    await expect(page.locator('.editor-draft-list li')).toHaveCount(1);
    expect(creates).toBe(1);
  } finally {
    released.release();
  }
});

test('pending save and later typing remain guarded through a same-session recheck', async ({
  page,
}, info) => {
  await register(page, info);
  await enterDrafts(page);
  await create(page);
  await title(page).fill('送信した版');
  const entered = latch(),
    released = latch(),
    finished = latch();
  let saves = 0;
  await page.route('**/api/private/drafts/*', async (route) => {
    if (route.request().method() !== 'PATCH') {
      await route.continue();
      return;
    }
    saves++;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    entered.release();
    try {
      await released.promise;
      await route.fulfill({ response });
    } finally {
      finished.release();
    }
  });
  try {
    await save(page).click();
    await entered.promise;
    await title(page).fill('送信後に書き足した版');
    await confirmNavigation(page, () => home(page).click());
    await expect(page).toHaveURL(ORIGIN + '/drafts');
    released.release();
    await finished.promise;
    await expect(
      page.getByText('送信した版を保存しました。新しい変更はまだ未保存です。', { exact: true }),
    ).toBeVisible();
    // The confirmed session has no visible session panel; a window focus rechecks it.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(
      page.getByText('同じセッションを確認しました。手元の編集を保持して再開しています。', {
        exact: true,
      }),
    ).toBeVisible();
    await assertPrivateBuffer(page, '送信後に書き足した版');
    await expect(page.locator('.editor-save-state')).toHaveText('未保存の変更あり');
    expect(saves).toBe(1);
  } finally {
    released.release();
  }
});

test('lost save acknowledgement keeps text and recovers through readback without a second save', async ({
  page,
}, info) => {
  await register(page, info);
  await enterDrafts(page);
  await create(page);
  await title(page).fill('結果を確かめてから次へ');
  await body(page).fill('手元の本文を消さない。');
  let saves = 0;
  await page.route('**/api/private/drafts/*', async (route) => {
    if (route.request().method() !== 'PATCH') {
      await route.continue();
      return;
    }
    saves++;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.fulfill({
      response,
      status: 503,
      contentType: 'application/json',
      body: '{"error":"synthetic_lost_save_ack"}',
    });
  });
  await save(page).click();
  await expect(page.getByRole('alert', { name: '保存結果の確認' })).toBeVisible();
  await assertPrivateBuffer(page, '結果を確かめてから次へ');
  await expect(body(page)).toHaveValue('手元の本文を消さない。');
  expect(saves).toBe(1);
  await page.getByRole('button', { name: '保存済みの版を確認', exact: true }).click();
  await expect(page.getByLabel('保存済みタイトル', { exact: true })).toHaveValue(
    '結果を確かめてから次へ',
  );
  await page.getByRole('button', { name: '確認した版を基準にする', exact: true }).click();
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み');
  expect(saves).toBe(1);
  await home(page).click();
  await expect(page).toHaveURL(ORIGIN + '/');
});

test('a changed real session destroys the old buffer before explicit continuation', async ({
  page,
  context,
}, info) => {
  await register(page, info);
  await enterDrafts(page);
  await create(page);
  await title(page).fill('前のアカウントだけの未保存');
  const ownCount = await replaceSession(context);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    page.getByRole('button', { name: '確認したセッションで下書きを開く', exact: true }),
  ).toBeEnabled();
  await expect(title(page)).toHaveCount(0);
  await page.getByRole('button', { name: '確認したセッションで下書きを開く', exact: true }).click();
  await expect(newDraft(page)).toBeEnabled();
  await expect(page.locator('.editor-draft-list li')).toHaveCount(ownCount);
  await expect(
    page.getByRole('button', { name: '前のアカウントだけの未保存', exact: true }),
  ).toHaveCount(0);
  await expect(title(page)).toHaveCount(0);
  await home(page).click();
  await expect(page).toHaveURL(ORIGIN + '/');
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test('an autosave under a replaced session never strands the reader before continuation', async ({
  page,
  context,
}, info) => {
  await register(page, info);
  await enterDrafts(page);
  await create(page);
  await title(page).fill('前のアカウントで自動保存しかけた下書き');
  const ownCount = await replaceSession(context);
  // Let the 2s autosave run under the old session (the slow-runner path), then return.
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    page.getByRole('button', { name: '確認したセッションで下書きを開く', exact: true }),
  ).toBeEnabled();
  await expect(title(page)).toHaveCount(0);
  await page.getByRole('button', { name: '確認したセッションで下書きを開く', exact: true }).click();
  await expect(newDraft(page)).toBeEnabled();
  await expect(page.locator('.editor-draft-list li')).toHaveCount(ownCount);
  await expect(
    page.getByRole('button', { name: '前のアカウントで自動保存しかけた下書き', exact: true }),
  ).toHaveCount(0);
});

async function image(page: Page, info: TestInfo, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(name + '.png'), fullPage: true, scale: 'css' });
}
const rescueBox = (page: Page) =>
  page.getByRole('textbox', { name: '保存できなかった文章の内容', exact: true });
async function expireWhileTyping(page: Page, context: BrowserContext) {
  await create(page);
  await title(page).fill('期限切れの記事');
  await body(page).fill('一段落目');
  await expect(
    page.getByRole('status').getByText('下書きを保存しました。', { exact: true }),
  ).toBeAttached();
  expect((await context.request.get(ORIGIN + '/__control/expire')).status()).toBe(200);
  await body(page).fill('一段落目\n\n期限切れ後に書いた二段落目');
  await expect(
    page.getByRole('heading', { name: '保存できなかった文章', exact: true }),
  ).toBeVisible();
  await expect(rescueBox(page)).toHaveValue(
    '期限切れの記事\n\n一段落目\n\n期限切れ後に書いた二段落目',
  );
  await expect(page.getByRole('link', { name: '新しいタブでログインし直す' })).toHaveAttribute(
    'target',
    '_blank',
  );
  await expect(title(page)).toHaveCount(0);
  // The header must not keep showing the expired account as signed in (#187).
  const header = page.getByRole('banner');
  await expect(header.getByRole('link', { name: 'ログイン', exact: true })).toBeVisible();
  await expect(header.getByRole('button', { name: 'アカウントメニュー' })).toHaveCount(0);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
}

test('an expired session keeps unsaved text and restores it to the same draft after login', async ({
  page,
  context,
}, info) => {
  const actor = await register(page, info);
  await enterDrafts(page);
  await expireWhileTyping(page, context);
  await image(page, info, 'expired-rescue');
  await replaceSession(context, actor);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('button', { name: '確認したセッションで下書きを開く', exact: true }).click();
  await expect(body(page)).toHaveValue('一段落目\n\n期限切れ後に書いた二段落目');
  await expect(rescueBox(page)).toHaveCount(0);
  await expect(
    page.getByRole('status').getByText('下書きを保存しました。', { exact: true }),
  ).toBeAttached();
  await page.reload();
  await page.getByRole('button', { name: '期限切れの記事', exact: true }).click();
  await expect(body(page)).toHaveValue('一段落目\n\n期限切れ後に書いた二段落目');
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test('kept text is never applied to another account and can be discarded', async ({
  page,
  context,
}, info) => {
  await register(page, info);
  await enterDrafts(page);
  await expireWhileTyping(page, context);
  await replaceSession(context);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('button', { name: '確認したセッションで下書きを開く', exact: true }).click();
  await expect(page.getByText(/このアカウントの下書きとして開けませんでした/)).toBeVisible();
  await expect(title(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '期限切れの記事', exact: true })).toHaveCount(0);
  await expect(rescueBox(page)).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'この文章を破棄', exact: true }).click();
  await expect(rescueBox(page)).toHaveCount(0);
});

test('記事の管理 and the writing screen are separate, and leaving asks before dropping edits', async ({
  page,
}, info) => {
  await register(page, info);
  await enterDrafts(page);
  // 記事の管理: the list is the screen, with 下書き current and 公開中 switching in place (#270).
  const tabs = page.getByRole('navigation', { name: '記事の種類' });
  const trail = page.getByRole('navigation', { name: '現在地' });
  await expect(page.getByRole('heading', { name: '記事の管理', level: 2 })).toBeVisible();
  await expect(trail.getByRole('link', { name: 'マイページ', exact: true })).toHaveAttribute(
    'href',
    '/account',
  );
  await expect(trail.getByText('記事の管理', { exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(tabs.getByText('下書き', { exact: true })).toHaveAttribute('aria-current', 'page');
  await tabs.getByRole('link', { name: '公開中', exact: true }).click();
  await expect(page).toHaveURL(/\/drafts\?tab=published$/);
  await expect(tabs.getByText('公開中', { exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('region', { name: '自分の公開記録', exact: true })).toBeVisible();
  await expect(page.getByText('まだ公開した記事・作品はありません。')).toBeVisible();
  await expect(page.getByRole('button', { name: '新しい下書き', exact: true })).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL(/\/drafts$/);
  await expect(tabs.getByText('下書き', { exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('region', { name: '自分の公開記録', exact: true })).toHaveCount(0);
  await expect(title(page)).toHaveCount(0);
  await create(page);
  // Writing: the list is gone from view and assistive technology; the back control replaces it.
  await expect(page.getByRole('heading', { name: '記事の管理' })).toHaveCount(0);
  await expect(page.locator('.editor-sidebar')).toBeHidden();
  await title(page).fill('管理へ戻る前の編集');
  const back = page.getByRole('button', { name: '← 記事の管理', exact: true });
  const asked = page.waitForEvent('dialog');
  const clicked = back.click();
  const dialog = await asked;
  expect(dialog.message()).toBe(
    '未保存の編集があります。記事の管理へ戻ると、この画面の変更は失われます。移動しますか？',
  );
  await dialog.dismiss();
  await clicked;
  await expect(title(page)).toHaveValue('管理へ戻る前の編集');
  await save(page).click();
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み');
  await back.click();
  await expect(page.getByRole('heading', { name: '記事の管理', level: 2 })).toBeFocused();
  await expect(title(page)).toHaveCount(0);
  await expect(page.locator('.editor-status')).toHaveText(
    '一覧から下書きを開くか、新しく作成できます。',
  );
  // The routine list status is announced only; the list itself shows what to do (原則1・6).
  await expect(page.locator('.editor-status')).toHaveClass(/sr-only/);
  // Rows span the list on phones too, as a divided list rather than a horizontal strip.
  const row = page.getByRole('button', { name: '管理へ戻る前の編集', exact: true });
  const [rowBox, listBox] = await Promise.all([
    row.boundingBox(),
    page.locator('.editor-draft-list').boundingBox(),
  ]);
  expect(rowBox && listBox && Math.abs(rowBox.width - listBox.width) <= 1).toBe(true);
  const { violations } = await new AxeBuilder({ page }).include('.draft-editor').analyze();
  expect(
    violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => v.id),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('ordinary-drafts-manage.png'), fullPage: true });
  await page.getByRole('button', { name: '管理へ戻る前の編集', exact: true }).click();
  await expect(title(page)).toHaveValue('管理へ戻る前の編集');
  // A short body shows neither the size meter nor the Markdown hint (原則1・4).
  await expect(page.locator('.editor-writing-footer')).toHaveCount(0);
  await expect(page.getByText('Markdownで書けます', { exact: true })).toHaveCount(0);
  // A short title keeps its count for assistive technology only, so the focused field's
  // outline has nothing to cover (#279).
  await title(page).focus();
  const counter = page.locator('#draft-title-count');
  await expect(title(page)).toHaveAccessibleDescription('9/200文字');
  await expect(counter).toHaveClass(/sr-only/);
  await page.screenshot({ path: info.outputPath('ordinary-drafts-writing.png'), fullPage: true });
  // Near the limit the count shows, clear of the focus outline (3px wide, 6px offset).
  await title(page).fill('あ'.repeat(185));
  await expect(counter).toBeVisible();
  await expect(counter).toHaveText('185/200文字');
  const [counterBox, titleBox] = await Promise.all([
    counter.boundingBox(),
    title(page).boundingBox(),
  ]);
  expect(counterBox && titleBox && counterBox.y + counterBox.height <= titleBox.y - 9).toBe(true);
  await page.screenshot({
    path: info.outputPath('ordinary-drafts-title-count.png'),
    fullPage: true,
  });
});
