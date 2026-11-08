import {test,expect,type Page,type Request} from '@playwright/test';
const origin='https://127.0.0.1:8788';
async function seed(page:Page){await page.goto('/lab/works');return page.evaluate(async()=>{const csrf=(await(await fetch('/__fixture/profile-session',{method:'POST'})).json() as {csrfToken:string}).csrfToken;const headers={'Content-Type':'application/json',Authorization:'Bearer csrf.'+(csrf)};async function post(path:string,input:unknown){const r=await fetch(path,{method:'POST',headers,body:JSON.stringify(input)});if(r.status!==201)throw Error('fictional project setup failed');return r.json() as Promise<{profile:{id:string};id:string;version:number;projectId:string}>}const profile=await post('/api/private/profile',{displayName:'架空の制作投稿者',bio:'feedには出さない紹介',confirmPublic:true});const title='発見する架空作品 '+crypto.randomUUID().slice(0,8),description='<script>window.worksInjected=true</script>\n![image](https://works-external.invalid/image)\n制作で試したこと';const d=await post('/api/private/project-drafts',{title,description,githubUrl:'https://example.invalid/?public=link#view',demoUrl:''});const pub=await post('/api/private/project-publications/'+d.id,{expectedVersion:d.version,confirmPublic:true});return {id:pub.projectId,title,description,authorId:profile.profile.id}})}
test('anonymous readers discover a fresh work then its project and author without private or external fetches',async({page,browser})=>{
 const data=await test.step('Create a fresh fictional published work',()=>seed(page));
 const device=test.info().project.use;
 const ctx=await test.step('Open an anonymous reader context',()=>browser.newContext({baseURL:origin,ignoreHTTPSErrors:true,viewport:page.viewportSize(),screen:device.screen,isMobile:device.isMobile,hasTouch:device.hasTouch,deviceScaleFactor:device.deviceScaleFactor,userAgent:device.userAgent}));
 const checks:Promise<void>[]=[];
 const headerErrors:unknown[]=[];
 let primaryFailed=false;
 let stopObserving=()=>{};
 try{
  const reader=await ctx.newPage();
  let identities=0,privateCalls=0,external=0;
  const observeRequest=(r:Request)=>{
   if(r.url().includes('/__fixture/'))identities++;
   if(r.url().includes('/api/private/'))privateCalls++;
   if(!r.url().startsWith(origin))external++;
   if(r.url().includes('/__lab/')){
    // Observe rejections immediately; the header step below must still fail on any error.
    checks.push(r.allHeaders().then(h=>{
     expect(Object.hasOwn(h,'cookie')).toBe(false);
     expect(Object.hasOwn(h,'x-csrf-token')).toBe(false);
    }).catch(error=>{headerErrors.push(error)}));
   }
  };
  reader.on('request',observeRequest);
  stopObserving=()=>{reader.off('request',observeRequest)};
  const card=reader.getByRole('article').filter({has:reader.locator('a[href="/lab/projects/'+data.id+'"]')});
  await test.step('Read the fresh work without private or active content',async()=>{
   await reader.goto('/lab/works');
   await expect(card.getByText(data.description,{exact:true})).toBeVisible();
   await expect(card).not.toContainText('feedには出さない紹介');
   await expect(card).not.toContainText('https://example.invalid/');
   await expect(reader.locator('img,iframe')).toHaveCount(0);
   expect(await reader.evaluate(()=>('worksInjected' in window))).toBe(false);
  });
  await test.step('Follow the project to its author and public URL',async()=>{
   await card.getByRole('link',{name:data.title,exact:true}).click();
   await expect(reader.getByRole('heading',{name:data.title,exact:true})).toBeVisible();
   await reader.getByRole('link',{name:'この投稿者の公開作品を見る',exact:true}).click();
   await expect(reader.getByRole('heading',{name:'架空の制作投稿者の公開作品',exact:true})).toBeVisible();
   await expect(reader.getByText('GitHub URL：https://example.invalid/?public=link#view',{exact:true})).toBeVisible();
  });
  await test.step('Navigate works to articles and back without delaying the clicks',async()=>{
   await reader.getByRole('link',{name:'公開作品を探す',exact:true}).click();
   await expect(reader.getByRole('heading',{name:'新しい公開作品',exact:true})).toBeVisible();
   await reader.getByRole('link',{name:'公開記事を探す',exact:true}).click();
   await expect(reader.getByRole('heading',{name:'新しい公開記事',exact:true})).toBeVisible();
   await reader.getByRole('link',{name:'公開作品を探す',exact:true}).click();
   await expect(card).toBeVisible();
  });
  // allHeaders has no SDK timeout. Missing raw-header evidence is a failure, not a pass.
  await test.step('Verify every observed public request header',async()=>{
   expect(checks.length).toBeGreaterThan(0);
   let checked=0;
   while(checked<checks.length){
    const batch=checks.slice(checked);
    checked=checks.length;
    await Promise.all(batch);
   }
   // End the observation window synchronously, including requests added during the drain.
   stopObserving();
   if(headerErrors.length)throw headerErrors[0];
  },{timeout:5000});
  await test.step('Verify all observed anonymous calls and page width',async()=>{
   expect(identities).toBe(0);
   expect(privateCalls).toBe(0);
   expect(external).toBe(0);
   expect(await reader.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
 }catch(error){primaryFailed=true;throw error}
 finally{
  stopObserving();
  try{await ctx.close()}
  catch(error){
   if(!primaryFailed)throw error;
   // A timeout can already have disposed the context. Keep the original failure visible.
   console.warn('Anonymous work discovery cleanup also failed; preserving the primary failure.');
  }
 }
});
test('empty and unavailable work lists stay distinct and refresh clears stale cards before retry',async({page})=>{const data=await seed(page);let mode:'actual'|'empty'|'failure'='actual';await page.route('**/__lab/project-discovery',route=>mode==='actual'?route.continue():route.fulfill({status:mode==='empty'?200:503,contentType:'application/json',body:mode==='empty'?'{"cards":[]}':'{"error":"PRIVATE_ERROR"}'}));await page.reload();await expect(page.getByRole('link',{name:data.title,exact:true})).toBeVisible();mode='failure';await page.getByRole('button',{name:'公開作品を再確認',exact:true}).click();await expect(page.getByRole('heading',{name:'公開作品を表示できません',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:data.title,exact:true})).toHaveCount(0);await expect(page.getByText('PRIVATE_ERROR')).toHaveCount(0);await expect(page.getByRole('heading',{name:'公開作品はまだありません',exact:true})).toHaveCount(0);mode='empty';await page.getByRole('button',{name:'公開作品を再確認',exact:true}).click();await expect(page.getByRole('heading',{name:'公開作品はまだありません',exact:true})).toBeVisible();mode='actual';await page.getByRole('button',{name:'公開作品を再確認',exact:true}).click();await expect(page.getByRole('link',{name:data.title,exact:true})).toBeVisible()});
test('anonymous work discovery HTTP exposes only the narrow DTO and strict safe route headers',async({page,playwright})=>{await seed(page);const ctx=await playwright.request.newContext({baseURL:origin,ignoreHTTPSErrors:true,storageState:{cookies:[],origins:[]}});try{const r=await ctx.get('/__lab/project-discovery',{maxRedirects:0});expect(r.status()).toBe(200);const headers=r.headers();expect(headers['set-cookie']).toBeUndefined();expect(headers.location).toBeUndefined();expect(headers['cache-control']).toContain('no-store');expect(headers['referrer-policy']).toBe('no-referrer');expect(headers['x-robots-tag']).toBe('noindex, nofollow');expect(headers['x-content-type-options']).toBe('nosniff');const value=await r.json() as {cards:{project:Record<string,unknown>;author:Record<string,unknown>}[]};expect(Object.keys(value)).toEqual(['cards']);expect(value.cards.length).toBeLessThanOrEqual(20);for(const c of value.cards){expect(Object.keys(c).sort()).toEqual(['author','project']);expect(Object.keys(c.project).sort()).toEqual(['descriptionPreview','id','publishedOn','title']);expect(Object.keys(c.author).sort()).toEqual(['department','id','initials','name','year'])}expect((await ctx.get('/__lab/project-discovery?x=private')).status()).toBe(404);expect((await ctx.get('/__lab/project-discovery/extra')).status()).toBe(404);const method=await ctx.post('/__lab/project-discovery');expect(method.status()).toBe(405);expect(method.headers().allow).toBe('GET')}finally{await ctx.dispose()}let bootstraps=0;page.on('request',r=>{if(r.url().includes('/__fixture/'))bootstraps++});for(const path of ['/lab/works/invalid','/lab/worksx']){await page.goto(path);await expect(page.getByText('この作品一覧を表示できません。',{exact:true})).toBeVisible()}expect(bootstraps).toBe(0)});
