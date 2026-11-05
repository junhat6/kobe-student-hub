import {test,expect} from '@playwright/test';
test('local signed Google login, private save, reload/resume and logout',async({page},info)=>{
 let returned=false,delayed=false;
 await page.route('**/api/private/session',async route=>{if(returned&&!delayed){delayed=true;await new Promise(resolve=>setTimeout(resolve,5500))}await route.continue()});
 await page.route('https://accounts.google.com/**',async route=>{returned=true;const u=new URL(route.request().url());expect(u.searchParams.get('prompt')).toBe('select_account');await route.fulfill({status:303,headers:{Location:'https://127.0.0.1:8792/api/auth/callback?state='+u.searchParams.get('state')+'&code='+u.searchParams.get('nonce')}})});
 await page.goto('/');await page.getByRole('button',{name:'Googleで限定ログイン'}).click();await expect(page).toHaveURL('https://127.0.0.1:8792/');await expect(page.getByRole('button',{name:'新しい下書き',exact:true})).toBeVisible({timeout:12000});
 await page.getByRole('button',{name:'新しい下書き',exact:true}).click();await page.getByLabel('タイトル',{exact:true}).fill('Limited private '+info.project.name);await page.getByLabel('Markdown本文',{exact:true}).fill('Saved on this browser, never published.');
 await page.getByRole('button',{name:'下書きを保存',exact:true}).click();await expect(page.getByRole('button',{name:'Limited private '+info.project.name,exact:true})).toBeVisible();
 expect(await page.getByRole('button',{name:'公開の準備'}).count()).toBe(0);await page.reload();await page.getByRole('button',{name:'Limited private '+info.project.name,exact:true}).click();await expect(page.getByLabel('Markdown本文',{exact:true})).toHaveValue('Saved on this browser, never published.');
 await page.screenshot({path:test.info().outputPath('private-draft.png'),fullPage:true});
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'このブラウザをログアウト'}).click();await expect(page.getByLabel('Markdown本文',{exact:true})).toHaveCount(0);expect((await page.request.get('/api/private/drafts')).status()).toBe(401);
});
