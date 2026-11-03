import {test,expect} from '@playwright/test';
test('copies only the displayed code and reports completed success',async({page},info)=>{
 await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{(window as any).__copied=text}}})});
 await page.goto('/articles/git-branches');const pre=page.locator('.code-block pre').first();await expect(pre).toBeVisible();const code=await pre.textContent();await expect(page.locator('.code-block')).toHaveCount(3);expect(code).toBe('git switch -c try-new-title\n');await expect(page.getByRole('heading',{name:'2. README.mdを編集して保存する'})).toBeVisible();
 await page.getByRole('button',{name:'コードをコピー',exact:true}).first().click();await expect(page.getByRole('status').first()).toHaveText('コピーしました');expect(await page.evaluate(()=>(window as any).__copied)).toBe(code);
 await page.screenshot({path:info.outputPath('copy-success.png'),fullPage:true,scale:'css'});
});
test('denied or unavailable clipboard offers explicit manual selection',async({page},info)=>{
 await page.addInitScript(()=>{const mode=new URL(location.href).searchParams.get('clipboard');Object.defineProperty(navigator,'clipboard',{configurable:true,value:mode==='unavailable'?undefined:{writeText:async()=>{throw new Error('private browser detail')}}})});
 for(const mode of ['denied','unavailable']){
  await page.goto('/articles/git-branches?clipboard='+mode);const pre=page.locator('.code-block pre').first();await expect(pre).toBeVisible();await page.getByRole('button',{name:'コードをコピー',exact:true}).first().click();
  await expect(page.getByRole('status').first()).toContainText('コピーできませんでした');await expect(page.getByText('private browser detail')).toHaveCount(0);
  await page.getByRole('button',{name:'コードを選択',exact:true}).first().click();await expect(pre).toBeFocused();expect(await page.evaluate(()=>window.getSelection()?.getRangeAt(0).toString())).toBe(await pre.textContent());await expect(page.getByRole('status').first()).toContainText('コードを選択しました');
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

test('manual selection is available during an unresolved write and late completion does not replace it',async({page},info)=>{
 await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>new Promise<void>((resolve,reject)=>{(window as any).__finishCopy=(failed:boolean)=>failed?reject(Error()):resolve()})}})});
 for(const failed of [false,true]){
  await page.goto('/articles/git-branches');const block=page.locator('.code-block').first();const pre=block.locator('pre');await expect(pre).toBeVisible();
  await block.getByRole('button',{name:'コードをコピー',exact:true}).click();await expect(block.getByRole('button',{name:'コピー中…'})).toBeDisabled();
  await block.getByRole('button',{name:'コードを選択',exact:true}).click();await expect(pre).toBeFocused();expect(await page.evaluate(()=>window.getSelection()?.getRangeAt(0).toString())).toBe(await pre.textContent());await expect(block.getByRole('status')).toContainText('コードを選択しました');
  await page.screenshot({path:info.outputPath('pending-manual.png'),fullPage:true,scale:'css'});
  await page.evaluate(failed=>(window as any).__finishCopy(failed),failed);await expect(block.getByRole('button',{name:'コードをコピー',exact:true})).toBeEnabled();await expect(block.getByRole('status')).toContainText('コードを選択しました');await expect(block.getByText('コピーしました',{exact:true})).toHaveCount(0);
 }
});
