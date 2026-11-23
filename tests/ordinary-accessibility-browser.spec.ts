import AxeBuilder from '@axe-core/playwright';
import { actor, write } from './helpers/fictional-actor';
import { AGENT_MCP_RELEASE_ENABLED } from '../src/shared/agent-release';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';

// C19 / #141: the ordinary release screens (reading, report forms, sign-in, account,
// history and authoring entry points) have no critical or serious axe violations.
async function seriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(' ')) }));
}

async function check(page: Page, path: string, ready: () => Promise<void>) {
  await page.goto(path);
  await ready();
  // Colour transitions (e.g. a primary button turning from its disabled pale blue to the accent
  // after the session check) must settle first, or axe can sample a mid-transition colour. CI
  // caught /login this way on rc/9d1c184. CSS transitions are finite, unlike looping animations.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => !(a instanceof CSSTransition) || a.playState !== 'running'),
  );
  expect
    .soft({ path, violations: await seriousViolations(page) })
    .toEqual({ path, violations: [] });
}

test('ordinary reading, report, sign-in, account and history screens pass axe', async ({
  browser,
  page,
}, info) => {
  const contexts: BrowserContext[] = [];
  const key = info.project.name + '-' + Date.now().toString(36);
  try {
    const owner = await actor(browser, contexts, '架空の読みやすさ投稿者-' + key);
    const draft = await write(owner, '/api/private/drafts', {
      title: '読みやすさの記事-' + key,
      body: '## 架空の本文\n\n```js\nconst answer = 42; // 架空\n```\n',
    });
    const article = await write(owner, '/api/private/publications/' + draft.id, {
      confirmPublic: true,
      summary: '架空の要約',
      tags: ['読みやすさ'],
      minutes: 1,
      audience: '',
      prerequisite: '',
      outcome: '',
      expectedVersion: draft.version,
    });
    const workDraft = await write(owner, '/api/private/project-drafts', {
      title: '読みやすさの作品-' + key,
      description: '架空の作品説明',
      githubUrl: '',
      demoUrl: '',
    });
    const work = await write(owner, '/api/private/project-publications/' + workDraft.id, {
      expectedVersion: workDraft.version,
      confirmPublic: true,
    });

    // Anonymous reader.
    await check(page, '/', () =>
      expect(page.getByRole('link', { name: '読みやすさの記事-' + key })).toBeVisible(),
    );
    await check(page, '/search?q=' + encodeURIComponent('読みやすさの記事-' + key), () =>
      expect(page.getByRole('link', { name: '読みやすさの記事-' + key })).toBeVisible(),
    );
    await check(page, '/search?q=' + encodeURIComponent('該当しない架空の言葉'), () =>
      expect(page.locator('.empty')).toBeVisible(),
    );
    await check(page, '/works', () =>
      expect(page.getByRole('link', { name: '読みやすさの作品-' + key })).toBeVisible(),
    );
    await check(page, '/students/' + owner.profileId, () =>
      expect(page.getByRole('heading', { name: '架空の読みやすさ投稿者-' + key })).toBeVisible(),
    );
    await check(page, '/agents', () =>
      expect(page.getByRole('note', { name: '履歴を使う前に' })).toBeVisible(),
    );
    await check(page, '/login', () =>
      expect(page.getByRole('button', { name: '学校Googleでログイン', exact: true })).toBeEnabled(),
    );
    await check(page, '/signup', () =>
      expect(page.getByLabel('入学', { exact: true })).toBeVisible(),
    );
    await check(page, '/guide', () => expect(page.locator('h1')).toBeVisible());
    await check(page, '/history', () =>
      expect(page.getByRole('link', { name: 'ログインして履歴を見る', exact: true })).toBeVisible(),
    );
    // #182: the signed-out account screens, including the school-account rejection notice.
    await check(page, '/account', () =>
      expect(page.getByRole('link', { name: 'ログインする', exact: true })).toBeVisible(),
    );
    await check(page, '/account#school-account-required', () =>
      expect(page.getByRole('alert')).toContainText('学校のアカウントではないため'),
    );
    await check(page, '/drafts', () =>
      expect(page.getByRole('link', { name: 'ログインする', exact: true })).toBeVisible(),
    );

    // Report forms on an ordinary article and work, opened by another signed-in student.
    const reader = await actor(browser, contexts, '架空の読者-' + key);
    const readerPage = await reader.context.newPage();
    await readerPage.setViewportSize(page.viewportSize()!);
    await readerPage.goto('/articles/' + article.contentId);
    await expect(readerPage.getByRole('heading', { level: 1 })).toContainText('読みやすさの記事');
    await readerPage.getByRole('button', { name: 'この記事を通報する', exact: true }).click();
    await expect(readerPage.getByLabel('通報理由（必須）', { exact: true })).toBeEditable();
    expect.soft(await seriousViolations(readerPage)).toEqual([]);
    await readerPage.goto('/projects/' + work.projectId);
    await expect(readerPage.getByRole('heading', { level: 1 })).toContainText('読みやすさの作品');
    await readerPage.getByRole('button', { name: 'この作品を通報する', exact: true }).click();
    await expect(readerPage.getByLabel('作品の通報理由（必須）', { exact: true })).toBeEditable();
    expect.soft(await seriousViolations(readerPage)).toEqual([]);

    // Signed-in owner.
    const ownerPage = await owner.context.newPage();
    await ownerPage.setViewportSize(page.viewportSize()!);
    await check(ownerPage, '/account', () =>
      expect(ownerPage.getByRole('link', { name: '記事を書く', exact: true })).toBeVisible(),
    );
    await check(ownerPage, '/history', () =>
      expect(ownerPage.getByRole('region', { name: '自分の閲覧履歴', exact: true })).toBeVisible(),
    );
    await check(ownerPage, '/drafts', () => expect(ownerPage.locator('h1')).toBeVisible());
    await check(ownerPage, '/works/new', () => expect(ownerPage.locator('h1')).toBeVisible());
    // C21 / #219: the MCP consent screen, reached the way an agent sends the student there.
    if (AGENT_MCP_RELEASE_ENABLED) {
      const registered = await ownerPage.request.post('/api/oauth/register', {
        data: {
          client_name: '架空のエージェント-' + key,
          redirect_uris: ['http://127.0.0.1:33418/callback'],
        },
      });
      expect(registered.status()).toBe(201);
      const authorize = await ownerPage.request.get(
        '/api/oauth/authorize?' +
          new URLSearchParams({
            response_type: 'code',
            client_id: (await registered.json()).client_id,
            redirect_uri: 'http://127.0.0.1:33418/callback',
            code_challenge: 'A'.repeat(43),
            code_challenge_method: 'S256',
          }),
        { maxRedirects: 0 },
      );
      expect(authorize.status()).toBe(302);
      const consent = new URL(authorize.headers().location);
      await check(ownerPage, consent.pathname + consent.search, () =>
        expect(
          ownerPage.getByRole('button', { name: '接続を許可する', exact: true }),
        ).toBeEnabled(),
      );
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
