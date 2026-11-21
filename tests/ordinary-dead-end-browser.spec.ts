import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { fulfillGoogleFormPost } from './helpers/google-form-post';
import { noOverflow } from './helpers/screen-quality';
// C20: broken links, API outages and session checks never leave the reader at a dead end.
// Runs on the HTTPS fixture at PC(1280) and mobile(390) via playwright.generation.config.ts.
const ORIGIN = 'https://127.0.0.1:8790';
const provider = /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/;
async function register(page: Page, info: TestInfo) {
  const actor = `fictional-deadend-${info.project.name}-${Date.now().toString(36)}`;
  await page.route(provider, async (route) => {
    const u = new URL(route.request().url()),
      state = u.searchParams.get('state')!,
      nonce = u.searchParams.get('nonce')!;
    expect(
      (
        await page.request.get('/__control/token?' + new URLSearchParams({ state, nonce, actor }))
      ).status(),
    ).toBe(200);
    await fulfillGoogleFormPost(route, ORIGIN, { state, code: state });
  });
  await page.goto('/signup');
  await page.getByLabel('入学年度 必須', { exact: true }).fill('2026');
  await page.getByLabel('卒業予定年度 必須', { exact: true }).fill('2028');
  await page.getByRole('button', { name: '学校Googleで登録', exact: true }).click();
  await expect(page).toHaveURL(ORIGIN + '/account');
  await page.unroute(provider);
}

test('unknown, malformed and unpublished URLs show "not found" with a way back', async ({
  page,
}) => {
  const missing = '00000000-0000-4000-8000-000000000000';
  const cases: [string, string, string][] = [
    ['/no-such-page', 'ページが見つかりません', 'ホームへ戻る'],
    ['/articles/%E0%A4%A', 'ページが見つかりません', 'ホームへ戻る'],
    ['/articles/no-such-sample', 'ページが見つかりません', 'ホームへ戻る'],
    [`/articles/${missing}`, '記事が見つかりません', '記事一覧へ戻る'],
    [`/projects/${missing}`, '作品が見つかりません', '作品一覧へ戻る'],
    ['/students/nobody', '投稿者が見つかりません', 'ホームへ戻る'],
  ];
  for (const [path, heading, back] of cases) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
    const link = page.getByRole('main').getByRole('link', { name: back, exact: true });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).not.toHaveURL(ORIGIN + path);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toHaveCount(0);
  }
});

test('every page offers a retry during an API outage and recovers after it', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await register(page, info);
  // [path, retry buttons shown while /api is down, text that proves recovery after retry].
  // null: lists whose content depends on other specs' data; recovery = failure text is gone.
  // Search retries articles and projects separately so one failed list never hides the other.
  const cases: [string, string | string[], string | null, string?][] = [
    ['/', 'もう一度読み込む', null, '記事一覧を表示できませんでした'],
    ['/works', 'もう一度読み込む', null, '作品一覧を表示できませんでした'],
    ['/search?q=git', ['記事を再読み込み', '作品を再読み込み'], null, '取得失敗'],
    ['/articles/learning-notes', '再読み込み', '「動いた」で終わらせない、制作ノートの残し方'],
    ['/students/nobody', 'もう一度読み込む', '投稿者が見つかりません'],
    ['/no-such-page', '再読み込み', 'ページが見つかりません'],
    ['/account', 'ログイン状態を確認', '保存済み：2026年度入学・2028年度卒業予定'],
    ['/drafts', 'ログイン状態を確認', '保存した下書きはまだありません。'],
    ['/works/new', 'ログイン状態を確認', '作品タイトル'],
    ['/history', 'ログイン状態を確認', 'これから読む記事・作品を履歴に残す'],
    ['/guide', '問い合わせ先を再読み込み', '利用ルールと情報の扱い'],
  ];
  const main = page.getByRole('main');
  for (const [path, retry, recovered, failure] of cases) {
    await page.route('**/api/**', (r) => r.abort());
    await page.goto(path);
    const buttons = [retry].flat().map((name) => main.getByRole('button', { name, exact: true }));
    for (const button of buttons) await expect(button, path).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
    if (path === '/') await page.screenshot({ path: info.outputPath('home-outage.png') });
    await page.unroute('**/api/**');
    for (const button of buttons) await button.click();
    // The header must follow the recovered session on every page, including public pages
    // that never check the session themselves (#176), not keep offering "ログイン".
    const accountMenu = page
      .getByRole('banner')
      .getByRole('button', { name: 'アカウントメニュー' });
    if (recovered === null) {
      for (const button of buttons) await expect(button, path).toHaveCount(0);
      await expect(main.getByText(failure!), path).toHaveCount(0);
      await expect(accountMenu, path).toBeVisible();
      continue;
    }
    // Session pages re-check first and open private content only on an explicit second step.
    const open = main.getByRole('button', { name: /^確認した.+を開く$/ });
    const done = main.getByText(recovered).first();
    await expect(done.or(open).first(), path).toBeVisible();
    if (!(await done.isVisible())) await open.click();
    await expect(done, path).toBeVisible();
    await expect(accountMenu, path).toBeVisible();
  }
});
