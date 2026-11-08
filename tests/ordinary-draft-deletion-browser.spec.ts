import { test, expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

const ORIGIN = 'https://127.0.0.1:8790';
const provider = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;
const title = (page: Page) => page.getByLabel('タイトル', { exact: true });
const body = (page: Page) => page.getByLabel('Markdown本文', { exact: true });
const remove = (page: Page) => page.getByRole('button', { name: 'この下書きを削除', exact: true });
const confirm = (page: Page) =>
  page.getByRole('button', { name: '保存版と手元の変更を削除', exact: true });
const unknown = (page: Page) => page.getByRole('alert', { name: '削除結果の確認' });
const save = (page: Page) => page.getByRole('button', { name: '下書きを保存', exact: true });
const newDraft = (page: Page) => page.getByRole('button', { name: '新しい下書き', exact: true });
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

async function register(page: Page, info: TestInfo) {
  const actor = 'fictional-delete-' + info.project.name + '-' + Date.now().toString(36);
  await page.route(provider, async (route) => {
    const url = new URL(route.request().url()),
      state = url.searchParams.get('state')!,
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
        Location: ORIGIN + '/api/auth/callback?' + new URLSearchParams({ state, code: state }),
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
  await page.unroute(provider);
  await page.getByRole('link', { name: '下書きを書く・再開する', exact: true }).click();
  await expect(newDraft(page)).toBeEnabled();
}
async function createSaved(page: Page, name: string) {
  await newDraft(page).click();
  await expect(title(page)).toBeEditable();
  await title(page).fill(name);
  await body(page).fill('## 架空の制作記録\n\n条件・判断・確認を残す。');
  await save(page).click();
  await expect(page.getByText('下書きを保存しました。', { exact: true })).toBeVisible();
}
async function assertPrivate(page: Page, expected: string) {
  await expect(title(page)).toHaveValue(expected);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(new URL(page.url()).search).toBe('');
  expect(new URL(page.url()).hash).toBe('');
}
async function image(page: Page, info: TestInfo, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(name + '.png'), fullPage: true, scale: 'css' });
}
async function cancelNavigation(page: Page, action: () => Promise<unknown>) {
  const dialog = page.waitForEvent('dialog'),
    acted = action();
  const shown = await dialog;
  expect(shown.type()).toBe('confirm');
  expect(shown.message()).toContain('送信済みの削除も取り消せません');
  await shown.dismiss();
  await acted;
  await expect(page).toHaveURL(ORIGIN + '/drafts');
}
async function replaceSession(context: BrowserContext) {
  const headers = { Origin: ORIGIN };
  expect([204, 409]).toContain(
    (await context.request.post(ORIGIN + '/api/auth/bootstrap', { headers })).status(),
  );
  const command = await context.request.post(ORIGIN + '/api/auth/command?action=login', {
    headers,
  });
  expect(command.status()).toBe(200);
  const proof = await command.json();
  const start = await context.request.post(ORIGIN + '/api/auth/start', {
    headers: { ...headers, Authorization: 'Bearer command.' + proof.commandToken },
  });
  expect(start.status()).toBe(200);
  const url = new URL((await start.json()).authorizationUrl),
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
      await context.request.get(
        ORIGIN + '/api/auth/callback?' + new URLSearchParams({ state, code: state }),
        { maxRedirects: 0 },
      )
    ).status(),
  ).toBe(303);
  const result = await context.request.get(ORIGIN + '/api/private/drafts');
  expect(result.status()).toBe(200);
  return ((await result.json()) as unknown[]).length;
}

test('ordinary deletion confirms the saved version, cancels without DELETE and removes only that draft', async ({
  page,
}, info) => {
  await register(page, info);
  await createSaved(page, '残す制作記録');
  await createSaved(page, '片付ける保存版');
  await title(page).fill('未保存の変更も確認する');
  let deletes = 0,
    refreshes = 0,
    deletedId = '';
  const postDeleteRefreshes = new WeakSet();
  page.on('request', (request) => {
    const u = new URL(request.url());
    if (request.method() === 'DELETE' && u.pathname.startsWith('/api/private/drafts/')) {
      deletes++;
      deletedId = u.pathname.split('/').at(-1)!;
    }
    if (request.method() === 'GET' && u.origin === ORIGIN && u.pathname === '/api/private/drafts') {
      refreshes++;
      if (deletes === 1) postDeleteRefreshes.add(request);
    }
  });
  await remove(page).click();
  const panel = page.getByRole('region', { name: '下書きの削除確認' });
  await expect(panel).toContainText('片付ける保存版');
  await expect(panel).toContainText('保存版 2');
  await expect(panel).toContainText('未保存の変更は失われます');
  await expect(panel).toContainText('公開済みの記事は残ります');
  await expect(page.getByRole('button', { name: 'キャンセル', exact: true })).toBeFocused();
  await expect(title(page)).toBeDisabled();
  await image(page, info, 'delete-confirm');
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  expect(deletes).toBe(0);
  await assertPrivate(page, '未保存の変更も確認する');
  await expect(remove(page)).toBeFocused();
  const refreshed = page.waitForResponse((response) => postDeleteRefreshes.has(response.request()));
  await remove(page).click();
  await confirm(page).click();
  await expect(
    page.getByText('下書きを削除しました。公開済みの記事は変更していません。', { exact: true }),
  ).toBeVisible();
  const response = await refreshed;
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/^application\/json(?:;|$)/i);
  const rows = (await response.json()) as {
    id: string;
    title: string;
    version: number;
    updatedAt: number;
  }[];
  expect(rows).toEqual([expect.objectContaining({ title: '残す制作記録', version: 2 })]);
  expect(rows[0].id).not.toBe(deletedId);
  expect(Object.keys(rows[0]).sort()).toEqual(['id', 'title', 'updatedAt', 'version']);
  expect(deletes).toBe(1);
  await expect(page.locator('.editor-draft-list li')).toHaveCount(1);
  await expect(title(page)).toHaveCount(0);
  expect(refreshes).toBeGreaterThan(0);
  await expect(newDraft(page)).toBeFocused();
  await page.getByRole('button', { name: '残す制作記録', exact: true }).click();
  await assertPrivate(page, '残す制作記録');
  await page.reload();
  await expect(newDraft(page)).toBeEnabled();
  await expect(page.locator('.editor-draft-list li')).toHaveCount(1);
});

test('pending deletion locks editing, blocks route and Back, and survives same-session inspection', async ({
  page,
}, info) => {
  await register(page, info);
  await createSaved(page, '削除ACK待ちの保存版');
  await title(page).fill('ACKまでは残す文章');
  const entered = latch(),
    release = latch();
  let deletes = 0;
  await page.route('**/api/private/drafts/*', async (route) => {
    if (route.request().method() !== 'DELETE') {
      await route.continue();
      return;
    }
    deletes++;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    entered.release();
    await release.promise;
    await route.fulfill({ response });
  });
  try {
    await remove(page).click();
    await confirm(page).click();
    await entered.promise;
    await expect(title(page)).toBeDisabled();
    await expect(body(page)).toBeDisabled();
    await expect(save(page)).toBeDisabled();
    await expect(newDraft(page)).toBeDisabled();
    await assertPrivate(page, 'ACKまでは残す文章');
    await cancelNavigation(page, () => home(page).click());
    await cancelNavigation(page, () => page.evaluate(() => history.back()));
    await page.getByRole('button', { name: 'ログイン状態を確認', exact: true }).click();
    await expect(
      page.getByText('同じセッションを確認しました。手元の編集を保持して再開しています。', {
        exact: true,
      }),
    ).toBeVisible();
    await assertPrivate(page, 'ACKまでは残す文章');
    await image(page, info, 'delete-pending');
    expect(deletes).toBe(1);
    release.release();
    await expect(title(page)).toHaveCount(0);
    await expect(page.locator('.editor-draft-list li')).toHaveCount(0);
    expect(deletes).toBe(1);
  } finally {
    release.release();
  }
});

test('a concurrent saved version prevents stale deletion and requires a new explicit basis and confirmation', async ({
  page,
  context,
}, info) => {
  await register(page, info);
  await createSaved(page, '別画面の更新前');
  await title(page).fill('この画面の未保存文章');
  let deletes = 0;
  await page.route('**/api/private/drafts/*', async (route) => {
    const request = route.request();
    if (request.method() !== 'DELETE') {
      await route.continue();
      return;
    }
    deletes++;
    if (deletes === 1) {
      const authorization = await request.headerValue('authorization');
      const changed = await context.request.patch(request.url(), {
        headers: { Origin: ORIGIN, Authorization: authorization! },
        data: { title: '別画面の新しい保存版', body: '別画面の本文', expectedVersion: 2 },
      });
      expect(changed.status()).toBe(200);
    }
    await route.continue();
  });
  await remove(page).click();
  await confirm(page).click();
  await expect(unknown(page)).toBeVisible();
  await assertPrivate(page, 'この画面の未保存文章');
  await expect(save(page)).toBeDisabled();
  expect(deletes).toBe(1);
  await page.getByRole('button', { name: '保存済みの版を確認', exact: true }).click();
  await expect(page.getByLabel('保存済みタイトル', { exact: true })).toHaveValue(
    '別画面の新しい保存版',
  );
  await expect(page.getByRole('region', { name: '下書きの削除確認' })).toHaveCount(0);
  expect(deletes).toBe(1);
  await page.getByRole('button', { name: '確認した版を基準にする', exact: true }).click();
  await assertPrivate(page, 'この画面の未保存文章');
  await remove(page).click();
  await expect(page.getByRole('region', { name: '下書きの削除確認' })).toContainText('保存版 3');
  await expect(page.getByRole('region', { name: '下書きの削除確認' })).toContainText(
    '別画面の新しい保存版',
  );
  await confirm(page).click();
  await expect(title(page)).toHaveCount(0);
  expect(deletes).toBe(2);
});

test('committed deletion with lost acknowledgement stays unknown despite list absence and read 404', async ({
  page,
}, info) => {
  await register(page, info);
  await createSaved(page, '結果不明で残す保存版');
  await title(page).fill('ACKを失っても手元に残る');
  let deletes = 0;
  await page.route('**/api/private/drafts/*', async (route) => {
    if (route.request().method() !== 'DELETE') {
      await route.continue();
      return;
    }
    deletes++;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    const ownerRead = await page.context().request.get(route.request().url());
    expect(ownerRead.status()).toBe(404);
    expect(await ownerRead.json()).toEqual({ error: 'draft_unavailable' });
    const ownerList = await page.context().request.get(ORIGIN + '/api/private/drafts');
    expect(ownerList.status()).toBe(200);
    expect(await ownerList.json()).toEqual([]);
    await route.fulfill({ response, status: 503, body: '{"error":"synthetic_lost_delete_ack"}' });
  });
  await remove(page).click();
  await confirm(page).click();
  await expect(unknown(page)).toBeVisible();
  await assertPrivate(page, 'ACKを失っても手元に残る');
  await expect(save(page)).toBeDisabled();
  await expect(remove(page)).toHaveCount(0);
  await page.getByRole('button', { name: '一覧を更新', exact: true }).click();
  await expect(page.locator('.editor-draft-list li')).toHaveCount(0);
  await expect(unknown(page)).toBeVisible();
  await page.getByRole('button', { name: '保存済みの版を確認', exact: true }).click();
  await expect(
    page.getByText(
      '保存済みの版を確認できませんでした。削除済みとは判断できません。手元の文章は残しています。',
      { exact: true },
    ),
  ).toBeVisible();
  await assertPrivate(page, 'ACKを失っても手元に残る');
  await cancelNavigation(page, () => home(page).click());
  await image(page, info, 'delete-unknown');
  expect(deletes).toBe(1);
  await expect(
    page.getByText('下書きを削除しました。公開済みの記事は変更していません。', { exact: true }),
  ).toHaveCount(0);
});

test('an uncommitted network failure recovers only after explicit readback and never auto-retries', async ({
  page,
}, info) => {
  await register(page, info);
  await createSaved(page, '接続失敗から確認する');
  await title(page).fill('手元の文章は変更しない');
  let deletes = 0;
  await page.route('**/api/private/drafts/*', async (route) => {
    if (route.request().method() !== 'DELETE') {
      await route.continue();
      return;
    }
    deletes++;
    if (deletes === 1) await route.abort('failed');
    else await route.continue();
  });
  await remove(page).click();
  await confirm(page).click();
  await expect(
    page.getByText(
      'セッションを確認できませんでした。手元の編集を保持したまま隠しています。再確認できるまで操作できません。',
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'ログイン状態を確認', exact: true }).click();
  await expect(unknown(page)).toBeVisible();
  await assertPrivate(page, '手元の文章は変更しない');
  expect(deletes).toBe(1);
  await page.getByRole('button', { name: '保存済みの版を確認', exact: true }).click();
  await expect(page.getByLabel('保存済みタイトル', { exact: true })).toHaveValue(
    '接続失敗から確認する',
  );
  await expect(unknown(page)).toBeVisible();
  await expect(save(page)).toBeDisabled();
  expect(deletes).toBe(1);
  await page.getByRole('button', { name: '確認した版を基準にする', exact: true }).click();
  await remove(page).click();
  await confirm(page).click();
  await expect(title(page)).toHaveCount(0);
  expect(deletes).toBe(2);
});

test('a late deletion acknowledgement cannot cross a changed signed session', async ({
  page,
  context,
}, info) => {
  await register(page, info);
  await createSaved(page, '旧セッションの保存版');
  await title(page).fill('旧セッションの私的buffer');
  const entered = latch(),
    release = latch(),
    finished = latch();
  let deletes = 0;
  await page.route('**/api/private/drafts/*', async (route) => {
    if (route.request().method() !== 'DELETE') {
      await route.continue();
      return;
    }
    deletes++;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    entered.release();
    try {
      await release.promise;
      await route.fulfill({ response });
    } finally {
      finished.release();
    }
  });
  try {
    await remove(page).click();
    await confirm(page).click();
    await entered.promise;
    const count = await replaceSession(context);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(title(page)).toHaveCount(0);
    await page
      .getByRole('button', { name: '確認したセッションで下書きを開く', exact: true })
      .click();
    await expect(newDraft(page)).toBeEnabled();
    release.release();
    await finished.promise;
    await expect(page.locator('.editor-draft-list li')).toHaveCount(count);
    await expect(title(page)).toHaveCount(0);
    await expect(unknown(page)).toHaveCount(0);
    await expect(
      page.getByText('下書きを削除しました。公開済みの記事は変更していません。', { exact: true }),
    ).toHaveCount(0);
    expect(deletes).toBe(1);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  } finally {
    release.release();
  }
});

test('acknowledged deletion remains confirmed when list refresh fails and other cached drafts survive', async ({
  page,
}, info) => {
  await register(page, info);
  await createSaved(page, '残す別の下書き');
  await createSaved(page, '確定して消す下書き');
  await page.route('**/api/private/drafts', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"synthetic_list_failure"}',
    }),
  );
  await remove(page).click();
  await confirm(page).click();
  await expect(
    page.getByText('下書きを削除しました。公開済みの記事は変更していません。', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('一覧を読み込めない、または更新が必要です。一覧を更新してください。', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('.editor-draft-list li')).toHaveCount(1);
  await expect(title(page)).toHaveCount(0);
  await page.getByRole('button', { name: '残す別の下書き', exact: true }).click();
  await assertPrivate(page, '残す別の下書き');
});
