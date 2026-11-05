import {afterEach,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {AdmissionStore} from '../worker/auth/admission';
import {BrowserSessionCoordinator} from '../worker/auth/browser-session';
import {BrowserOAuthFlow} from '../worker/auth/browser-flow';
import {SessionStore} from '../worker/auth/sessions';
const O='https://independent.example.invalid',NOW=1800000000000;
const policy={pendingRetentionMs:3600000,auditRetentionMs:7200000,maintenanceIntervalMs:60000};
const instances:Miniflare[]=[];
afterEach(async()=>{await Promise.all(instances.splice(0).map(m=>m.dispose()))});
async function setup(){
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("local-only independent QA")}}',compatibilityDate:'2026-11-03',d1Databases:['DB']}));instances.push(mf);const db=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of ['0003_oauth_attempts.sql','0004_private_sessions.sql','0012_browser_session_order.sql','0013_local_admission.sql']){const text=readFileSync('migrations/'+file,'utf8');await db.batch(text.split(text.includes('-- @statement')?/^-- @statement\s*$/m:/;\s*(?:\n|$)/).map(s=>s.replace(/^--.*$/gm,'').trim()).filter(Boolean).map(s=>db.prepare(s)))}
 return db;
}
async function account(db:D1Database,id:string,status='pending',epoch=0){await db.prepare('INSERT INTO private_accounts(id,google_subject,email,status,session_epoch,created_at_ms) VALUES(?,?,?,?,?,?)').bind(id,id+'-sub',id+'@st.kobedenshi.ac.jp',status,epoch,NOW).run()}
async function session(db:D1Database,id:string){
 const c=new BrowserSessionCoordinator(db,O,()=>NOW),b=(await c.bootstrap(new Request(O,{method:'POST',headers:{Origin:O}})))!;
 const h=new Headers({Origin:O,Cookie:b.setCookie.split(';')[0]});const command=(await c.command(new Request(O,{method:'POST',headers:h}),'login'))!;h.set('X-Session-Command',command.commandToken);
 const flow=new BrowserOAuthFlow(db,{origin:O,clientId:'synthetic.apps.googleusercontent.com',cookieKey:new Uint8Array(32).fill(23)},()=>NOW),start=(await flow.start(new Request(O+'/api/auth/start',{method:'POST',headers:h}),'login'))!;
 const r=await flow.claim(new Request(O+'/api/auth/callback?state='+new URL(start.location).searchParams.get('state')+'&code=synthetic',{headers:{Cookie:b.setCookie.split(';')[0]+'; '+start.setCookie.split(';')[0]}}),'login');if(r?.kind!=='code')throw Error('independent claim failed');
 const result=(await new SessionStore(db,O,()=>NOW).create({provider:'google',subject:id+'-sub',email:id+'@st.kobedenshi.ac.jp'},r.proof))!;
 const headers={Origin:O,Cookie:[b.setCookie,result.setCookie].map(s=>s.split(';')[0]).join('; '),'X-CSRF-Token':result.csrfToken};return {contextCookie:b.setCookie,headers,request:()=>new Request(O+'/private/admission',{method:'POST',headers})};
}
const decide=(id:string)=>({targetId:id,expectedEpoch:0,action:'approve' as const,reviewReference:crypto.randomUUID()});
it('independent purge preserves pending with prior activation, operator grant, or session reference',async()=>{
 const db=await setup();for(const [id,status,epoch] of [['expired','pending',0],['once-active','pending',2],['role-holder','pending',0],['session-holder','active',0]] as const)await account(db,id,status,epoch);
 await db.prepare("INSERT INTO private_admission_operators VALUES('role-holder',?,?,NULL)").bind(NOW,NOW+1000).run();await session(db,'session-holder');
 // Direct fixture reset models a legacy/inconsistent pending account with a retained session.
 await db.prepare("UPDATE private_accounts SET status='pending' WHERE id='session-holder'").run();await db.prepare("UPDATE private_accounts SET session_epoch=0 WHERE id='session-holder'").run();
 const store=new AdmissionStore(db,O,policy,()=>NOW+policy.pendingRetentionMs);expect(await store.purge()).toEqual({pending:1,audits:0});
 expect((await db.prepare('SELECT id FROM private_accounts ORDER BY id').all<{id:string}>()).results.map(r=>r.id)).toEqual(['once-active','role-holder','session-holder']);
});
it('independent purge rolls back accounts, fences, audits and reservation if final audit deletion fails',async()=>{
 const db=await setup();await account(db,'target');await account(db,'operator','active');const s=await session(db,'operator');await db.prepare("INSERT INTO private_admission_operators VALUES('operator',?,?,NULL)").bind(NOW,NOW+28800000).run();
 const live=new AdmissionStore(db,O,policy,()=>NOW);expect(await live.decide(s.request(),decide('target'))).toEqual({recorded:true});await account(db,'expired');
 await db.prepare("CREATE TRIGGER independent_abort_purge BEFORE DELETE ON private_admission_audit BEGIN SELECT RAISE(ABORT,'synthetic final purge failure'); END").run();
 const before=await db.prepare('SELECT generation FROM auth_revocation_fence WHERE id=1').first();
 const store=new AdmissionStore(db,O,policy,()=>NOW+policy.auditRetentionMs);expect(await store.purge()).toBeNull();expect(await db.prepare("SELECT id FROM private_accounts WHERE id='expired'").first()).toEqual({id:'expired'});expect(await db.prepare('SELECT generation FROM auth_revocation_fence WHERE id=1').first()).toEqual(before);expect((await db.prepare('SELECT * FROM private_admission_audit').all()).results).toHaveLength(1);expect(await db.prepare('SELECT last_run_ms,run_id FROM private_admission_maintenance').first()).toEqual({last_run_ms:0,run_id:null});
});
it('independent concurrent purge grants one reservation and no more than one batch',async()=>{
 const db=await setup();await db.batch(Array.from({length:105},(_,i)=>db.prepare("INSERT INTO private_accounts VALUES(?,?,?,'pending',0,?)").bind('batch-'+i,'subject-'+i,'b'+i+'@st.kobedenshi.ac.jp',NOW)));
 const store=new AdmissionStore(db,O,policy,()=>NOW+policy.pendingRetentionMs);const results=await Promise.all(Array.from({length:8},()=>store.purge()));expect(results.filter(Boolean)).toEqual([{pending:100,audits:0}]);expect((await db.prepare('SELECT count(*) n FROM private_accounts').first())?.n).toBe(5);
});
it('independent future operator grant cannot authorize even an otherwise valid active session',async()=>{
 const db=await setup();await account(db,'operator','active');await account(db,'target');const s=await session(db,'operator');await db.prepare("INSERT INTO private_admission_operators VALUES('operator',?,?,NULL)").bind(NOW+1,NOW+1000).run();expect(await new AdmissionStore(db,O,policy,()=>NOW).decide(s.request(),decide('target'))).toBeNull();expect((await db.prepare("SELECT status FROM private_accounts WHERE id='target'").first())?.status).toBe('pending');expect((await db.prepare('SELECT * FROM private_admission_audit').all()).results).toEqual([]);
});
it('independent target status change after session preflight defeats final CAS without audit',async()=>{
 const db=await setup();await account(db,'operator','active');await account(db,'target');const s=await session(db,'operator');await db.prepare("INSERT INTO private_admission_operators VALUES('operator',?,?,NULL)").bind(NOW,NOW+1000).run();let changed=false;
 const proxy=new Proxy(db,{get(target,key){if(key==='prepare')return(sql:string)=>{const st=target.prepare(sql);if(sql.startsWith('INSERT INTO private_admission_audit'))return new Proxy(st,{get(statement,k){if(k==='bind')return(...args:any[])=>({first:async()=>{await target.prepare("UPDATE private_accounts SET status='suspended' WHERE id='target'").run();changed=true;return statement.bind(...args).first()}});const value=Reflect.get(statement,k);return typeof value==='function'?value.bind(statement):value}});return st};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}});
 expect(await new AdmissionStore(proxy,O,policy,()=>NOW).decide(s.request(),decide('target'))).toBeNull();expect(changed).toBe(true);expect((await db.prepare('SELECT * FROM private_admission_audit').all()).results).toEqual([]);expect((await db.prepare("SELECT status,session_epoch FROM private_accounts WHERE id='target'").first())).toEqual({status:'suspended',session_epoch:1});
});
it('independent actual logout remains usable after the start-command budget is exhausted',async()=>{
 const db=await setup();await account(db,'operator','active');const s=await session(db,'operator');const c=new BrowserSessionCoordinator(db,O,()=>NOW);
 // Session creation already used one login command for this browser context.
 for(let i=0;i<19;i++)expect(await c.command(new Request(O,{method:'POST',headers:{Origin:O,Cookie:s.contextCookie.split(';')[0]}}),'login')).toBeTruthy();
 expect(await c.command(new Request(O,{method:'POST',headers:{Origin:O,Cookie:s.contextCookie.split(';')[0]}}),'pending-registration')).toBeNull();
 expect(await new SessionStore(db,O,()=>NOW).logout(s.request())).toEqual({loggedOut:true});expect(await new SessionStore(db,O,()=>NOW).authenticate(new Request(O,{headers:s.headers}))).toBeNull();
});
it('independent expired pending with unexpected private draft is retained rather than cascading content',async()=>{
 const db=await setup();await account(db,'legacy-pending');const text=readFileSync('migrations/0005_private_article_drafts.sql','utf8');await db.batch(text.replace(/^--.*$/gm,'').split(/;\s*(?:\n|$)/).map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
 await db.prepare('INSERT INTO private_article_drafts(id,owner_account_id,title,body,version,updated_at_ms) VALUES(?,?,?,?,?,?)').bind('11111111-1111-4111-8111-111111111111','legacy-pending','fictional legacy','must remain',1,NOW).run();
 const result=await new AdmissionStore(db,O,policy,()=>NOW+policy.pendingRetentionMs).purge();expect(result===null||result.pending===0).toBe(true);expect(await db.prepare("SELECT id FROM private_accounts WHERE id='legacy-pending'").first()).toEqual({id:'legacy-pending'});expect((await db.prepare('SELECT body FROM private_article_drafts').first())?.body).toBe('must remain');
});
it('independent unknown account FK with SET NULL cannot silently unlink retained records',async()=>{
 const db=await setup();await account(db,'linked-pending');await db.prepare('CREATE TABLE sqliteX_retained_records(id TEXT PRIMARY KEY,owner_id TEXT REFERENCES private_accounts(google_subject) ON DELETE SET NULL)').run();await db.prepare("INSERT INTO sqliteX_retained_records VALUES('retained','linked-pending-sub')").run();
 const result=await new AdmissionStore(db,O,policy,()=>NOW+policy.pendingRetentionMs).purge();expect(result===null||result.pending===0).toBe(true);expect(await db.prepare("SELECT id FROM private_accounts WHERE id='linked-pending'").first()).toEqual({id:'linked-pending'});expect((await db.prepare('SELECT owner_id FROM sqliteX_retained_records').first())?.owner_id).toBe('linked-pending-sub');
});
it('independent case-insensitive SQLite FK target names remain protected',async()=>{
 const db=await setup();await account(db,'case-pending');await db.prepare('CREATE TABLE independent_case_records(id TEXT PRIMARY KEY,owner_id TEXT REFERENCES PRIVATE_ACCOUNTS(id) ON DELETE CASCADE)').run();await db.prepare("INSERT INTO independent_case_records VALUES('retained','case-pending')").run();
 const result=await new AdmissionStore(db,O,policy,()=>NOW+policy.pendingRetentionMs).purge();expect(result===null||result.pending===0).toBe(true);expect((await db.prepare('SELECT owner_id FROM independent_case_records').first())?.owner_id).toBe('case-pending');
});
