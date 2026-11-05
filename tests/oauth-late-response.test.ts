import {beforeAll,afterAll,it,expect} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {base64url,jwtDecrypt} from 'jose';
import {googleFixture,TEST_CLIENT_ID} from './helpers/google-fixtures';
const O='https://late-cookie.example.test',NOW=Date.now(),key=new Uint8Array(32).fill(23);
const bindings={AUTH_ORIGIN:O,GOOGLE_CLIENT_ID:TEST_CLIENT_ID,GOOGLE_CLIENT_SECRET:'synthetic-late-fixture',OAUTH_COOKIE_KEY:base64url.encode(key)};
let mf:Miniflare,signer:Awaited<ReturnType<typeof googleFixture>>,exchanges=0;
const tokens=new Map<string,string>(),failCodes=new Set<string>();
type Held={entered:()=>void;release:Promise<void>};const held=new Map<string,Held>();
class Jar{
 now=NOW;values=new Map<string,{value:string;expires:number}>();
 header(){for(const[n,c]of this.values)if(c.expires<=this.now)this.values.delete(n);return [...this.values].map(([n,c])=>n+'='+c.value).join('; ')}
 value(name:string){this.header();return this.values.get(name)?.value}
 apply(r:{headers:{getSetCookie():string[]}}){for(const raw of r.headers.getSetCookie()){const pair=raw.split(';')[0],at=pair.indexOf('='),name=pair.slice(0,at),age=Number(raw.match(/Max-Age=(\d+)/)?.[1]);if(age===0)this.values.delete(name);else this.values.set(name,{value:pair.slice(at+1),expires:this.now+age*1000})}}
}
async function call(jar:Jar,path:string,method='GET',apply=true,extra={}){const r=await mf.dispatchFetch('https://fixture.invalid',{method:'POST',redirect:'manual',body:JSON.stringify({url:O+path,method,headers:{Cookie:jar.header(),...(method==='POST'?{Origin:O}:{})},bindings,enabled:true,now:jar.now,...extra})});if(apply)jar.apply(r);return r}
async function start(jar:Jar,subject='late-a'){const r=await call(jar,'/api/auth/start','POST');expect(r.status).toBe(303);const url=new URL(r.headers.get('Location')!),state=url.searchParams.get('state')!;tokens.set(state,await signer.sign({sub:subject,email:subject+'@st.kobedenshi.ac.jp',nonce:url.searchParams.get('nonce')}));return state}
const callback=(jar:Jar,state:string,apply=true)=>call(jar,'/api/auth/callback?state='+state+'&code='+state,'GET',apply);
async function actor(jar:Jar){const token=jar.value('__Host-kobe-session');if(!token)return null;const hash=createHash('sha256').update('session-v1:'+token).digest('hex');return(await(await mf.getD1Database('DB')).prepare('SELECT account_id FROM auth_sessions WHERE token_hash=? AND revoked_at_ms IS NULL').bind(hash).first<{account_id:string}>())?.account_id??null}
function pause(code:string){let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);held.set(code,{entered,release:wait});return{ready,release}}
beforeAll(async()=>{signer=await googleFixture();mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.worker/oauth-http-test.js',compatibilityDate:'2026-11-03',d1Databases:['DB'],outboundService:async r=>{if(r.url==='https://www.googleapis.com/oauth2/v3/certs')return Response.json(signer.jwks);expect(r.url).toBe('https://oauth2.googleapis.com/token');exchanges++;const form=new URLSearchParams(await r.text()),code=form.get('code')!;const gate=held.get(code);if(gate){gate.entered();await gate.release;held.delete(code)}return failCodes.has(code)?new Response('synthetic-provider-denial',{status:400}):Response.json({id_token:tokens.get(code)})}}));const db=await mf.getD1Database('DB');for(const f of ['0003_oauth_attempts.sql','0004_private_sessions.sql'])for(const sql of readFileSync('migrations/'+f,'utf8').replace(/^--.*$/gm,'').split(/;\s*(?:\n|$)/).filter(s=>s.trim()))await db.prepare(sql).run();for(const sub of ['late-a','late-b'])await db.prepare('INSERT INTO private_accounts VALUES(?,?,?,?,?,?)').bind(sub+'-id',sub,sub+'@st.kobedenshi.ac.jp','active',0,NOW).run()});afterAll(async()=>{await mf?.dispose()});
it('preserves B when the already-claimed A failure response arrives after B start',async()=>{
 const jar=new Jar(),a=await start(jar),gate=pause(a);failCodes.add(a);const pending=callback(jar,a,false);let late:Awaited<ReturnType<typeof callback>>,b='';
 try{await gate.ready;const hash=createHash('sha256').update(a).digest('hex');expect((await(await mf.getD1Database('DB')).prepare('SELECT consumed_at_ms FROM oauth_attempts WHERE state_hash=?').bind(hash).first<{consumed_at_ms:number}>())?.consumed_at_ms).toBe(NOW);b=await start(jar,'late-b')}finally{gate.release();late=await pending}
 const saved=jar.value('__Host-kobe-oauth');jar.apply(late!);const preserved=jar.value('__Host-kobe-oauth')===saved;await callback(jar,b);
 expect({aCookieWrites:late!.headers.getSetCookie().length,bPreserved:preserved,finalActor:await actor(jar)}).toEqual({aCookieWrites:0,bPreserved:true,finalActor:'late-b-id'});
});
it('records the unresolved release blocker: late A session headers replace B identity',async()=>{
 const jar=new Jar(),a=await start(jar),late=await callback(jar,a,false);const b=await start(jar,'late-b');await callback(jar,b);const before=await actor(jar);jar.apply(late);
 expect({before,after:await actor(jar)}).toEqual({before:'late-b-id',after:'late-a-id'});
});
it('retains only sealed verification material until original expiry without callback renewal or replay',async()=>{
 const jar=new Jar(),state=await start(jar),original=jar.values.get('__Host-kobe-oauth')!;
 const {payload}=await jwtDecrypt(original.value,key,{currentDate:new Date(NOW)});
 expect(Object.keys(payload).sort()).toEqual(['aud','browserBinding','exp','iat','iss','state','verifier']);
 expect(payload.exp! as number).toBe((payload.iat as number)+600);
 expect(payload.state).toBe(state);
 jar.now=NOW+120000;
 await call(jar,'/api/auth/callback?state='+state+'&error=access_denied');
 expect(jar.values.get('__Host-kobe-oauth')).toEqual(original);
 const before=exchanges;
 for(let i=0;i<3;i++)expect((await callback(jar,state)).headers.getSetCookie()).toEqual([]);
 expect(exchanges).toBe(before);expect(jar.values.get('__Host-kobe-oauth')).toEqual(original);
 jar.now=NOW+600001;expect(jar.value('__Host-kobe-oauth')).toBeUndefined();
});
it('refuses an unconsumed expired sealed attempt even if a client retains it beyond Max-Age',async()=>{
 const jar=new Jar(),state=await start(jar),original=jar.values.get('__Host-kobe-oauth')!,before=exchanges;
 jar.now=NOW+600001;jar.values.set('__Host-kobe-oauth',{value:original.value,expires:jar.now+100000});
 const r=await callback(jar,state);expect(r.headers.getSetCookie()).toEqual([]);expect(exchanges).toBe(before);expect(await actor(jar)).toBeNull();
});
it('sets bounded host-only secure HttpOnly attempt attributes at start only',async()=>{
 const jar=new Jar(),r=await call(jar,'/api/auth/start','POST'),raw=r.headers.getSetCookie();expect(raw).toHaveLength(1);
 expect(raw[0]).toMatch(/^__Host-kobe-oauth=.+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/);
 expect(raw[0]).not.toMatch(/Domain=/i);
});
