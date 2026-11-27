import AxeBuilder from '@axe-core/playwright';
import { actor, write, type Actor } from './helpers/fictional-actor';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';

// #312: the article's 「書いた学生」 and the project's 「つくった学生」 are one card with the
// author's public counts and newest other works, without popularity totals, and the body keeps
// its width on a PC. Every actor is fictional.
async function seriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).include('.author-card').analyze();
  return violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(' ')) }));
}
async function publishArticle(author: Actor, title: string) {
  const draft = await write(author, '/api/private/drafts', { title, body: '架空の本文' });
  return write(author, '/api/private/publications/' + draft.id, {
    confirmPublic: true,
    summary: '架空の要約',
    tags: [],
    minutes: 1,
    audience: '',
    prerequisite: '',
    outcome: '',
    expectedVersion: draft.version,
  }) as Promise<{ contentId: string }>;
}
async function publishProject(author: Actor, title: string) {
  const draft = await write(author, '/api/private/project-drafts', {
    title,
    description: '架空の作品',
    githubUrl: '',
    demoUrl: '',
  });
  return write(author, '/api/private/project-publications/' + draft.id, {
    expectedVersion: draft.version,
    confirmPublic: true,
  }) as Promise<{ projectId: string }>;
}

test('the author card shows public counts and the newest other works on articles and projects', async ({
  browser,
  page,
}, info) => {
  test.setTimeout(90000);
  const contexts: BrowserContext[] = [];
  const key = info.project.name + '-' + Date.now().toString(36);
  const mobile = (page.viewportSize()?.width ?? 1280) < 720;
  try {
    const author = await actor(browser, contexts, '架空の作者カード-' + key);
    const first = await publishArticle(author, '最初の記事-' + key);
    const work = await publishProject(author, 'カードの作品-' + key);
    const latest = await publishArticle(author, '新しい記事-' + key);

    await page.goto('/articles/' + first.contentId);
    const card = page.locator('.author-card');
    await expect(card.getByRole('heading', { name: '書いた学生', exact: true })).toBeAttached();
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    await expect(card.locator('.author-card-counts')).toHaveText('公開中の記事 2 · 作品 1');
    const others = card.locator('.author-card-others li');
    await expect(others).toHaveText(['記事新しい記事-' + key, '作品カードの作品-' + key]);
    // 原則2: the kind is an icon; the word stays for screen readers only.
    await expect(others.locator('.author-card-kind svg')).toHaveCount(2);
    await expect(others.locator('.author-card-kind .sr-only')).toHaveText(['記事', '作品']);
    await expect(others.locator('.author-card-kind').first()).toHaveAttribute('title', '記事');
    await expect(card.getByRole('link', { name: '新しい記事-' + key })).toHaveAttribute(
      'href',
      '/articles/' + latest.contentId,
    );
    await expect(card.getByRole('link', { name: 'カードの作品-' + key })).toHaveAttribute(
      'href',
      '/projects/' + work.projectId,
    );
    await expect(card.getByText('最初の記事-' + key)).toHaveCount(0);
    await expect(card).not.toContainText(/フォロー|フォロワー|閲覧|いいね/);
    await expect(card.getByRole('link', { name: 'プロフィールを見る →' })).toHaveAttribute(
      'href',
      '/students/' + author.profileId,
    );
    // #314: after the body the card is the only way to the author; the like and share box
    // holds actions only, so the same person does not appear twice on a phone.
    await expect(page.locator('.article-end a[href^="/students/"]')).toHaveCount(0);
    await expect(page.getByText('この記事を書いた人')).toHaveCount(0);
    expect(
      await page.evaluate(
        (href) =>
          [...document.querySelectorAll(`a[href="${href}"]`)].filter(
            (a) => !a.closest('.detail-author, .author-card, header.topbar, nav'),
          ).length,
        '/students/' + author.profileId,
      ),
    ).toBe(0);
    expect.soft(await seriousViolations(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const prose = await page.locator('.prose').boundingBox();
    const box = await card.boundingBox();
    if (mobile) {
      // On a phone the card follows the body.
      expect(box!.y).toBeGreaterThan(prose!.y + prose!.height);
    } else {
      // The card sits beside the body without narrowing it below 720px (760px at most).
      expect(prose!.width).toBeGreaterThanOrEqual(720);
      expect(prose!.width).toBeLessThanOrEqual(760);
      expect(box!.x).toBeGreaterThan(prose!.x + prose!.width);
    }
    await page.screenshot({ path: info.outputPath('author-card-article.png'), fullPage: true });

    await page.goto('/projects/' + work.projectId);
    const projectCard = page.locator('.author-card');
    await expect(
      projectCard.getByRole('heading', { name: 'つくった学生', exact: true }),
    ).toBeAttached();
    await projectCard.scrollIntoViewIfNeeded();
    await expect(projectCard.locator('.author-card-counts')).toHaveText('公開中の記事 2 · 作品 1');
    await expect(projectCard.locator('.author-card-others li')).toHaveText([
      '記事新しい記事-' + key,
      '記事最初の記事-' + key,
    ]);
    await expect(projectCard.getByRole('link', { name: 'プロフィールを見る →' })).toHaveAttribute(
      'href',
      '/students/' + author.profileId + '/works',
    );
    expect.soft(await seriousViolations(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    // A long bio stops at four lines; the profile link carries the rest.
    await page.route('**/api/articles/' + first.contentId, async (route) => {
      const response = await route.fetch();
      const value = await response.json();
      value.author.bio = '長い自己紹介です。'.repeat(40);
      await route.fulfill({ response, json: value });
    });
    await page.goto('/articles/' + first.contentId);
    const bio = page.locator('.author-card .author-card-bio');
    await bio.scrollIntoViewIfNeeded();
    const lines = await bio.evaluate((element) => {
      const height = element.getBoundingClientRect().height;
      return height / parseFloat(getComputedStyle(element).lineHeight);
    });
    expect(lines).toBeLessThanOrEqual(4.05);
    expect(lines).toBeGreaterThan(3.5);
    await page.locator('.author-card').screenshot({ path: info.outputPath('author-card-bio.png') });
  } finally {
    for (const context of contexts) await context.close();
  }
});
