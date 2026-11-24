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

    // #244 (C22 condition 5): the operator's 好み on the account page shows the ledger and counts
    // of the operator's own reviews, never the note text.
    const taste = (p: Page) => p.getByRole('region', { name: '好み', exact: true });
    await ops.goto('/account');
    const mine = taste(ops);
    await expect(mine).toBeVisible();
    await expect(mine.getByRole('heading', { name: '執筆の行' })).toBeVisible();
    await expect(mine.getByRole('heading', { name: 'アプリの行' })).toBeVisible();
    await expect(
      mine.getByRole('heading', { name: /あなたのレビュー（直近30日・1本）/ }),
    ).toBeVisible();
    await expect(mine.getByRole('definition').first()).toHaveText('1');
    const points = mine.getByRole('list', { name: '評価項目ごとの件数' });
    await expect(points).toContainText('体験が具体的1');
    await expect(points).toContainText('時期・値段などが足りない1');
    await expect(points).not.toContainText('本人の言葉');
    // C22 condition 5: no AI-written draft for this operator yet, so the plain zero state.
    await expect(mine).toContainText('直近30日に AI が書いた下書きはありません。');
    await expect(mine).not.toContainText('まだ数えられません');
    await expect(ops.locator('body')).not.toContainText('架空のひとこと-' + key);
    await expect(ops.locator('body')).not.toContainText('レビュー確認の記事-' + key);
    expect.soft(await seriousViolations(ops)).toEqual([]);
    expect(
      await ops.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await mine.scrollIntoViewIfNeeded();
    await ops.screenshot({ path: info.outputPath('editorial-taste.png'), scale: 'css' });
    // The counts as they render once AI drafts exist (the worker's numbers are covered in
    // tests/editorial-reviews.test.ts; here only the layout at this viewport is checked).
    const real = await (await operator.context.request.get('/api/private/editorial-taste')).json();
    await ops.route('**/api/private/editorial-taste', (route) =>
      route.fulfill({
        json: {
          ...real,
          aiDiff: {
            days: 30,
            drafts: 12,
            compared: 8,
            edited: 6,
            added: 148,
            removed: 37,
            published: 3,
            medianDaysToPublish: 2.5,
            approximate: true,
          },
        },
        headers: { 'Cache-Control': 'private, no-store' },
      }),
    );
    await ops.reload();
    const counts = taste(ops);
    await expect(counts.getByRole('definition').filter({ hasText: '148' })).toBeVisible();
    await expect(counts).toContainText('直した下書き6/8');
    await expect(counts).toContainText('公開までの日数2.5');
    await expect(counts).toContainText('AI が書いた下書き 12 本のうち新しい 8 本');
    await expect(counts).toContainText('行数はおおよそです');
    expect.soft(await seriousViolations(ops)).toEqual([]);
    expect(
      await ops.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await counts.getByRole('heading', { name: 'AI 下書きとの差' }).scrollIntoViewIfNeeded();
    await ops.screenshot({ path: info.outputPath('editorial-taste-ai-diff.png'), scale: 'css' });
    await ops.unroute('**/api/private/editorial-taste');
    // The author's own account page has no 好み, and the API answers others with 404.
    await own.goto('/account');
    await expect(own.getByRole('heading', { name: 'マイページ' })).toBeVisible();
    await expect(taste(own)).toHaveCount(0);
    expect((await author.context.request.get('/api/private/editorial-taste')).status()).toBe(404);
    expect((await page.request.get('/api/private/editorial-taste')).status()).toBe(404);
    const operatorRead = await operator.context.request.get('/api/private/editorial-taste');
    expect(operatorRead.status()).toBe(200);
    expect(await operatorRead.text()).not.toContain('架空のひとこと-' + key);

    // The review stays private: the author and a signed-out reader still see nothing.
    await own.goto(articlePath);
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

// #271 (first stage): the operator reviews one of their own drafts from its preview, reads the
// record back after a reload, and finds both review entrances from 好み. A student writing their
// own draft never sees the section, and nothing reaches the public API.
test('only an operator reviews their own draft in its preview and reads it back', async ({
  browser,
}, info) => {
  const contexts: BrowserContext[] = [];
  const key = info.project.name + '-' + Date.now().toString(36);
  const section = (p: Page) => p.getByRole('region', { name: '下書きレビュー（運営だけに表示）' });
  const note = '架空の下書きひとこと-' + key;
  const title = '架空の下書きレビュー-' + key;
  const viewport = info.project.use.viewport ?? { width: 1280, height: 900 };
  const openPreview = async (p: Page, name: string) => {
    await p.goto('/drafts');
    await p.getByRole('button', { name, exact: true }).click();
    await expect(p.getByRole('textbox', { name: 'タイトル' })).toHaveValue(name);
    await p.getByRole('button', { name: 'プレビュー', exact: true }).click();
    await expect(p.locator('.editor-preview')).toBeVisible();
  };
  try {
    // A student (not on the allowlist) previews their own draft: no section, the API is 404.
    const student = await actor(browser, contexts, '架空の学生-' + key);
    const own = await write(student, '/api/private/drafts', {
      title: '学生の' + title,
      body: '## 架空の本文\n\n学生の下書き。\n',
    });
    const mine = await student.context.newPage();
    await mine.setViewportSize(viewport);
    await openPreview(mine, '学生の' + title);
    await expect(mine.getByRole('heading', { name: '架空の本文' })).toBeVisible();
    await expect(section(mine)).toHaveCount(0);
    expect(
      (
        await student.context.request.get('/api/private/editorial-draft-reviews/' + own.id)
      ).status(),
    ).toBe(404);

    // The operator on their own draft.
    const operator = await actor(browser, contexts, '架空の運営者-' + key);
    await operator.context.setExtraHTTPHeaders({ 'X-Test-Operator-Subject': operator.subject });
    const draft = await write(operator, '/api/private/drafts', {
      title,
      body: '## 架空の見出し\n\n架空の下書きの本文。\n',
    });
    const ops = await operator.context.newPage();
    await ops.setViewportSize(viewport);
    // The operator cannot read another writer's draft review either.
    expect(
      (
        await operator.context.request.get('/api/private/editorial-draft-reviews/' + own.id)
      ).status(),
    ).toBe(404);
    await openPreview(ops, title);
    const review = section(ops);
    await expect(review).toBeVisible();
    await expect(review.getByRole('radiogroup', { name: 'この下書きは' })).toBeVisible();
    const save = review.getByRole('button', { name: 'レビューを記録', exact: true });
    await expect(save).toBeDisabled();
    await review.getByRole('radio', { name: '合わない' }).click();
    await review.getByRole('button', { name: '中身が薄い' }).click();
    await review.getByRole('button', { name: '本人の言葉' }).click();
    await review.getByRole('textbox', { name: 'ひとこと' }).fill(note);
    expect.soft(await seriousViolations(ops)).toEqual([]);
    await save.click();
    await expect(review.getByRole('button', { name: 'レビューを記録済み' })).toBeDisabled();
    await expect(review.getByRole('alert')).toHaveCount(0);
    expect(
      await ops.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await review.scrollIntoViewIfNeeded();
    await ops.screenshot({
      path: info.outputPath('editorial-draft-review-saved.png'),
      scale: 'css',
    });

    // Reload and open the preview again: the latest record comes back.
    await ops.reload();
    await openPreview(ops, title);
    const again = section(ops);
    await expect(again.getByRole('radio', { name: '合わない' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(again.getByRole('button', { name: '中身が薄い' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(again.getByRole('button', { name: '本人の言葉' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(again.getByRole('button', { name: '長い' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(again.getByRole('textbox', { name: 'ひとこと' })).toHaveValue(note);
    await expect(again.getByRole('button', { name: 'レビューを記録済み' })).toBeDisabled();

    // 好み shows the count and both review entrances; never the note or the draft title.
    await ops.goto('/account');
    const taste = ops.getByRole('region', { name: '好み', exact: true });
    await expect(taste).toBeVisible();
    await expect(taste).toContainText('下書きのレビューは直近30日に 1 本です。');
    const entries = taste.getByRole('navigation', { name: 'レビューする場所' });
    await expect(entries.getByRole('link', { name: /下書きのプレビュー/ })).toHaveAttribute(
      'href',
      '/drafts',
    );
    await expect(entries.getByRole('link', { name: /公開記事のページ/ })).toHaveAttribute(
      'href',
      '/',
    );
    await expect(ops.locator('body')).not.toContainText(note);
    await expect(ops.locator('body')).not.toContainText(title);
    expect.soft(await seriousViolations(ops)).toEqual([]);
    expect(
      await ops.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await entries.scrollIntoViewIfNeeded();
    await ops.screenshot({ path: info.outputPath('editorial-taste-entries.png'), scale: 'css' });
    await entries.getByRole('link', { name: /下書きのプレビュー/ }).click();
    await expect(ops).toHaveURL(/\/drafts$/);

    // Nothing reaches public reads, the student, or a signed-out reader.
    for (const path of ['/api/articles', '/api/search?q=' + encodeURIComponent(note)]) {
      const r = await student.context.request.get(path);
      expect(await r.text()).not.toContain(note);
    }
    await mine.reload();
    await openPreview(mine, '学生の' + title);
    await expect(section(mine)).toHaveCount(0);
    expect(
      (
        await student.context.request.get('/api/private/editorial-draft-reviews/' + draft.id)
      ).status(),
    ).toBe(404);
    const anonymous = await browser.newContext({
      baseURL: 'https://127.0.0.1:8790',
      ignoreHTTPSErrors: true,
    });
    contexts.push(anonymous);
    expect(
      (await anonymous.request.get('/api/private/editorial-draft-reviews/' + draft.id)).status(),
    ).toBe(404);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
