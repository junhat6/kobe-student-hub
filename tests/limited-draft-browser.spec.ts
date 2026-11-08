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

async function deletionLogin(page:import('@playwright/test').Page){
 await page.context().request.post('/api/__fixture/grant?action=restore');
 await page.route('https://accounts.google.com/**',async route=>{const u=new URL(route.request().url());await route.fulfill({status:303,headers:{Location:'https://127.0.0.1:8792/api/auth/callback?state='+u.searchParams.get('state')+'&code='+u.searchParams.get('nonce')}})});
 await page.goto('/api/auth/draft-trial');await page.getByRole('button',{name:'Googleで限定ログイン',exact:true}).click();await expect(page.getByRole('button',{name:'新しい下書き',exact:true})).toBeVisible();
}
async function deletionDraft(page:import('@playwright/test').Page,title:string){
 await page.getByRole('button',{name:'新しい下書き',exact:true}).click();await page.getByLabel('タイトル',{exact:true}).fill(title);await page.getByLabel('Markdown本文',{exact:true}).fill('保存した架空本文');await page.getByRole('button',{name:'下書きを保存',exact:true}).click();await expect(page.getByRole('status').last()).toHaveText('下書きを保存しました。');
 const list=await (await page.request.get('/api/private/drafts')).json() as {id:string;title:string;version:number}[];
 return list.find(row=>row.title===title)!;
}
test('private draft deletion confirms saved version, cancels safely and preserves other drafts',async({page},info)=>{
 await deletionLogin(page);const keep=await deletionDraft(page,'残す下書き '+info.project.name),target=await deletionDraft(page,'削除する下書き '+info.project.name);
 await page.getByLabel('Markdown本文',{exact:true}).fill('未保存の変更も削除対象');
 let deletes=0;page.on('request',r=>{if(r.method()==='DELETE')deletes++});
 await page.getByRole('button',{name:'この下書きを削除',exact:true}).click();const confirmation=page.getByRole('region',{name:'削除してよいですか？'});
 await expect(confirmation).toContainText('保存済みの版 '+target.version);await expect(confirmation).toContainText('未保存の変更もあります');await expect(page.getByRole('heading',{name:'削除してよいですか？'})).toBeFocused();
 await page.screenshot({path:test.info().outputPath('delete-confirmation.png'),fullPage:true});
 await page.getByRole('button',{name:'削除をやめる'}).click();expect(deletes).toBe(0);await expect(page.getByLabel('Markdown本文',{exact:true})).toHaveValue('未保存の変更も削除対象');await expect(page.getByRole('button',{name:'この下書きを削除',exact:true})).toBeFocused();
 await page.keyboard.press('Enter');await page.getByRole('button',{name:'確認した下書きを削除する'}).click();await expect(page.getByRole('status').last()).toContainText('下書きを削除しました');expect(deletes).toBe(1);
 await expect(page.getByLabel('Markdown本文',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'新しい下書き',exact:true})).toBeFocused();expect((await page.request.get('/api/private/drafts/'+target.id)).status()).toBe(404);expect((await page.request.get('/api/private/drafts/'+keep.id)).status()).toBe(200);
 await page.getByRole('button',{name:keep.title,exact:true}).click();await expect(page.getByLabel('Markdown本文',{exact:true})).toHaveValue('保存した架空本文');
});
test('concurrent update refuses stale deletion and requires reading and confirming the new version',async({page},info)=>{
 await deletionLogin(page);const target=await deletionDraft(page,'競合する下書き '+info.project.name);await page.getByLabel('Markdown本文',{exact:true}).fill('手元の未保存本文');
 await page.getByRole('button',{name:'この下書きを削除',exact:true}).click();
 const {csrfToken}=await(await page.request.get('/api/private/session')).json();const update=await page.request.patch('/api/private/drafts/'+target.id,{headers:{Origin:'https://127.0.0.1:8792',Authorization:'Bearer csrf.'+csrfToken},data:{title:target.title,body:'別の画面で保存した本文',expectedVersion:target.version}});expect(update.status()).toBe(200);
 await page.getByRole('button',{name:'確認した下書きを削除する'}).click();await expect(page.getByRole('status').last()).toContainText('削除結果を確認できませんでした');await expect(page.getByLabel('Markdown本文',{exact:true})).toHaveValue('手元の未保存本文');await expect(page.getByRole('button',{name:'下書きを保存',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'この下書きを削除',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'保存済みの版を確認',exact:true}).click();await expect(page.getByLabel('保存済み本文',{exact:true})).toHaveValue('別の画面で保存した本文');await page.getByRole('button',{name:'確認した版を基準にする'}).click();await expect(page.getByLabel('Markdown本文',{exact:true})).toHaveValue('手元の未保存本文');
 await page.getByRole('button',{name:'この下書きを削除',exact:true}).click();await expect(page.getByRole('region',{name:'削除してよいですか？'})).toContainText('保存済みの版 '+(target.version+1));await page.getByRole('button',{name:'確認した下書きを削除する'}).click();await expect(page.getByRole('status').last()).toContainText('下書きを削除しました');
});
test('lost deletion acknowledgement retains buffer and never infers success from list absence',async({page},info)=>{
 await deletionLogin(page);const target=await deletionDraft(page,'結果不明の下書き '+info.project.name);await page.getByLabel('Markdown本文',{exact:true}).fill('手元に残す未保存本文');
 let deletes=0;await page.route('**/api/private/drafts/'+target.id,async route=>{if(route.request().method()!=='DELETE'){await route.continue();return}deletes++;const committed=await route.fetch();expect(committed.status()).toBe(200);await route.fulfill({status:200,contentType:'application/json',body:'{"deleted":false}'})});
 await page.getByRole('button',{name:'この下書きを削除',exact:true}).click();await page.getByRole('button',{name:'確認した下書きを削除する'}).click();await expect(page.getByRole('status').last()).toContainText('削除結果を確認できませんでした');
 await page.getByRole('button',{name:'一覧を更新',exact:true}).click();await expect(page.getByRole('button',{name:target.title,exact:true})).toHaveCount(0);await expect(page.getByLabel('Markdown本文',{exact:true})).toHaveValue('手元に残す未保存本文');await expect(page.getByRole('button',{name:'この下書きを削除',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'保存済みの版を確認',exact:true}).click();await expect(page.getByRole('status').last()).toContainText('保存済みの版を確認できませんでした');expect(deletes).toBe(1);await page.screenshot({path:test.info().outputPath('delete-unknown.png'),fullPage:true});
});
for(const action of ['expire','revoke'])test('grant '+action+' while confirming deletion closes the editor without deleting',async({page},info)=>{
 await deletionLogin(page);const target=await deletionDraft(page,'失効時は残す '+action+' '+info.project.name);await page.getByRole('button',{name:'この下書きを削除',exact:true}).click();
 await page.request.post('/api/__fixture/grant?action='+action);await page.getByRole('button',{name:'確認した下書きを削除する'}).click();await expect(page.locator('#draft-body')).toHaveCount(0);
 await page.request.post('/api/__fixture/grant?action=restore');await page.getByRole('button',{name:'Googleで限定ログイン',exact:true}).click();await expect(page.getByRole('button',{name:target.title,exact:true})).toBeVisible();expect((await page.request.get('/api/private/drafts/'+target.id)).status()).toBe(200);
});
