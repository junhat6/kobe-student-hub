import {test,expect} from '@playwright/test';
test('home → article → author → project → related article',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{name:'新しい知恵と、つくったもの'})).toBeVisible();
 await page.getByRole('heading',{name:'「動いた」で終わらせない、制作ノートの残し方'}).getByRole('link').click();
 await expect(page.getByRole('heading',{name:'この記事は、こんな人へ'})).toBeVisible();
 await page.getByRole('link',{name:/サンプルの先輩/}).first().click();await expect(page.getByRole('heading',{name:'サンプルの先輩',exact:true})).toBeVisible();
 await page.getByRole('link',{name:'一覧へ'}).click();await page.getByRole('button',{name:'作品',exact:true}).click();
 await expect(page.getByRole('article')).toHaveCount(1);await page.getByRole('heading',{name:'ひとこと制作ノート',exact:true}).getByRole('link').click();
 await expect(page.getByRole('heading',{name:'つながる記事・作品'})).toBeVisible();await page.getByRole('heading',{name:'「動いた」で終わらせない、制作ノートの残し方'}).getByRole('link').click();await expect(page).toHaveURL(/articles\/learning-notes/);
});
test('search, tag, no results, reset and browser back',async({page})=>{
 await page.goto('/search');await page.getByRole('searchbox').fill('Git');await page.getByRole('button',{name:'検索',exact:true}).click();await expect(page.getByRole('article')).toHaveCount(1);
 await page.getByRole('searchbox').fill('該当なし');await page.getByRole('button',{name:'検索',exact:true}).click();await expect(page.getByRole('heading',{name:'ぴったりの記事・作品が見つかりませんでした'})).toBeVisible();
 await page.getByRole('button',{name:'すべて表示する'}).click();await expect(page.getByRole('article')).toHaveCount(4);await page.goto('/search?tag=Git');await expect(page.getByRole('article')).toHaveCount(1);
 await page.getByRole('button',{name:'Gitの絞り込みを解除'}).click();await expect(page.getByRole('article')).toHaveCount(4);await page.goBack();await expect(page.getByRole('article')).toHaveCount(1);
});
test('deep links, malformed route, no overflow and honest preview',async({page})=>{
 await page.goto('/articles/git-branches');await expect(page.getByRole('heading',{name:'commitの次に知りたい、ブランチの考え方'})).toBeVisible();
 await expect(page.locator('pre').first()).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.goto('/articles/%E0%A4%A');await expect(page.getByRole('heading',{name:'ページが見つかりません'})).toBeVisible();
 await page.goto('/about');await expect(page.getByRole('heading',{name:'まだ提供していないこと'})).toBeVisible();
});
test('API outage has retry and independent about page',async({page})=>{
 await page.route('**/api/catalog',r=>r.fulfill({status:503,contentType:'application/json',body:'{}'}));await page.goto('/');await expect(page.getByRole('heading',{name:'記事・作品を読み込めませんでした'})).toBeVisible();
 await page.goto('/about');await expect(page.getByRole('heading',{name:'まだ提供していないこと'})).toBeVisible();
 await page.unroute('**/api/catalog');await page.goto('/');await expect(page.getByRole('article')).toHaveCount(4);
});
test('public projection, write gate and response headers',async({request})=>{
 const r=await request.get('/api/catalog');expect(r.ok()).toBe(true);const data=await r.json();expect(data.entries).toHaveLength(4);expect(JSON.stringify(data)).not.toMatch(/email|google_sub|draft|hidden|history|reporter|@st\./i);expect(r.headers()['cache-control']).toBe('no-store');
 expect((await request.post('/api/content',{data:{title:'unauthorized'}})).status()).toBe(405);
 const html=await request.get('/articles/git-branches');expect(html.headers()['content-security-policy']).toContain("frame-ancestors 'none'");expect(html.headers()['x-content-type-options']).toBe('nosniff');
});
test('Markdown rejects active HTML and script links',async({page,request})=>{
 const data=await (await request.get('/api/catalog')).json();data.entries[0].body='<script>window.__unsafe=true</script>\n\n<img src=x onerror="window.__unsafe=true">\n\n[unsafe](javascript:alert(1))';
 await page.route('**/api/catalog',r=>r.fulfill({json:data}));await page.goto('/articles/learning-notes');await expect(page.locator('.prose')).toBeVisible();await expect(page.locator('.prose script,.prose img,.prose a[href^="javascript:"]')).toHaveCount(0);
});
test('capture home and article evidence',async({page},testInfo)=>{
 await page.goto('/');await expect(page.getByRole('article')).toHaveCount(4);await page.screenshot({path:testInfo.outputPath('home.png'),fullPage:true,scale:'css'});
 await page.goto('/articles/git-branches');await expect(page.locator('pre').first()).toBeVisible();await page.screenshot({path:testInfo.outputPath('article.png'),fullPage:true,scale:'css'});
});
