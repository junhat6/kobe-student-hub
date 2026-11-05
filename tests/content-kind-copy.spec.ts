import {test,expect} from '@playwright/test';

for(const detail of [
 {path:'/articles/learning-notes',reader:'この記事は、こんな人へ',author:'書いた学生',otherReader:'この作品は、こんな人へ',otherAuthor:'つくった学生'},
 {path:'/projects/tiny-notes',reader:'この作品は、こんな人へ',author:'つくった学生',otherReader:'この記事は、こんな人へ',otherAuthor:'書いた学生'}
])test(`detail copy follows its content kind: ${detail.path}`,async({page,request})=>{
 const catalog=await (await request.get('/api/catalog')).json();
 const entry=catalog.entries.find((e:{id:string})=>detail.path.endsWith('/'+e.id));
 expect(entry).toBeTruthy();
 await page.goto(detail.path);
 await expect(page.getByRole('heading',{name:detail.reader,exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:detail.author,exact:true,includeHidden:true})).toHaveText(detail.author);
 await expect(page.locator('.detail-author .author')).toBeVisible();
 await expect(page.getByRole('heading',{name:detail.otherReader,exact:true})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:detail.otherAuthor,exact:true})).toHaveCount(0);
 // A single-entry catalog has no related content of either kind.
 await page.route('**/api/catalog',route=>route.fulfill({json:{...catalog,entries:[entry]}}));
 await page.reload();
 await expect(page.getByText('関連する記事・作品はまだありません。',{exact:false})).toBeVisible();
});

test('mixed listing preserves article and project labels',async({page})=>{
 await page.goto('/search');
 await expect(page.getByRole('article')).toHaveCount(4);
 await expect(page.locator('.eyebrow').getByText('記事',{exact:true})).toHaveCount(3);
 await expect(page.locator('.eyebrow').getByText('作品',{exact:true})).toHaveCount(1);
 await page.getByRole('button',{name:'作品',exact:true}).click();
 await expect(page.getByRole('article')).toHaveCount(1);
 await page.getByRole('button',{name:'記事',exact:true}).click();
 await expect(page.getByRole('article')).toHaveCount(3);
 await page.getByRole('button',{name:'すべて',exact:true}).click();
 await expect(page.getByRole('article')).toHaveCount(4);
});

for(const empty of [
 {kind:'article',label:'記事'}, {kind:'project',label:'作品'}, {kind:'all',label:'記事・作品'}
])test(`empty search names the selected content kind: ${empty.kind}`,async({page})=>{
 await page.goto(`/search?kind=${empty.kind}&q=存在しない検索語`);
 await expect(page.getByRole('article')).toHaveCount(0);
 await expect(page.getByRole('heading',{name:`ぴったりの${empty.label}が見つかりませんでした`,exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:empty.kind==='all'?'すべて':empty.label,exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'すべて表示する',exact:true}).click();
 await expect(page.getByRole('article')).toHaveCount(4);
 await expect(page.getByRole('searchbox')).toHaveValue('');
 await expect(page.getByRole('button',{name:'すべて',exact:true})).toHaveAttribute('aria-pressed','true');
});
