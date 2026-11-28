import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { fulfillGoogleFormPost } from './helpers/google-form-post';

// C12: the student types every public profile field themselves (the Google name/picture the
// fixture token carries are never pre-filled or published), and an edit is visible to a reader
// who already has the public profile open as soon as they reload it.
const ORIGIN = 'https://127.0.0.1:8790';
const provider = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;
// scripts/session-browser-preview.mjs puts these values into every fixture Google token.
const CANARIES = [
  'GOOGLE_NAME_CANARY',
  'GOOGLE_GIVEN_CANARY',
  'GOOGLE_FAMILY_CANARY',
  'GOOGLE_PICTURE_CANARY',
  'googleusercontent',
  'st.kobedenshi.ac.jp',
];

function recordBodies(page: Page) {
  const bodies: string[] = [];
  page.on('response', async (response) => {
    const url = new URL(response.url());
    if (url.origin !== ORIGIN || !url.pathname.startsWith('/api/')) return;
    try {
      bodies.push(await response.text());
    } catch {
      // Redirects and aborted requests have no body.
    }
  });
  return bodies;
}

async function expectNoGoogleIdentity(page: Page, bodies: string[]) {
  const html = await page.content();
  for (const value of CANARIES) {
    expect(html, value).not.toContain(value);
    for (const body of bodies) expect(body, value).not.toContain(value);
  }
  await expect(page.locator('main img')).toHaveCount(0);
}

async function signUp(page: Page, info: TestInfo, entry = '/signup') {
  const actor = `fictional-self-entry-${info.project.name}-${Date.now().toString(36)}`;
  await page.route(provider, async (route) => {
    const url = new URL(route.request().url());
    const state = url.searchParams.get('state')!;
    const nonce = url.searchParams.get('nonce')!;
    expect(
      (
        await page.request.get('/__control/token?' + new URLSearchParams({ state, nonce, actor }))
      ).status(),
    ).toBe(200);
    await fulfillGoogleFormPost(route, ORIGIN, { state, code: state });
  });
  await page.goto(entry);
  await page.getByLabel('入学', { exact: true }).selectOption('2026');
  await page.getByLabel('卒業予定', { exact: true }).selectOption('2028');
  await page.getByRole('button', { name: '学校Googleで登録', exact: true }).click();
  await expect(page).toHaveURL(ORIGIN + '/account');
  await page.unroute(provider);
}

test('profile fields start empty, publish only what the student typed, and edits show on reload', async ({
  page,
  browser,
}, info) => {
  const ownerBodies = recordBodies(page);
  await signUp(page, info);
  const key = info.project.name + '-' + Date.now().toString(36);

  // 1. Nothing from Google is pre-filled: every field is empty and the preview has no image.
  const setup = page.getByRole('region', { name: 'プロフィールをつくる' });
  for (const label of ['表示名', '学科', '学年', '自己紹介'])
    await expect(setup.getByLabel(label, { exact: true })).toHaveValue('');
  await expect(setup.locator('img')).toHaveCount(0);
  await expectNoGoogleIdentity(page, ownerBodies);
  await expect(setup.getByRole('button', { name: '公開する', exact: true })).toBeDisabled();

  const before = {
    displayName: '自分で決めた表示名-' + key,
    department: '自分で書いた学科',
    yearLabel: '自分で書いた学年',
    bio: '自分で入力した最初の自己紹介',
  };
  await setup.getByLabel('表示名', { exact: true }).fill(before.displayName);
  await setup.getByLabel('学科', { exact: true }).fill(before.department);
  await setup.getByLabel('学年', { exact: true }).fill(before.yearLabel);
  await setup.getByLabel('自己紹介', { exact: true }).fill(before.bio);
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/private/profile') && r.request().method() === 'POST',
  );
  await setup.getByRole('button', { name: '公開する', exact: true }).click();
  const createdBody = await (await created).json();
  expect(createdBody.profile).toMatchObject(before);
  const profileId = createdBody.profile.id as string;
  await expect(page.getByRole('button', { name: 'プロフィールを編集', exact: true })).toBeVisible();
  // 書き手の導線（GROWTH.md §10）：つくった直後は、最初の記事への一手が1つだけ出る。
  await expect(page.getByRole('link', { name: '最初の記事を書く', exact: true })).toHaveAttribute(
    'href',
    '/drafts',
  );
  await expectNoGoogleIdentity(page, ownerBodies);

  // The author page lists only students with public activity, so publish one article.
  const { csrfToken } = await (await page.request.get('/api/private/session')).json();
  const write = async (path: string, data: object) => {
    const response = await page.request.post(path, {
      headers: { Origin: ORIGIN, Authorization: 'Bearer csrf.' + csrfToken },
      data,
    });
    expect(response.status()).toBe(201);
    return response.json();
  };
  const draft = await write('/api/private/drafts', {
    title: 'プロフィール反映の記事-' + key,
    body: '## 架空の本文',
  });
  await write('/api/private/publications/' + draft.id, {
    confirmPublic: true,
    summary: 'プロフィールの反映を確かめる架空の記事',
    tags: ['活動'],
    minutes: 1,
    audience: '',
    prerequisite: '',
    outcome: '',
    expectedVersion: draft.version,
  });

  // 2. An anonymous reader opens the public profile and sees exactly what was typed.
  const guest = await browser.newContext({
    baseURL: ORIGIN,
    ignoreHTTPSErrors: true,
    viewport: page.viewportSize() ?? undefined,
  });
  try {
    const reader = await guest.newPage();
    const readerBodies = recordBodies(reader);
    const studentResponse = reader.waitForResponse((r) =>
      r.url().endsWith('/api/students/' + profileId),
    );
    await reader.goto('/students/' + profileId);
    expect((await studentResponse).headers()['cache-control']).toBe('no-store');
    await expect(
      reader.getByRole('heading', { level: 1, name: before.displayName, exact: true }),
    ).toBeVisible();
    for (const value of [before.department, before.yearLabel, before.bio])
      await expect(reader.locator('main')).toContainText(value);
    await expectNoGoogleIdentity(reader, readerBodies);

    // 3. The student edits every field, clearing the optional department.
    const after = {
      displayName: '更新した表示名-' + key,
      yearLabel: '更新した学年',
      bio: '更新した自己紹介',
    };
    await page.reload();
    const editor = page.getByRole('region', { name: 'プロフィール', exact: true });
    await editor.getByRole('button', { name: 'プロフィールを編集', exact: true }).click();
    await expect(editor.getByLabel('表示名', { exact: true })).toHaveValue(before.displayName);
    await editor.getByLabel('表示名', { exact: true }).fill(after.displayName);
    await editor.getByLabel('学科', { exact: true }).fill('');
    await editor.getByLabel('学年', { exact: true }).fill(after.yearLabel);
    await editor.getByLabel('自己紹介', { exact: true }).fill(after.bio);
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editor.getByRole('status')).toHaveText('プロフィールを保存しました。');

    // 4. The reader's already-open page shows the edit on reload, with nothing left over.
    await reader.reload();
    await expect(
      reader.getByRole('heading', { level: 1, name: after.displayName, exact: true }),
    ).toBeVisible();
    for (const value of [after.yearLabel, after.bio])
      await expect(reader.locator('main')).toContainText(value);
    for (const value of [before.displayName, before.department, before.yearLabel, before.bio])
      await expect(reader.locator('main')).not.toContainText(value);
    await expectNoGoogleIdentity(reader, readerBodies);
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await reader.screenshot({ path: info.outputPath('profile-edited-public.png'), fullPage: true });
  } finally {
    await guest.close();
  }
});

// G10・G11（docs/loop/GROWTH.md §10）：招待リンクから、画面の道だけで最初の下書きまで行ける。
// 操作数と所要時間を annotation に残し、G11 の測り直しの表に使う（学生による実測ではない）。
test('an invite link reaches a first draft through the screens alone', async ({ page }, info) => {
  const started = Date.now();
  const lap: Record<string, number> = {};
  await signUp(page, info, '/signup?utm_source=circle&utm_medium=invite&utm_campaign=c0');
  lap.signup = Date.now() - started;

  const setup = page.getByRole('region', { name: 'プロフィールをつくる' });
  await setup.getByLabel('表示名', { exact: true }).fill('招待リンクで来た架空の学生');
  await setup.getByRole('button', { name: '公開する', exact: true }).click();
  await expect(page.getByRole('button', { name: 'プロフィールを編集', exact: true })).toBeVisible();
  lap.profile = Date.now() - started;

  await page.getByRole('link', { name: '最初の記事を書く', exact: true }).click();
  await expect(page).toHaveURL(/\/drafts$/);
  await page.getByRole('button', { name: '新しい下書き', exact: true }).click();
  await expect(page.getByLabel('タイトル', { exact: true })).toBeEditable();
  lap.draft = Date.now() - started;

  info.annotations.push({ type: 'g11-laps-ms', description: JSON.stringify(lap) });
  await page.screenshot({ path: info.outputPath('first-draft.png') });
});
