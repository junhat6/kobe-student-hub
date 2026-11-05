import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync} from 'node:fs';
import {SESSION_ABSOLUTE_MS,SESSION_IDLE_MS} from '../worker/auth/sessions';
const ORIGIN='https://app.example.invalid';const NOW=1_800_000_000_000;
const identity=(who='a')=>({provider:'google',subject:'subject-'+who,email:'fixture-'+who+'@st.kobedenshi.ac.jp'});
type Session={setCookie:string;contextCookie:string;csrfToken:string;actor:{accountId:string;accountStatus:string}};
let mf:Miniflare;
async function call<T>(input:Record<string,unknown>,target=mf):Promise<T>{const r=await target.dispatchFetch('https://fixture.test',{method:'POST',body:JSON.stringify({now:NOW,url:ORIGIN+'/private',...input})});return await r.json() as T;}
const create=(extra={})=>call<Session|null>({action:'create',identity:identity(),...extra});const cookie=(s:Session)=>[s.setCookie,s.contextCookie].map(v=>v.split(';')[0]).join('; ');
const auth=(s:Session,extra={})=>call<{actor:Session['actor'];csrfToken:string}|null>({action:'auth',headers:{Cookie:cookie(s)},...extra});
const headers=(s:Session)=>({Cookie:cookie(s),Origin:ORIGIN,Authorization:'Bearer csrf.'+(s.csrfToken),'Sec-Fetch-Site':'same-origin'});
beforeAll(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.worker/session-test.js',compatibilityDate:'2026-11-03',d1Databases:['DB']}));const db=await mf.getD1Database('DB');
 for(const s of readFileSync('migrations/0004_private_sessions.sql','utf8').replace(/^--.*$/gm,'').split(/;\s*(?:\n|$)/).filter(x=>x.trim()))await db.prepare(s).run();
 for(const [id,status] of [['a','active'],['b','active'],['pending','pending'],['suspended','suspended'],['deleted','deleted']])await db.prepare('INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,?,?)').bind('account-'+id,'subject-'+id,identity(id).email,status,NOW).run();
});
afterAll(async()=>{await mf?.dispose()});
describe('private opaque sessions and request-bound CSRF',()=>{
 it('issues fresh Host cookies, stores only domain-separated hashes, and returns no identity in cookies',async()=>{
  const a=(await create())!;const b=(await create())!;expect(a.setCookie).not.toBe(b.setCookie);expect(a.csrfToken).not.toBe(b.csrfToken);const raw=a.setCookie.split(';')[0].split('=')[1];expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(a.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(a.csrfToken).not.toBe(raw);
  for(const flag of ['__Host-kobe-session=','Path=/','Secure','HttpOnly','SameSite=Lax','Max-Age=28800'])expect(a.setCookie).toContain(flag);expect(a.setCookie).not.toMatch(/subject|@|Domain=/);
  const db=await mf.getD1Database('DB');const stored=JSON.stringify((await db.prepare('SELECT * FROM auth_sessions').all()).results);expect(stored).not.toContain(raw);expect(stored).not.toContain(a.csrfToken);expect(a.actor).toEqual({accountId:'account-a',accountStatus:'active'});
 });
 it('creates sessions only for already-admitted active accounts, not unknown/pending/suspended/deleted identities',async()=>{
  for(const who of ['unknown','pending','suspended','deleted'])expect(await create({identity:identity(who)})).toBeNull();
  const db=await mf.getD1Database('DB');await db.prepare("INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES('account-punctuation','subject:fixture.a','fixture@st.kobedenshi.ac.jp','active',?)").bind(NOW).run();expect(await create({identity:{...identity(),subject:'subject:fixture.a'}})).not.toBeNull();
 });
 it('loads the actor from storage and keeps another owner private',async()=>{
  const a=(await create())!;expect(await auth(a,{headers:{Cookie:cookie(a),'X-Account-Id':'account-b'}})).toEqual({actor:{accountId:'account-a',accountStatus:'active'},csrfToken:a.csrfToken});
  expect(await call({action:'owner',headers:{Cookie:cookie(a)},owner:'account-a'})).toBe(true);expect(await call({action:'owner',headers:{Cookie:cookie(a)},owner:'account-b'})).toBe(false);
 });
 it('rejects missing, malformed, duplicate cookies and another request origin',async()=>{
  const a=(await create())!;for(const Cookie of ['',"__Host-kobe-session=' OR 1=1",cookie(a)+'; '+cookie(a),'__Host-kobe-session='+'x'.repeat(5000)])expect(await auth(a,{headers:{Cookie}})).toBeNull();expect(await auth(a,{url:'https://other.invalid/private'})).toBeNull();expect(await auth(a)).not.toBeNull();
 });
 it('requires exact Origin, safe Fetch Metadata and session-specific CSRF on every unsafe operation',async()=>{
  const a=(await create())!;const b=(await create({identity:identity('b')}))!;
  for(const h of [{Cookie:cookie(a)},{...headers(a),Origin:'null'},{...headers(a),Origin:'https://other.invalid'},{...headers(a),'Sec-Fetch-Site':'cross-site'},{...headers(a),Authorization:'Bearer csrf.'+(b.csrfToken)},{...headers(a),Authorization:'Bearer csrf.'+('x'.repeat(43))}])expect(await call({action:'mutation',method:'POST',headers:h})).toBeNull();
  expect(await call({action:'mutation',method:'GET',headers:headers(a)})).toBeNull();for(const method of ['POST','PUT','PATCH','DELETE'])expect((await call<Session>({action:'mutation',method,headers:headers(a)})).actor.accountId).toBe('account-a');
 });
 it('CSRF-protects browser logout without a delayed Cookie deletion',async()=>{
  const a=(await create())!;const other=(await create())!;expect(await call({action:'logout',method:'GET',headers:headers(a)})).toBeNull();expect(await call({action:'logout',method:'POST',headers:{Cookie:cookie(a),Origin:ORIGIN}})).toBeNull();expect(await auth(a)).not.toBeNull();
  expect(await call({action:'logout',method:'POST',headers:headers(a)})).toEqual({loggedOut:true});expect(await auth(a)).toBeNull();expect(await auth(other)).not.toBeNull();
 });
 it('rejects at the idle deadline and before creation/after a backwards clock',async()=>{
  const a=(await create())!;expect(await auth(a,{now:NOW-1})).toBeNull();expect(await auth(a,{now:NOW+SESSION_IDLE_MS})).toBeNull();const b=(await create())!;expect(await auth(b,{now:NOW+1000})).not.toBeNull();expect(await auth(b,{now:NOW+999})).toBeNull();
 });
 it('activity can renew idle time but never extend the absolute deadline',async()=>{
  const a=(await create())!;for(let delta=SESSION_IDLE_MS/2;delta<SESSION_ABSOLUTE_MS;delta+=SESSION_IDLE_MS/2)expect(await auth(a,{now:NOW+delta})).not.toBeNull();expect(await auth(a,{now:NOW+SESSION_ABSOLUTE_MS})).toBeNull();
 });
 it('status suspension and reactivation never revive old sessions',async()=>{
  const a=(await create())!;const db=await mf.getD1Database('DB');await db.prepare("UPDATE private_accounts SET status='suspended' WHERE id='account-a'").run();expect(await auth(a)).toBeNull();await db.prepare("UPDATE private_accounts SET status='active' WHERE id='account-a'").run();expect(await auth(a)).toBeNull();expect(await create()).not.toBeNull();
 });
 it('deleting an account cascades sessions instead of leaving usable orphan credentials',async()=>{
  const db=await mf.getD1Database('DB');await db.prepare("INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES('account-cascade','subject-cascade','fixture@st.kobedenshi.ac.jp','active',?)").bind(NOW).run();const a=(await create({identity:identity('cascade')}))!;await db.prepare("DELETE FROM private_accounts WHERE id='account-cascade'").run();expect(await auth(a)).toBeNull();expect((await db.prepare("SELECT COUNT(*) AS n FROM auth_sessions WHERE account_id='account-cascade'").first<{n:number}>())?.n).toBe(0);
 });
 it('cleans expired/idle rows in bounded batches while retaining an active session',async()=>{
  const at=NOW+SESSION_ABSOLUTE_MS;const active=(await create({now:at}))!;const db=await mf.getD1Database('DB');const epoch=(await db.prepare("SELECT session_epoch FROM private_accounts WHERE id='account-a'").first<{session_epoch:number}>())!.session_epoch;
  await db.batch(Array.from({length:101},(_,i)=>db.prepare('INSERT INTO auth_sessions(token_hash,account_id,account_epoch,created_at_ms,last_seen_ms,expires_at_ms) VALUES(?,?,?,?,?,?)').bind(i.toString(16).padStart(64,'0'),'account-a',epoch,0,0,1)));
  expect(await call({action:'cleanup',now:at})).toBe(100);const more=await call<number>({action:'cleanup',now:at});expect(more).toBeGreaterThan(0);expect(more).toBeLessThanOrEqual(100);expect(await auth(active,{now:at})).not.toBeNull();
 });
 it('fails closed for invalid config/identity/clocks or unavailable storage',async()=>{
  expect(await create({identity:{...identity(),email:'Fixture-A@ST.KOBEDENSHI.AC.JP'}})).not.toBeNull();
  for(const input of [{identity:{...identity(),email:'a@b@st.kobedenshi.ac.jp'}},{identity:{...identity(),email:'x'.repeat(321)+'@st.kobedenshi.ac.jp'}},{origin:'http://app.example.invalid'},{identity:null},{identity:{...identity(),email:'foreign@example.invalid'}},{now:-1},{now:Number.MAX_SAFE_INTEGER}])expect(await create(input)).toBeNull();
  const broken=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.worker/session-test.js',compatibilityDate:'2026-11-03',d1Databases:['DB']}));try{expect(await call({action:'create',identity:identity()},broken)).toBeNull();expect(await call({action:'auth',headers:{Cookie:'__Host-kobe-session='+'a'.repeat(43)}},broken)).toBeNull()}finally{await broken.dispose()}
 });
});
