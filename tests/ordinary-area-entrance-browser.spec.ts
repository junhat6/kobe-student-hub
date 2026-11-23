import AxeBuilder from '@axe-core/playwright';
import { actor, write, type Actor } from './helpers/fictional-actor';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';

// #194 / DECISIONS 2026-11-22「北野川線沿い」3: the area entrance appears on the home page only
// once three published articles carry both 北野川線沿い and ごはん. Fictional articles written
// through the HTTPS fixture's real API; no sample review is shipped.
const AREA = '北野川線沿い',
  KIND = 'ごはん',
  TITLE = '北野川線沿いのごはん';

async function publish(owner: Actor, title: string) {
  const draft = await write(owner, '/api/private/drafts', {
    title,
    body: '## 架空の本文\n\nテスト用の架空の記事です。',
  });
  await write(owner, '/api/private/publications/' + draft.id, {
    expectedVersion: draft.version,
    confirmPublic: true,
    summary: '架空の要約',
    tags: [AREA, KIND],
    minutes: 1,
    audience: '',
    prerequisite: '',
    outcome: '',
  });
}

// The fixture is shared by both projects, so count what earlier runs already published.
async function published(page: Page) {
  const response = await page.request.get('/api/discovery');
  expect(response.status()).toBe(200);
  const { recent } = (await response.json()) as { recent: { entry: { tags: string[] } }[] };
  return recent.filter(({ entry }) => entry.tags.includes(AREA) && entry.tags.includes(KIND))
    .length;
}

async function home(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '記事', exact: true })).toBeVisible();
  await expect(page.locator('.card-grid').first()).toBeVisible();
}

test('the 北野川線沿い meal entrance is hidden at two articles and leads to the area at three', async ({
  page,
  browser,
}, info) => {
  const contexts: BrowserContext[] = [];
  const key = 'area-' + info.project.name + '-' + Date.now().toString(36);
  try {
    const owner = await actor(browser, contexts, '架空の書き手-' + key);
    let count = await published(page);
    if (count <= 2) {
      for (; count < 2; count++) await publish(owner, '架空の店の記録-' + key + '-' + count);
      expect(await published(page)).toBe(2);
      await home(page);
      await expect(page.getByRole('link', { name: new RegExp('^' + TITLE) })).toHaveCount(0);
      await expect(page.locator('.home-area')).toHaveCount(0);
    }
    // Always publish at least one, so the search result below checks an article of this run.
    const last = '架空の店の記録-' + key + '-last';
    for (; count < 2; count++) await publish(owner, '架空の店の記録-' + key + '-' + count);
    await publish(owner, last);
    const total = await published(page);
    await home(page);
    const entrance = page.getByRole('link', { name: new RegExp('^' + TITLE) });
    await expect(entrance).toBeVisible();
    await expect(entrance).toContainText(
      '三宮の北、加納町・生田のあたりを南北に走る通り沿いの店のレビュー',
    );
    await expect(entrance).toContainText(String(total) + '件');
    const box = (await entrance.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.waitForFunction(() =>
      document
        .getAnimations()
        .every((a) => !(a instanceof CSSTransition) || a.playState !== 'running'),
    );
    const { violations } = await new AxeBuilder({ page }).include('.home-area').analyze();
    expect(
      violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => v.id),
    ).toEqual([]);
    await entrance.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath('area-entrance.png'),
      fullPage: false,
      scale: 'css',
    });
    await entrance.click();
    await expect(page).toHaveURL(/\/search\?tag=/);
    expect(new URL(page.url()).searchParams.get('tag')).toBe(AREA);
    await expect(page.getByRole('link', { name: last, exact: true })).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
