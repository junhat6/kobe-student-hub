import { actor, write } from './helpers/fictional-actor';
import { checkScreen } from './helpers/screen-quality';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { chooseReport, reportDialog } from './helpers/report-menu';

// C19: on the release screens of J1–J5, nothing scrolls sideways, touch targets are about
// 44px, and every control is reachable with Tab and shows where focus is.
// Runs on the HTTPS fixture at PC(1280) and mobile(390) via playwright.generation.config.ts.
async function check(page: Page, path: string, ready: () => Promise<void>) {
  if (path) await page.goto(path);
  await ready();
  await checkScreen(page, path || page.url());
}

test('J1–J5 screens fit the width, have 44px targets and visible keyboard focus', async ({
  browser,
  page,
}, info) => {
  test.setTimeout(180000);
  const contexts: BrowserContext[] = [];
  const key = info.project.name + '-' + Date.now().toString(36);
  try {
    const owner = await actor(browser, contexts, '架空のモバイル投稿者-' + key);
    const draft = await write(owner, '/api/private/drafts', {
      title: 'モバイルの記事-' + key,
      body: '## 架空の本文\n\n[架空のリンク](https://example.com) を含む文。\n\n```js\nconst answer = 42; // 架空\n```\n',
    });
    const article = await write(owner, '/api/private/publications/' + draft.id, {
      confirmPublic: true,
      summary: '架空の要約',
      tags: ['モバイル'],
      minutes: 1,
      audience: '',
      prerequisite: '',
      outcome: '',
      expectedVersion: draft.version,
    });
    const workDraft = await write(owner, '/api/private/project-drafts', {
      title: 'モバイルの作品-' + key,
      description: '架空の作品説明',
      githubUrl: '',
      demoUrl: '',
    });
    const work = await write(owner, '/api/private/project-publications/' + workDraft.id, {
      expectedVersion: workDraft.version,
      confirmPublic: true,
    });
    const articleLink = () =>
      expect(page.getByRole('link', { name: 'モバイルの記事-' + key })).toBeVisible();

    // J1: anonymous reader — home, search, article, author, work.
    await check(page, '/', articleLink);
    await page.screenshot({ path: info.outputPath('home.png'), fullPage: true });
    await check(page, '/search?q=' + encodeURIComponent('モバイルの記事-' + key), articleLink);
    await check(page, '/search?q=' + encodeURIComponent('該当しない架空の言葉'), () =>
      expect(page.locator('.empty')).toBeVisible(),
    );
    await check(page, '/articles/' + article.contentId, () =>
      expect(page.getByRole('heading', { level: 1 })).toContainText('モバイルの記事'),
    );
    await page.screenshot({ path: info.outputPath('article.png'), fullPage: true });
    await check(page, '/students/' + owner.profileId, () =>
      expect(page.getByRole('heading', { name: '架空のモバイル投稿者-' + key })).toBeVisible(),
    );
    await check(page, '/works', () =>
      expect(page.getByRole('link', { name: 'モバイルの作品-' + key })).toBeVisible(),
    );
    await check(page, '/projects/' + work.projectId, () =>
      expect(page.getByRole('heading', { level: 1 })).toContainText('モバイルの作品'),
    );
    // J2 entry: sign-in and sign-up.
    await check(page, '/login', () => expect(page.locator('main')).toBeVisible());
    await check(page, '/signup', () =>
      expect(page.getByLabel('入学', { exact: true })).toBeVisible(),
    );
    await check(page, '/guide', () => expect(page.locator('h1')).toBeVisible());

    // J2/J3/J4: the signed-in owner's account, drafts, work registration and history.
    const ownerPage = await owner.context.newPage();
    await ownerPage.setViewportSize(page.viewportSize()!);
    await check(ownerPage, '/account', () =>
      expect(ownerPage.getByRole('link', { name: '記事の管理', exact: true })).toBeVisible(),
    );
    await check(ownerPage, '/drafts', () =>
      expect(ownerPage.getByRole('button', { name: 'モバイルの記事-' + key })).toBeVisible(),
    );
    await check(ownerPage, '/works/new', () => expect(ownerPage.locator('h1')).toBeVisible());
    await check(ownerPage, '/history', () =>
      expect(ownerPage.getByRole('region', { name: '自分の閲覧履歴', exact: true })).toBeVisible(),
    );

    // J4/J5: another student reads, likes and opens the report form.
    const reader = await actor(browser, contexts, '架空のモバイル読者-' + key);
    const readerPage = await reader.context.newPage();
    await readerPage.setViewportSize(page.viewportSize()!);
    await readerPage.goto('/articles/' + article.contentId);
    await expect(readerPage.getByRole('heading', { level: 1 })).toContainText('モバイルの記事');
    await chooseReport(readerPage, '記事');
    await check(readerPage, '', () =>
      expect(readerPage.getByLabel('通報理由（必須）', { exact: true })).toBeEditable(),
    );
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
