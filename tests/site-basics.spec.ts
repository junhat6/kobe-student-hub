import { test, expect } from '@playwright/test';

// Static site files must be real files, not the SPA's index.html fallback.
test('site icons, manifest and robots.txt are served as their own types', async ({ request }) => {
  const expected: [string, RegExp][] = [
    ['/favicon.ico', /image\/(x-icon|vnd\.microsoft\.icon)/],
    ['/favicon.svg', /image\/svg\+xml/],
    ['/apple-touch-icon.png', /image\/png/],
    ['/icon-192.png', /image\/png/],
    ['/icon-512.png', /image\/png/],
    ['/icon-maskable-512.png', /image\/png/],
    ['/robots.txt', /text\/plain/],
  ];
  for (const [path, type] of expected) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['content-type'], path).toMatch(type);
  }
  const manifest = await request.get('/site.webmanifest');
  expect(manifest.status()).toBe(200);
  const body = await manifest.json();
  expect(body.name).toBe('Kobe Student Hub');
  expect(body.icons.map((icon: { src: string }) => icon.src)).toContain('/icon-512.png');
  expect(await (await request.get('/robots.txt')).text()).toContain('Disallow: /api/');
  // G05: the worker answers /sitemap.xml (only on the canonical https origin), never the SPA fallback.
  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.headers()['content-type']).not.toMatch(/text\/html/);
  expect(await sitemap.text()).not.toContain('<div id="root">');
});

test('every page names the operator and links to the disclaimer', async ({ page }) => {
  await page.goto('/about');
  const head = page.locator('head');
  await expect(head.locator('link[rel="icon"][href="/favicon.svg"]')).toHaveCount(1);
  await expect(head.locator('link[rel="manifest"]')).toHaveAttribute('href', '/site.webmanifest');
  const footer = page.getByRole('contentinfo');
  await expect(footer).toContainText('運営：Kobe Student Hub 運営委員会');
  await expect(footer).toContainText('学校公式サービスではありません');
  await footer.getByRole('link', { name: '免責事項', exact: true }).click();
  await expect(page).toHaveURL(/\/guide#disclaimer$/);
  const disclaimer = page.getByRole('heading', { name: '免責事項', exact: true });
  await expect(disclaimer).toBeVisible();
  await expect(disclaimer).toBeFocused();
  await expect(page.getByText('法令上責任を負う場合を除き', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: '運営者', exact: true })).toBeVisible();
  await expect(page.getByText('Kobe Student Hub 運営委員会', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

// G03: only /, /works and public article/project pages reach the Worker's index decision; this
// sample preview has no canonical https origin, so even those stay noindex. Every page keeps the
// static security headers and the SPA still renders.
test('listed pages go through the worker and the rest stay statically noindex', async ({
  page,
}) => {
  const listed = ['/', '/works', '/articles/0f8fad5b-d9cb-469f-a165-70867728950e'];
  for (const path of [...listed, '/search?q=x', '/students/sample-a', '/account', '/drafts']) {
    const response = await page.request.get(path);
    const headers = response.headers();
    expect(response.status(), path).toBe(200);
    expect(headers['x-robots-tag'], path).toBe('noindex, nofollow');
    expect(headers['x-frame-options'], path).toBe('DENY');
    expect(headers['content-security-policy'], path).toContain("form-action 'self'");
    expect(headers['cache-control'], path).toBe(
      listed.includes(path) ? 'no-cache' : 'public, max-age=0, must-revalidate',
    );
    expect(await response.text(), path).toContain('<meta name="robots" content="noindex,nofollow"');
  }
  await page.goto('/works');
  await expect(page.locator('#main')).toBeVisible();
});

// G04: the worker writes an article/project page's own title and canonical into index.html. They
// belong to that page only, so moving inside the SPA returns to the site-wide title and drops the
// canonical, and coming back restores them. The sample preview has no canonical origin, so the
// served head is stood in for by rewriting the document response.
test('a served page title and canonical stay with the page they were served for', async ({
  page,
}) => {
  const siteTitle = '学生の知恵と、つくる日々 | Kobe Student Hub';
  await page.route('/', async (route) => {
    const response = await route.fetch();
    const html = (await response.text())
      .replace(/<title>[^<]*<\/title>/, '<title>Served page | Kobe Student Hub</title>')
      .replace('</head>', '<link rel="canonical" href="https://hub.example.test/" /></head>');
    await route.fulfill({ response, body: html });
  });
  const canonical = page.locator('link[rel="canonical"]');
  await page.goto('/');
  await expect(page).toHaveTitle('Served page | Kobe Student Hub');
  await expect(canonical).toHaveCount(1);
  await page.locator('a[data-entry-id]').first().click();
  await expect(page).toHaveURL(/\/(articles|projects)\//);
  await expect(page).toHaveTitle(siteTitle);
  await expect(canonical).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page).toHaveTitle('Served page | Kobe Student Hub');
  await expect(canonical).toHaveCount(1);
});
