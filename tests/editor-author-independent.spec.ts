import { test, expect, type Page } from '@playwright/test';
const origin = 'https://127.0.0.1:8788';
async function seed(page: Page) {
  await page.goto('/lab/articles/00000000-0000-4000-8000-000000000000');
  return page.evaluate(async () => {
    const session = (await (
      await fetch('/__fixture/profile-session', { method: 'POST' })
    ).json()) as { csrfToken: string };
    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer csrf.' + session.csrfToken,
    };
    async function post(path: string, value: unknown) {
      const r = await fetch(path, { method: 'POST', headers, body: JSON.stringify(value) });
      if (!r.ok) throw Error('fixture setup failed');
      return r.json() as Promise<{
        id: string;
        version: number;
        contentId: string;
        profile: { id: string };
      }>;
    }
    const p = await post('/api/private/profile', {
      displayName: '架空の活動投稿者',
      bio: '<script>window.authorInjected=true</script>',
      confirmPublic: true,
    });
    const ids = [];
    for (const title of ['最初の公開記事', '次に試せる公開記事']) {
      const d = await post('/api/private/drafts', {
        title,
        body: '# 架空の本文\n\n試すための手順',
      });
      const published = await post('/api/private/publications/' + d.id, {
        expectedVersion: d.version,
        confirmPublic: true,
        summary: '活動を試すための概要',
        tags: ['学び'],
        minutes: 5,
        prerequisite: '基本操作',
        outcome: '自分で試せる',
      });
      ids.push(published.contentId);
    }
    await post('/api/private/drafts', { title: '公開していない秘密の下書き', body: '秘密の本文' });
    return { authorId: p.profile.id as string, ids: ids as string[] };
  });
}
test('independent third report removes only that author article from fresh anonymous discovery', async ({
  page,
  browser,
}, info) => {
  const data = await seed(page),
    other = await seed(page);
  const device = info.project.use;
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: origin,
    viewport: page.viewportSize(),
    screen: device.screen,
    isMobile: device.isMobile,
    hasTouch: device.hasTouch,
    deviceScaleFactor: device.deviceScaleFactor,
    userAgent: device.userAgent,
  });
  try {
    const reader = await ctx.newPage();
    let privateCalls = 0;
    reader.on('request', (r) => {
      if (r.url().includes('/api/private/') || r.url().includes('/__fixture/')) privateCalls++;
      if (r.url().includes('/__lab/')) expect(r.headers().cookie).toBeUndefined();
    });
    await reader.goto('/lab/articles/' + data.ids[0]);
    await reader.getByRole('link', { name: '架空の活動投稿者', exact: true }).click();
    await expect(
      reader.getByRole('region', { name: 'この投稿者の公開記事' }).getByRole('article'),
    ).toHaveCount(2);
    await reader.screenshot({
      path: info.outputPath('01-author-two-public-articles.png'),
      fullPage: true,
      scale: 'css',
    });
    for (let n = 0; n < 3; n++) {
      const reporter = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: origin });
      try {
        const session = (await (
          await reporter.request.post('/__fixture/profile-session', {
            headers: { Origin: origin },
            data: {},
          })
        ).json()) as { csrfToken: string };
        const response = await reporter.request.post('/api/private/reports/' + data.ids[0], {
          headers: { Origin: origin, Authorization: 'Bearer csrf.' + session.csrfToken },
          data: { reason: '一覧除外を確かめる架空の理由' + n, detail: '一般に出さない架空の情報' },
        });
        expect(response.status()).toBe(200);
      } finally {
        await reporter.close();
      }
    }
    await reader.reload();
    await expect(
      reader.getByRole('region', { name: 'この投稿者の公開記事' }).getByRole('article'),
    ).toHaveCount(1);
    await expect(reader.getByRole('link', { name: '最初の公開記事', exact: true })).toHaveCount(0);
    const kept = reader.getByRole('link', { name: '次に試せる公開記事', exact: true });
    await expect(kept).toBeVisible();
    const projection = await ctx.request.get('/__lab/authors/' + data.authorId);
    expect(projection.status()).toBe(200);
    const value = (await projection.json()) as { entries: { id: string }[] };
    expect(value.entries.map((e) => e.id)).toEqual([data.ids[1]]);
    for (const id of other.ids) expect(JSON.stringify(value)).not.toContain(id);
    await expect(reader.getByText('公開していない秘密の下書き')).toHaveCount(0);
    await expect(reader.getByText('一般に出さない架空の情報')).toHaveCount(0);
    await reader.screenshot({
      path: info.outputPath('02-author-hidden-target-excluded.png'),
      fullPage: true,
      scale: 'css',
    });
    const tab = await ctx.newPage();
    await tab.goto((await kept.getAttribute('href'))!);
    await expect(
      tab.getByRole('heading', { name: '次に試せる公開記事', exact: true }),
    ).toBeVisible();
    await tab.goto('/lab/articles/' + data.ids[0]);
    await expect(
      tab.getByRole('heading', { name: 'この記事を表示できません', exact: true }),
    ).toBeVisible();
    await tab.screenshot({
      path: info.outputPath('03-hidden-target-unavailable.png'),
      fullPage: true,
      scale: 'css',
    });
    expect(tab.viewportSize()).toEqual(page.viewportSize());
    expect(await ctx.cookies()).toEqual([]);
    expect(privateCalls).toBe(0);
  } finally {
    await ctx.close();
  }
});
