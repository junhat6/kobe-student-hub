import AxeBuilder from '@axe-core/playwright';
import { actor, write } from './helpers/fictional-actor';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';

// #220 (C22 condition 1): only a server-listed operator sees the editorial review under a
// published article, records it, and reads it back after a reload. The author, another student
// and signed-out readers never see the section, and its API answers them with a 404.
async function seriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(' ')) }));
}

test('only an operator records an editorial review and reads it back', async ({
  browser,
  page,
}, info) => {
  const contexts: BrowserContext[] = [];
  const key = info.project.name + '-' + Date.now().toString(36);
  const section = (p: Page) => p.getByRole('region', { name: '編集レビュー（運営だけに表示）' });
  try {
    const author = await actor(browser, contexts, '架空のレビューされる投稿者-' + key);
    const draft = await write(author, '/api/private/drafts', {
      title: 'レビュー確認の記事-' + key,
      body: '## 架空の本文\n\n架空の体験を書いた。\n',
    });
    const article = await write(author, '/api/private/publications/' + draft.id, {
      confirmPublic: true,
      summary: '架空の要約',
      tags: ['レビュー'],
      minutes: 1,
      audience: '',
      prerequisite: '',
      outcome: '',
      expectedVersion: draft.version,
    });
    const articlePath = '/articles/' + article.contentId;
    const apiPath = '/api/private/editorial-reviews/' + article.contentId;
    const heading = (p: Page) =>
      p.getByRole('heading', { name: 'レビュー確認の記事-' + key, level: 1 });

    // Signed-out reader: the article renders, the review section does not.
    await page.goto(articlePath);
    await expect(heading(page)).toBeVisible();
    await expect(section(page)).toHaveCount(0);

    // The author is a signed-in student but not on the allowlist: no section, API is 404.
    const own = await author.context.newPage();
    await own.setViewportSize(page.viewportSize()!);
    await own.goto(articlePath);
    await expect(heading(own)).toBeVisible();
    await expect(own.getByRole('button', { name: 'アカウントメニュー' })).toBeVisible();
    await expect(section(own)).toHaveCount(0);
    expect((await author.context.request.get(apiPath)).status()).toBe(404);

    // A server-listed operator. The header is a fixture-only stand-in for the allowlist.
    const operator = await actor(browser, contexts, '架空の運営者-' + key);
    await operator.context.setExtraHTTPHeaders({ 'X-Test-Operator-Subject': operator.subject });
    const ops = await operator.context.newPage();
    await ops.setViewportSize(page.viewportSize()!);
    await ops.goto(articlePath);
    const review = section(ops);
    await expect(review).toBeVisible();
    const save = review.getByRole('button', { name: 'レビューを記録', exact: true });
    await expect(save).toBeDisabled();
    await review.getByRole('radio', { name: '良い' }).click();
    await review.getByRole('button', { name: '体験が具体的' }).click();
    await review.getByRole('button', { name: '時期・値段などが足りない' }).click();
    await review.getByRole('textbox', { name: 'ひとこと' }).fill('架空のひとこと-' + key);
    expect.soft(await seriousViolations(ops)).toEqual([]);
    await save.click();
    await expect(review.getByRole('button', { name: 'レビューを記録済み' })).toBeDisabled();
    await expect(review.getByRole('alert')).toHaveCount(0);
    await review.scrollIntoViewIfNeeded();
    await ops.screenshot({ path: info.outputPath('editorial-review-saved.png'), scale: 'css' });

    // Reload: the latest review comes back as recorded.
    await ops.reload();
    const again = section(ops);
    await expect(again.getByRole('radio', { name: '良い' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(again.getByRole('radio', { name: '合わない' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(again.getByRole('button', { name: '体験が具体的' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(again.getByRole('button', { name: '時期・値段などが足りない' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(again.getByRole('button', { name: '本人の言葉' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(again.getByRole('textbox', { name: 'ひとこと' })).toHaveValue(
      '架空のひとこと-' + key,
    );
    await expect(again.getByRole('button', { name: 'レビューを記録済み' })).toBeDisabled();
    // The page never shows who the operator is or the school address.
    const text = await ops.locator('body').innerText();
    for (const value of [operator.subject, author.subject, 'st.kobedenshi.ac.jp'])
      expect(text).not.toContain(value);
    // No horizontal scroll at this viewport.
    expect(
      await ops.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    // The review stays private: the author and a signed-out reader still see nothing.
    await own.reload();
    await expect(heading(own)).toBeVisible();
    await expect(section(own)).toHaveCount(0);
    await page.reload();
    await expect(heading(page)).toBeVisible();
    await expect(section(page)).toHaveCount(0);
    expect((await page.request.get(apiPath)).status()).toBe(404);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
