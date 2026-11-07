import {test,expect} from '@playwright/test';
test('local signed Google login, private save, reload/resume and logout',async({page},info)=>{
 let returned=false,delayed=false;
 await page.route('**/api/private/session',async route=>{if(returned&&!delayed){delayed=true;await new Promise(resolve=>setTimeout(resolve,5500))}await route.continue()});
 await page.route('https://accounts.google.com/**',async route=>{returned=true;const u=new URL(route.request().url());expect(u.searchParams.get('prompt')).toBe('select_account');await route.fulfill({status:303,headers:{Location:'https://127.0.0.1:8792/api/auth/callback?state='+u.searchParams.get('state')+'&code='+u.searchParams.get('nonce')}})});
 await page.goto('/api/auth/draft-trial');await page.getByRole('button',{name:'Googleで限定ログイン'}).click();await expect(page).toHaveURL('https://127.0.0.1:8792/api/auth/draft-trial');await expect(page.getByRole('button',{name:'新しい下書き',exact:true})).toBeVisible({timeout:12000});
 await page.getByRole('button',{name:'新しい下書き',exact:true}).click();await page.getByLabel('タイトル',{exact:true}).fill('Limited private '+info.project.name);await page.getByLabel('Markdown本文',{exact:true}).fill('Saved on this browser, never published.');
 await page.getByRole('button',{name:'下書きを保存',exact:true}).click();await expect(page.getByRole('button',{name:'Limited private '+info.project.name,exact:true})).toBeVisible();
 expect(await page.getByRole('button',{name:'公開の準備'}).count()).toBe(0);await page.reload();await page.getByRole('button',{name:'Limited private '+info.project.name,exact:true}).click();await expect(page.getByLabel('Markdown本文',{exact:true})).toHaveValue('Saved on this browser, never published.');
 await page.screenshot({path:test.info().outputPath('private-draft.png'),fullPage:true});
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'このブラウザをログアウト'}).click();await expect(page.getByLabel('Markdown本文',{exact:true})).toHaveCount(0);expect((await page.request.get('/api/private/drafts')).status()).toBe(401);
});
test('pending trial hides unsaved buffer during network uncertainty and discards it after session change',async({page})=>{
 await page.route('https://accounts.google.com/**',async route=>{const u=new URL(route.request().url());await route.fulfill({status:303,headers:{Location:'https://127.0.0.1:8792/api/auth/callback?state='+u.searchParams.get('state')+'&code='+u.searchParams.get('nonce')}})});
 await page.goto('/api/auth/draft-trial');await page.getByRole('button',{name:'Googleで限定ログイン'}).click();await expect(page.getByRole('button',{name:'新しい下書き',exact:true})).toBeVisible({timeout:12000});await page.getByRole('button',{name:'新しい下書き',exact:true}).click();const body=page.getByLabel('Markdown本文',{exact:true});await body.fill('未保存の架空の文章');
 await page.route('**/api/private/session',route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.locator('.session-private')).toBeHidden();expect(await page.locator('#draft-body').inputValue()).toBe('未保存の架空の文章');
 await page.unroute('**/api/private/session');await page.getByRole('button',{name:'セッションを再確認'}).click();await expect(body).toHaveValue('未保存の架空の文章');await expect(page.getByText('同じセッションを確認しました。手元の編集を保持して再開しています。')).toBeVisible();await expect(page.getByRole('button',{name:'セッションを再確認'})).toBeEnabled();
 await page.route('**/api/private/session',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({csrfToken:'A'.repeat(43)})}));await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.locator('#draft-body')).toHaveCount(0);await expect(page.getByText(/別のセッションを確認したため/)).toBeVisible();
});
for(const action of ['revoke','expire'] as const)test('pending trial '+action+' closes session and private editor',async({page})=>{
 await page.context().request.post('/api/__fixture/grant?action=restore');
 await page.route('https://accounts.google.com/**',async route=>{const u=new URL(route.request().url());await route.fulfill({status:303,headers:{Location:'https://127.0.0.1:8792/api/auth/callback?state='+u.searchParams.get('state')+'&code='+u.searchParams.get('nonce')}})});
 await page.goto('/api/auth/draft-trial');await page.getByRole('button',{name:'Googleで限定ログイン'}).click();await expect(page.getByRole('button',{name:'新しい下書き',exact:true})).toBeVisible({timeout:12000});await page.getByRole('button',{name:'新しい下書き',exact:true}).click();await page.getByLabel('Markdown本文',{exact:true}).fill('限定試用の未保存の文章');
 await page.context().request.post('/api/__fixture/grant?action='+action);expect((await page.context().request.get('/api/private/session')).status()).toBe(401);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.locator('#draft-body')).toHaveCount(0);await page.context().request.post('/api/__fixture/grant?action=restore');
});

// Simulates stalled response headers/body and deliberately non-cooperative adapters.
// The real production entry/assets still render the UI; no Google request escapes the test.
async function stalledLogin(page:import('@playwright/test').Page,phase:string){
 await page.addInitScript(phase=>{
  const real=window.fetch.bind(window),calls:{attempt:number;path:string}[]=[],signals:AbortSignal[]=[];
  let attempt=0,releaseOld=()=>{},releaseRetry=()=>{};
  const result=(path:string)=>path.includes('bootstrap')?new Response(null,{status:204}):Response.json(path.includes('command')?{commandToken:'A'.repeat(43)}:{authorizationUrl:'https://accounts.google.com/o/oauth2/v2/auth?synthetic='+attempt});
  window.fetch=async(input,init)=>{
   const path=String(input);if(!path.startsWith('/api/auth/'))return real(input,init);
   if(path.includes('bootstrap'))attempt++;
   calls.push({attempt,path});signals.push(init!.signal!);
   if(attempt===2&&path.includes('bootstrap'))return await new Promise<Response>(resolve=>{releaseRetry=()=>resolve(result(path))});
   const stage=path.includes('bootstrap')?'bootstrap':path.includes('command')?'command':'start';
   if(attempt!==1||!phase.startsWith(stage))return result(path);
   if(phase.endsWith('headers'))return await new Promise<Response>(resolve=>{releaseOld=()=>resolve(result(path))});
   const response=result(path),bytes=new TextEncoder().encode(JSON.stringify(stage==='command'?{commandToken:'A'.repeat(43)}:{authorizationUrl:'https://accounts.google.com/o/oauth2/v2/auth?synthetic=old'}));let first=true;
   // Ignore cancel intentionally, proving invalidation is not dependent on fetch abort support.
   Object.defineProperty(response,'body',{value:{getReader:()=>({read:()=>first?(first=false,new Promise(resolve=>{releaseOld=()=>resolve({done:false,value:bytes})})):Promise.resolve({done:true}),cancel:()=>new Promise<void>(()=>{}),releaseLock:()=>{}}),cancel:()=>Promise.resolve()}});return response;
  };
  Object.assign(window,{limitedLoginFixture:{calls,signals,releaseOld:()=>releaseOld(),releaseRetry:()=>releaseRetry()}});
 },phase);
 await page.route('https://accounts.google.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<h1>Synthetic provider reached</h1>'}));
 await page.goto('/api/auth/draft-trial');
}
async function loginCalls(page:import('@playwright/test').Page){return page.evaluate(()=>((window as unknown as {limitedLoginFixture:{calls:unknown[]}}).limitedLoginFixture.calls).length)}
async function releaseLogin(page:import('@playwright/test').Page,which:'releaseOld'|'releaseRetry'){await page.evaluate(which=>(window as unknown as {limitedLoginFixture:Record<string,()=>void>}).limitedLoginFixture[which](),which)}
for(const phase of ['bootstrap-headers','command-headers','command-body','start-headers','start-body'])test('login deadline releases '+phase+' and late result cannot supersede retry',async({page})=>{
 await page.clock.install();await stalledLogin(page,phase);
 const login=page.getByRole('button',{name:'Googleで限定ログイン',exact:true});await login.click();
 const count=phase.startsWith('bootstrap')?1:phase.startsWith('command')?2:3;
 await expect.poll(()=>loginCalls(page)).toBe(count);await expect(login).toBeDisabled();
 await page.clock.fastForward(10001);await expect(login).toBeEnabled();await expect(page.getByRole('status')).toContainText('時間がかかったため中止');
 expect(await page.evaluate(()=>(window as unknown as {limitedLoginFixture:{signals:AbortSignal[]}}).limitedLoginFixture.signals.every(signal=>signal.aborted))).toBe(true);
 if(phase==='start-body')await page.screenshot({path:test.info().outputPath('login-timeout.png'),fullPage:true});
 await login.click();await expect.poll(()=>loginCalls(page)).toBe(count+1);await expect(login).toBeDisabled();
 await releaseLogin(page,'releaseOld');await page.clock.runFor(20);await expect(page).toHaveURL(/\/api\/auth\/draft-trial$/);expect(await loginCalls(page)).toBe(count+1);await expect(page.getByRole('status')).toHaveText('認証を開始しています…');await expect(login).toBeDisabled();
 if(phase==='start-body')await page.screenshot({path:test.info().outputPath('login-timeout-retry.png'),fullPage:true});
 await releaseLogin(page,'releaseRetry');await expect(page).toHaveURL(/accounts\.google\.com.*synthetic=2/);await expect(page.getByRole('heading',{name:'Synthetic provider reached'})).toBeVisible();
});
for(const phase of ['bootstrap-headers','command-body','start-body'])test('explicit cancel releases '+phase+' without a late redirect or automatic retry',async({page})=>{
 await stalledLogin(page,phase);const login=page.getByRole('button',{name:'Googleで限定ログイン',exact:true});await login.click();const count=phase.startsWith('bootstrap')?1:phase.startsWith('command')?2:3;await expect.poll(()=>loginCalls(page)).toBe(count);
 // A rapid repeated click cannot launch another operation while locked.
 await login.dispatchEvent('click');expect(await loginCalls(page)).toBe(count);
 await page.getByRole('button',{name:'認証の開始を中止',exact:true}).click();await expect(login).toBeEnabled();await expect(page.getByRole('status')).toContainText('認証の開始を中止しました');
 await releaseLogin(page,'releaseOld');await expect(page).toHaveURL(/\/api\/auth\/draft-trial$/);expect(await loginCalls(page)).toBe(count);await expect(page.getByRole('status')).toContainText('認証の開始を中止しました');
});
for(const event of ['pagehide','back-forward','hidden'])test('leaving via '+event+' invalidates login and remains retryable',async({page})=>{
 await stalledLogin(page,'start-body');const login=page.getByRole('button',{name:'Googleで限定ログイン',exact:true});
 if(event==='back-forward')await page.evaluate(()=>history.pushState({},'',location.pathname+'?newer-view=1'));
 await login.click();await expect.poll(()=>loginCalls(page)).toBe(3);
 if(event==='back-forward')await page.goBack();else await page.evaluate(event=>{if(event==='hidden'){Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))}else window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}))},event);
 await expect(login).toBeEnabled();await releaseLogin(page,'releaseOld');await expect(page).toHaveURL(/\/api\/auth\/draft-trial$/);expect(await loginCalls(page)).toBe(3);
 if(event==='back-forward'){await page.goForward();await expect(page).toHaveURL(/newer-view=1/);await expect(login).toBeEnabled()}
 if(event==='pagehide')await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
 await expect(page.getByRole('status')).toContainText('認証の開始を中止しました');
});
