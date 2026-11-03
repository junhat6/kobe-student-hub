import {test,expect} from '@playwright/test';
test('failed body chunk preserves navigation and recovers after reload',async({page},testInfo)=>{
 await page.route('**/assets/MarkdownRenderer-*.js',route=>route.fulfill({status:503,contentType:'text/javascript',body:''}));
 await page.goto('/articles/git-branches');
 await expect(page.getByRole('heading',{name:'本文を読み込めませんでした'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'commitの次に知りたい、ブランチの考え方'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'この記事は、こんな人へ'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('body-unavailable.png'),fullPage:true,scale:'css'});
 await page.getByRole('link',{name:'ほかの記事を探す'}).click();
 await expect(page.getByRole('heading',{name:'新しい知恵と、つくったもの'})).toBeVisible();
 await page.getByRole('heading',{name:'commitの次に知りたい、ブランチの考え方'}).getByRole('link').click();
 await expect(page.getByRole('alert')).toContainText('本文を読み込めませんでした');
 await page.unroute('**/assets/MarkdownRenderer-*.js');
 await page.getByRole('button',{name:'ページを再読み込み'}).click();
 await expect(page.locator('pre').first()).toBeVisible();
 await expect(page.getByRole('heading',{name:'本文を読み込めませんでした'})).toHaveCount(0);
 await page.screenshot({path:testInfo.outputPath('body-recovered.png'),fullPage:true,scale:'css'});
});
