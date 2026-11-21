import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

// C19: every public reading screen must have no critical/serious axe violations.
async function seriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(' ')) }));
}

const screens: { name: string; path: string; ready: (page: Page) => Promise<void> }[] = [
  {
    name: 'home',
    path: '/',
    ready: (page) =>
      expect(page.getByRole('heading', { name: '新しい知恵と、つくったもの' })).toBeVisible(),
  },
  {
    name: 'search',
    path: '/search?q=Git',
    ready: (page) => expect(page.getByRole('article')).toHaveCount(1),
  },
  {
    name: 'search with no results',
    path: '/search?q=該当なし',
    ready: (page) =>
      expect(
        page.getByRole('heading', { name: 'ぴったりの記事・作品が見つかりませんでした' }),
      ).toBeVisible(),
  },
  {
    name: 'author profile',
    path: '/students/sample-a',
    ready: (page) =>
      expect(page.getByRole('heading', { name: 'サンプルの先輩', exact: true })).toBeVisible(),
  },
  {
    name: 'article',
    path: '/articles/learning-notes',
    // Wait for the highlighted code blocks too, so axe sees the final scroll containers.
    ready: async (page) => {
      await expect(page.getByRole('heading', { name: 'この記事は、こんな人へ' })).toBeVisible();
      await expect(page.locator('.prose pre code.hljs').first()).toBeVisible();
    },
  },
  {
    name: 'project',
    path: '/projects/tiny-notes',
    ready: (page) =>
      expect(page.getByRole('heading', { name: 'つながる記事・作品' })).toBeVisible(),
  },
  {
    name: 'about',
    path: '/about',
    ready: (page) =>
      expect(page.getByRole('heading', { name: 'まだ提供していないこと' })).toBeVisible(),
  },
  {
    name: 'not found',
    path: '/articles/%E0%A4%A',
    ready: (page) =>
      expect(page.getByRole('heading', { name: 'ページが見つかりません' })).toBeVisible(),
  },
];

for (const screen of screens) {
  test(`${screen.name} has no critical or serious axe violations`, async ({ page }) => {
    await page.goto(screen.path);
    await screen.ready(page);
    expect(await seriousViolations(page)).toEqual([]);
  });
}
