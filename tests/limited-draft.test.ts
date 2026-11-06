import {beforeAll,afterAll,it,expect} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync} from 'node:fs';
import {googleFixture,TEST_CLIENT_ID,TEST_EMAIL} from './helpers/google-fixtures';
import {applyOrderSchema} from './helpers/order-schema';
const O='https://limited.example.test',N=Date.now(),E=N+600000;
const policy={accountId:'account-a',accountEpoch:0,expiresAtMs:E};
const bindings={AUTH_ORIGIN:O,GOOGLE_CLIENT_ID:TEST_CLIENT_ID,GOOGLE_CLIENT_SECRET:'synthetic-only',OAUTH_COOKIE_KEY:'FxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxc'};
let mf:Miniflare,signer:Awaited<ReturnType<typeof googleFixture>>,calls=0;
const tokens=new Map<string,string>();
type Session={cookie:string;csrf:string};let a:Session;
const cookies=(r:{headers:{getSetCookie():string[]}})=>r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
async function req(path:string,method='GET',headers:Record<string,string>={},body?:unknown,extra={}){
 return mf.dispatchFetch('https://fixture.invalid',{method:'POST',redirect:'manual',body:JSON.stringify({url:O+path,method,headers,body:body===undefined?undefined:JSON.stringify(body),bindings,policy,now:N,...extra})});
}
const h=(s:Session)=>({Cookie:s.cookie,Origin:O,Authorization:'Bearer csrf.'+s.csrf,'Content-Type':'application/json'});
async function login(subject='fictional-google-subject',extra={}){
 const b=await req('/api/auth/bootstrap','POST',{Origin:O});expect(b.status).toBe(204);const context=cookies(b);
 const cmd=await req('/api/auth/command?action=login','POST',{Origin:O,Cookie:context});const {commandToken}=await cmd.json() as {commandToken:string};
 const started=await req('/api/auth/start','POST',{Origin:O,Cookie:context,Authorization:'Bearer command.'+commandToken});expect(started.status).toBe(200);
 const u=new URL((await started.json() as {authorizationUrl:string}).authorizationUrl),state=u.searchParams.get('state')!;
 tokens.set(state,await signer.sign({sub:subject,nonce:u.searchParams.get('nonce')}));
 const callback=await req('/api/auth/callback?state='+state+'&code='+state,'GET',{Cookie:context+'; '+cookies(started)},undefined,extra);
 return {response:callback,cookie:context+'; '+cookies(callback)};
}
async function newSession(){const r=await login();expect(r.response.headers.get('Location')).toBe(O+'/api/auth/draft-trial');const check=await req('/api/private/session','GET',{Cookie:r.cookie});expect(check.status).toBe(200);return {cookie:r.cookie,csrf:(await check.json() as {csrfToken:string}).csrfToken};}
beforeAll(async()=>{
 signer=await googleFixture();mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.worker/limited-draft-test.js',compatibilityDate:'2026-11-03',d1Databases:['DB'],outboundService:async r=>{
  if(r.url==='https://www.googleapis.com/oauth2/v3/certs')return Response.json(signer.jwks);
  if(r.url!=='https://oauth2.googleapis.com/token')throw Error('Unexpected provider');calls++;const f=new URLSearchParams(await r.text());return Response.json({id_token:tokens.get(f.get('code')!)});
 }}));const db=await mf.getD1Database('DB');
 for(const f of ['0003_oauth_attempts.sql','0004_private_sessions.sql','0005_private_article_drafts.sql'])for(const sql of readFileSync('migrations/'+f,'utf8').replace(/^--.*$/gm,'').split(/;\s*(?:\n|$)/).filter(x=>x.trim()))await db.prepare(sql).run();await applyOrderSchema(db);await db.prepare(readFileSync('tests/fixtures/limited-draft-grants.sql','utf8')).run();
 for(const [id,sub,status] of [['a','fictional-google-subject','pending'],['b','other-subject','active'],['p','pending-subject','pending']])await db.prepare('INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,?,?)').bind('account-'+id,sub,TEST_EMAIL,status,N).run();
 await db.prepare("INSERT INTO limited_draft_grants(account_id,account_epoch,expires_at_ms,revoked_at_ms) VALUES(?,?,?,NULL)").bind(policy.accountId,policy.accountEpoch,policy.expiresAtMs).run();
 a=await newSession();
});
afterAll(async()=>{await mf?.dispose()});
it('verified designated pending trial identity logs in, saves, lists and reopens private drafts',async()=>{
 const r=await req('/api/private/drafts','POST',h(a),{title:'Private draft',body:'# Work in progress'});expect(r.status).toBe(201);const d=await r.json() as {id:string;version:number};
 expect(Object.keys(d).sort()).toEqual(['body','id','title','updatedAt','version']);expect(r.headers.get('Cache-Control')).toBe('private, no-store');
 const resumed=await newSession();expect((await req('/api/private/drafts/'+d.id,'GET',{Cookie:resumed.cookie})).status).toBe(200);
 const list=await(await req('/api/private/drafts','GET',{Cookie:resumed.cookie})).json() as {id:string}[];expect(list.some(x=>x.id===d.id)).toBe(true);
 const stored=await(await mf.getD1Database('DB')).prepare('SELECT expires_at_ms FROM auth_sessions').all<{expires_at_ms:number}>();expect(stored.results.every(x=>x.expires_at_ms<=E)).toBe(true);
});

it('trial cookie is not a normal active session and does not admit the account',async()=>{
 const r=await req('/fixture/ordinary-session','GET',{Cookie:a.cookie});expect(r.status).toBe(401);
 const row=await(await mf.getD1Database('DB')).prepare("SELECT status,session_epoch FROM private_accounts WHERE id='account-a'").first();expect(row).toEqual({status:'pending',session_epoch:0});
});
it('other verified active and pending identities cannot get session cookies',async()=>{
 for(const subject of ['other-subject','pending-subject','unregistered-subject']){const r=await login(subject);expect(r.response.headers.getSetCookie()).toEqual([]);expect((await req('/api/private/session','GET',{Cookie:r.cookie})).status).toBe(401)}
});
it('owner cannot read, edit or remove another owner draft',async()=>{
 const id=crypto.randomUUID();await(await mf.getD1Database('DB')).prepare("INSERT INTO private_article_drafts VALUES(?,'account-b','other private','secret',1,?)").bind(id,N).run();
 for(const [method,body] of [['GET',undefined],['PATCH',{title:'steal',body:'',expectedVersion:1}],['DELETE',{expectedVersion:1}]] as const)expect((await req('/api/private/drafts/'+id,method,h(a),body)).status).toBe(404);
 expect(JSON.stringify(await(await req('/api/private/drafts','GET',{Cookie:a.cookie})).json())).not.toContain('secret');
});
it('policy absent, malformed, wrong account/epoch and expired deny existing sessions',async()=>{
 for(const p of [null,{}, {...policy,accountId:'account-b'},{...policy,accountEpoch:1},{...policy,expiresAtMs:N},{...policy,expiresAtMs:N+86400001}])expect([401,404]).toContain((await req('/api/private/session','GET',{Cookie:a.cookie},undefined,{policy:p})).status);
});
it('expiry or removal during request body processing cannot commit a draft',async()=>{
 for(const race of ['expiry','remove'])expect([401,404]).toContain((await req('/api/private/drafts','POST',h(a),{title:'must not commit',body:''},{race})).status);
 expect(await(await mf.getD1Database('DB')).prepare("SELECT id FROM private_article_drafts WHERE title='must not commit'").first()).toBeNull();
});
it('expired callback does not exchange with provider or issue a session',async()=>{
 const before=calls;const r=await login('fictional-google-subject',{now:E});expect(r.response.status).toBe(303);expect(r.response.headers.get('Location')).toBe(O+'/api/auth/draft-trial');expect(calls).toBe(before);expect(r.response.headers.getSetCookie()).toEqual([]);
});
it('CSRF, cross-origin, registration, publication and operator paths stay denied',async()=>{
 for(const headers of [{Cookie:a.cookie},{...h(a),Origin:'https://evil.invalid'},{...h(a),Authorization:'Bearer csrf.'+'A'.repeat(43)}])expect((await req('/api/private/drafts','POST',headers,{title:'bad',body:''})).status).toBe(401);
 for(const path of ['/api/auth/register','/api/private/publications','/api/private/profile','/api/private/admission','/api/private/operator'])expect((await req(path,'POST',h(a),{})).status).toBe(404);
 expect((await req('/api/auth/command?action=pending-registration','POST',{Cookie:a.cookie,Origin:O})).status).toBe(400);
});
it('logout rejects old session and fresh login recovers saved drafts',async()=>{
 const s=await newSession();const headers={Cookie:s.cookie,Origin:O,Authorization:'Bearer csrf.'+s.csrf};expect((await req('/api/private/logout','POST',headers)).status).toBe(200);
 expect((await req('/api/private/session','GET',{Cookie:s.cookie})).status).toBe(401);a=await newSession();expect((await req('/api/private/drafts','GET',{Cookie:a.cookie})).status).toBe(200);
});
it('stored status/epoch cancellation rejects old policy, old sessions and re-login',async()=>{
 await(await mf.getD1Database('DB')).prepare("UPDATE private_accounts SET status='suspended' WHERE id='account-a'").run();
 expect((await req('/api/private/session','GET',{Cookie:a.cookie})).status).toBe(401);expect((await login()).response.headers.getSetCookie()).toEqual([]);
 await(await mf.getD1Database('DB')).prepare("UPDATE private_accounts SET status='pending' WHERE id='account-a'").run();
 expect((await login()).response.headers.getSetCookie()).toEqual([]);
});

it('configuration failure removes callback query using same-origin relative redirect',async()=>{
 for(const change of [{GOOGLE_CLIENT_SECRET:undefined},{AUTH_ORIGIN:undefined}]){const r=await req('/api/auth/callback?code=synthetic&state=synthetic','GET',{},undefined,{bindings:{...bindings,...change}});expect(r.status).toBe(303);expect(r.headers.get('Location')).toBe('/api/auth/draft-trial');expect(r.headers.getSetCookie()).toEqual([])}
});
it('a grant revoked or expired after binding cannot commit a private draft',async()=>{
 const db=await mf.getD1Database('DB');await db.prepare("UPDATE private_accounts SET status='pending',session_epoch=0 WHERE id='account-a'").run();a=await newSession();
 for(const race of ['final-revoke','final-expiry']){await db.prepare('UPDATE limited_draft_grants SET expires_at_ms=?,revoked_at_ms=NULL').bind(E).run();const r=await req('/api/private/drafts','POST',h(a),{title:'late-write',body:''},{race});expect(r.status).toBe(404);expect(await db.prepare("SELECT id FROM private_article_drafts WHERE title='late-write'").first()).toBeNull()}
});

it('database execution clock rejects naturally expired grant after bind',async()=>{
 const db=await mf.getD1Database('DB'),expiresAtMs=Date.now()+600;await db.prepare('UPDATE limited_draft_grants SET expires_at_ms=?,revoked_at_ms=NULL').bind(expiresAtMs).run();
 const r=await req('/api/private/drafts','POST',h(a),{title:'expired-clock',body:''},{policy:{...policy,expiresAtMs},race:'final-clock'});expect(r.status).toBe(404);expect(await db.prepare("SELECT id FROM private_article_drafts WHERE title='expired-clock'").first()).toBeNull();
});
