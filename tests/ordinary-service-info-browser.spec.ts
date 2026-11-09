import { fulfillGoogleFormPost } from './helpers/google-form-post';
import { test, expect, type Page } from '@playwright/test';

const ORIGIN = 'https://127.0.0.1:8790';
const provider = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;
const contact = 'https://support.example.org/student-help?topic=hub#contact';

async function register(page: Page) {
  await page.route(provider, async (route) => {
    const authorization = new URL(route.request().url());
    expect(authorization.searchParams.get('response_mode')).toBe('form_post');
    const state = authorization.searchParams.get('state')!,
      nonce = authorization.searchParams.get('nonce')!;
    expect(
      (
        await page.context().request.get(
          '/__control/token?' +
            new URLSearchParams({
              state,
              nonce,
              actor: 'fictional-guide-' + crypto.randomUUID(),
            }),
        )
      ).status(),
    ).toBe(200);
    await fulfillGoogleFormPost(route, ORIGIN, { state, code: state });
  });
  await page.getByRole('button', { name: '学校Googleで登録', exact: true }).click();
  await expect(page).toHaveURL(ORIGIN + '/account');
  await expect(page.getByRole('region', { name: '運営からのお知らせ', exact: true })).toBeVisible();
  await page.unroute(provider);
}

test('ordinary guide keeps registration input and publishes only an explicit safe contact destination', async ({
  page,
  context,
}, info) => {
  let configured: string | undefined,
    fail = false;
  const publicReads: { cookie: boolean; authorization: boolean; body: boolean }[] = [];
  const external: {
    host: string;
    url: string;
    referer?: string;
    cookie: boolean;
    authorization: boolean;
    body: boolean;
  }[] = [];
  await context.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin === ORIGIN) return route.continue();
    const headers = request.headers();
    external.push({
      host: url.host,
      url: url.href,
      referer: headers.referer,
      cookie: !!headers.cookie,
      authorization: !!headers.authorization,
      body: !!request.postData(),
    });
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<title>Synthetic public contact</title><p>Contact fixture</p>',
    });
  });
  await context.route('**/api/service-info', async (route) => {
    const request = route.request(),
      headers = request.headers();
    publicReads.push({
      cookie: !!headers.cookie,
      authorization: !!headers.authorization,
      body: !!request.postData(),
    });
    if (fail)
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"unavailable"}',
      });
    const response = await route.fetch({
      headers: { ...headers, ...(configured ? { 'X-Test-Public-Contact': configured } : {}) },
    });
    await route.fulfill({ response });
  });
  await page.goto('/signup');
  await page.getByLabel('入学年度 必須', { exact: true }).fill('2026');
  await page.getByLabel('卒業予定年度 必須', { exact: true }).fill('2028');
  expect(await page.locator('.account-entry form input').count()).toBe(2);
  const guideOpen = context.waitForEvent('page');
  await page.getByRole('link', { name: '利用ルールと情報の扱い（別のタブ）', exact: true }).click();
  const guide = await guideOpen;
  await expect(
    guide.getByRole('heading', { name: '利用ルールと情報の扱い', exact: true }),
  ).toBeVisible();
  await expect(guide.getByText('問い合わせ窓口は現在未設定です。', { exact: false })).toBeVisible();
  await guide.getByRole('link', { name: '情報の扱い', exact: true }).click();
  await expect(guide).toHaveURL(ORIGIN + '/guide#privacy');
  await expect(
    guide.getByText('アプリ内の閲覧履歴は記録していません。', { exact: false }),
  ).toBeVisible();
  await expect(guide.getByText('AIを使った執筆もできます。', { exact: false })).toBeVisible();
  await expect(
    guide.getByText('解答の丸写しは掲載しないでください。', { exact: false }),
  ).toBeVisible();
  expect(external).toEqual([]);
  expect(await guide.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await guide.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await guide.screenshot({
    path: info.outputPath('guide-unset.png'),
    fullPage: true,
    scale: 'css',
  });
  await guide.close();
  await page.bringToFront();
  await expect(page.getByLabel('入学年度 必須', { exact: true })).toHaveValue('2026');
  await expect(page.getByLabel('卒業予定年度 必須', { exact: true })).toHaveValue('2028');

  await register(page);
  configured = contact;
  const noticeOpen = context.waitForEvent('page');
  await page
    .getByRole('link', { name: '判断についての相談・異議申立ての案内（別のタブ）', exact: true })
    .click();
  const noticeGuide = await noticeOpen;
  await expect(noticeGuide).toHaveURL(ORIGIN + '/guide#contact');
  await expect(
    noticeGuide.getByRole('link', { name: '運営の問い合わせ窓口を開く', exact: true }),
  ).toHaveAttribute('href', contact);
  await expect(
    noticeGuide.getByText('学校Googleを使えなくなった場合も', { exact: false }),
  ).toBeVisible();
  expect(external).toEqual([]);
  expect(publicReads.every((value) => !value.cookie && !value.authorization && !value.body)).toBe(
    true,
  );
  expect(await noticeGuide.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  await noticeGuide.screenshot({
    path: info.outputPath('guide-configured.png'),
    fullPage: true,
    scale: 'css',
  });
  const externalOpen = context.waitForEvent('page');
  await noticeGuide.getByRole('link', { name: '運営の問い合わせ窓口を開く', exact: true }).click();
  const externalPage = await externalOpen;
  await externalPage.waitForLoadState('domcontentloaded');
  expect(external).toEqual([
    {
      host: 'support.example.org',
      url: contact.split('#')[0],
      referer: undefined,
      cookie: false,
      authorization: false,
      body: false,
    },
  ]);
  await externalPage.close();

  configured = 'mailto:student-help@example.org';
  await noticeGuide.reload();
  await expect(
    noticeGuide.getByRole('link', { name: 'メールで問い合わせる', exact: true }),
  ).toHaveAttribute('href', configured);
  expect(external).toHaveLength(1);
  configured = 'https://secret@support.example.org';
  await noticeGuide.reload();
  await expect(
    noticeGuide.getByText('問い合わせ窓口は現在未設定です。', { exact: false }),
  ).toBeVisible();
  await expect(
    noticeGuide.getByRole('link', { name: '運営の問い合わせ窓口を開く', exact: true }),
  ).toHaveCount(0);
  fail = true;
  await noticeGuide.reload();
  await expect(
    noticeGuide.getByText('問い合わせ先を確認できませんでした。', { exact: true }),
  ).toBeVisible();
  await expect(
    noticeGuide.getByText('問い合わせ窓口は現在未設定です。', { exact: false }),
  ).toHaveCount(0);
  fail = false;
  configured = contact;
  await noticeGuide.getByRole('button', { name: '問い合わせ先を再読み込み', exact: true }).click();
  await expect(
    noticeGuide.getByRole('link', { name: '運営の問い合わせ窓口を開く', exact: true }),
  ).toHaveAttribute('href', contact);
  await noticeGuide.getByRole('link', { name: 'このサイトについて', exact: true }).last().click();
  await noticeGuide
    .getByRole('link', { name: '利用ルール・情報の扱い・問い合わせを見る', exact: true })
    .click();
  await expect(noticeGuide).toHaveURL(ORIGIN + '/guide');
  await noticeGuide.close();

  const raw = await page.request.get(
    '/api/service-info?PUBLIC_CONTACT_URL=https://ignored.example.org',
    {
      headers: {
        PUBLIC_CONTACT_URL: 'https://ignored.example.org',
        MODERATION_EMAIL_TO: 'private@example.invalid',
      },
    },
  );
  expect(raw.status()).toBe(200);
  expect(await raw.json()).toEqual({ contactUrl: null });
  expect(raw.headers()['cache-control']).toContain('no-store');
  expect(raw.headers()['set-cookie']).toBeUndefined();
  expect(raw.headers()['access-control-allow-origin']).toBeUndefined();
  expect(
    (
      await page.request.post('/api/service-info', {
        data: { contactUrl: 'https://ignored.example.org' },
      })
    ).status(),
  ).toBe(405);
});
