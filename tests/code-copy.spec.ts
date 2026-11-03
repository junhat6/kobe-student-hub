import {test,expect} from '@playwright/test';
test('copies only the displayed code and reports completed success',async({page},info)=>{
 await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{(window as any).__copied=text}}})});
 await page.goto('/articles/git-branches');const pre=page.locator('.code-block pre');await expect(pre).toBeVisible();const code=await pre.textContent();expect(code).toContain('git switch -c try-new-title');
 await page.getByRole('button',{name:'コードをコピー',exact:true}).click();await expect(page.getByRole('status')).toHaveText('コピーしました');expect(await page.evaluate(()=>(window as any).__copied)).toBe(code);
 await page.screenshot({path:info.outputPath('copy-success.png'),fullPage:true,scale:'css'});
});
test('denied or unavailable clipboard offers explicit manual selection',async({page},info)=>{
 await page.addInitScript(()=>{const mode=new URL(location.href).searchParams.get('clipboard');Object.defineProperty(navigator,'clipboard',{configurable:true,value:mode==='unavailable'?undefined:{writeText:async()=>{throw new Error('private browser detail')}}})});
 for(const mode of ['denied','unavailable']){
  await page.goto('/articles/git-branches?clipboard='+mode);const pre=page.locator('.code-block pre');await expect(pre).toBeVisible();await page.getByRole('button',{name:'コードをコピー',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('コピーできませんでした');await expect(page.getByText('private browser detail')).toHaveCount(0);
  await page.getByRole('button',{name:'コードを選択',exact:true}).click();await expect(pre).toBeFocused();expect(await page.evaluate(()=>window.getSelection()?.getRangeAt(0).toString())).toBe(await pre.textContent());await expect(page.getByRole('status')).toContainText('コードを選択しました');
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('manual-selection.png'),fullPage:true,scale:'css'});
});
test('multiple blocks keep exact whitespace, inline code stays inline, pending is not success',async({page,request})=>{
 const data=await (await request.get('/api/catalog')).json();data.entries[0].body='`inline`\n\n```text\nfirst\n```\n\n```text\n  <script>literal</script>\n\t全角 text\n```';await page.route('**/api/catalog',r=>r.fulfill({json:data}));
 await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:(text:string)=>new Promise<void>(resolve=>{(window as any).__copied=text;(window as any).__finishCopy=resolve})}})});
 await page.goto('/articles/learning-notes');await expect(page.locator('.code-block')).toHaveCount(2);await expect(page.locator('.prose > p code')).toHaveText('inline');
 await page.getByRole('button',{name:'コードをコピー',exact:true}).nth(1).click();await expect(page.getByRole('button',{name:'コピー中…',exact:true})).toBeDisabled();await expect(page.getByText('コピーしました',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).__copied)).toBe('  <script>literal</script>\n\t全角 text\n');await expect(page.locator('.prose script')).toHaveCount(0);
 await page.evaluate(()=>(window as any).__finishCopy());await expect(page.getByText('コピーしました',{exact:true})).toBeVisible();
});
