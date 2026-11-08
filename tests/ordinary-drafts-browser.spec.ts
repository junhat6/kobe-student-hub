import { test, expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

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

async function register(page: Page, info: TestInfo, suffix = 'a') {
  const actor =
    'fictional-drafts-' + info.project.name + '-' + suffix + '-' + Date.now().toString(36);
  await page.route(provider, async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('response_mode')).toBe('fragment');
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
    await route.fulfill({
      status: 302,
      headers: {
        Location: ORIGIN + '/api/auth/callback#' + new URLSearchParams({ state, code: state }),
        'Cache-Control': 'no-store',
      },
      body: '',
    });
  });
  await page.goto('/signup');
  await page.getByLabel('入学年度 必須', { exact: true }).fill('2026');
  await page.getByLabel('卒業予定年度 必須', { exact: true }).fill('2028');
  await page.getByRole('button', { name: '学校Googleで登録', exact: true }).click();
  await expect(page).toHaveURL(ORIGIN + '/account');
  await expect(
    page.getByRole('link', { name: '下書きを書く・再開する', exact: true }),
  ).toBeVisible();
  await page.unroute(provider);
}
async function enterDrafts(page: Page) {
  await page.getByRole('link', { name: '下書きを書く・再開する', exact: true }).click();
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
async function replaceSession(context: BrowserContext) {
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
        ORIGIN +
          '/__control/token?' +
          new URLSearchParams({ state, nonce, actor: 'fictional-browser-b' }),
      )
    ).status(),
  ).toBe(200);
  expect(
    (
      await context.request.post(ORIGIN + '/api/auth/callback', {
        headers: { Origin: ORIGIN },
        form: { state, code: state },
        maxRedirects: 0,
      })
    ).status(),
  ).toBe(303);
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
}) => {
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
  expect(catalogCalls).toBe(0);
  expect(draftCalls).toBe(0);
});

test('ordinary signup to account to drafts saves and reopens without requiring a public profile', async ({
  page,
}, info) => {
  let profileWrites = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/private/profile' && request.method() !== 'GET')
      profileWrites++;
  });
  await register(page, info);
  await enterDrafts(page);
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('header')).toHaveCount(1);
  await expect(page.locator('footer')).toHaveCount(1);
  await expect(page.locator('.editor-header,.editor-footer,.editor-local-notice')).toHaveCount(0);
  await expect(
    page.getByText(
      '下書きは本人だけに表示されます。公開するには、保存済みの版とプロフィールを確認してください。',
      {
        exact: true,
      },
    ),
  ).toBeVisible();
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
  await expect(page.getByText('下書きを保存しました。', { exact: true })).toBeVisible();
  await expect(page.locator('.editor-save-state')).toHaveText('保存済み');
  await page.screenshot({
    path: info.outputPath('ordinary-drafts-saved.png'),
    fullPage: true,
    scale: 'css',
  });
  await page.reload();
  await expect(newDraft(page)).toBeEnabled();
  await page.getByRole('button', { name: 'AIと技術を選んだ理由', exact: true }).click();
  await assertPrivateBuffer(page, 'AIと技術を選んだ理由');
  await expect(body(page)).toHaveValue(/100万行/);
  expect(profileWrites).toBe(0);
  expect(await (await page.request.get('/api/private/profile')).json()).toEqual({ profile: null });
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
  await page.goBack();
  await expect(page).toHaveURL(ORIGIN + '/drafts');
  await page.getByRole('button', { name: '無題の下書き', exact: true }).click();
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
    await page.getByRole('button', { name: 'ログイン状態を確認', exact: true }).click();
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
