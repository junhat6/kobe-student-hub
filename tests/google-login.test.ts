import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync} from 'node:fs';
import {jwtDecrypt} from 'jose';
import {googleFixture,TEST_CLIENT_ID} from './helpers/google-fixtures';
import {pkceChallenge} from '../worker/auth/browser-flow';
const ORIGIN='https://app.example.invalid';const NOW=Date.now();const key=crypto.getRandomValues(new Uint8Array(32));
type Start={location:string;setCookie:string};type Result={kind:string;setCookie?:string;csrfToken?:string;actor?:unknown;clearCookie:string};
let mf:Miniflare;let fixture:Awaited<ReturnType<typeof googleFixture>>;let response:()=>Promise<Response>;let exchanges=0;let form:URLSearchParams;const destinations:string[]=[];
async function call<T>(input:Record<string,unknown>):Promise<T>{return await (await mf.dispatchFetch('https://fixture.test',{method:'POST',body:JSON.stringify({now:NOW,key:Array.from(key),clientSecret:'synthetic-test-only-secret',...input})})).json() as T}
const start=(extra={})=>call<Start|null>({action:'start',url:ORIGIN+'/api/auth/start',method:'POST',headers:{Origin:ORIGIN},...extra});
const callback=(a:Start,extra={})=>call<Result|null>({action:'callback',url:ORIGIN+'/api/auth/callback?state='+new URL(a.location).searchParams.get('state')+'&code=synthetic-code',headers:{Cookie:a.setCookie.split(';')[0]},...extra});
async function signed(a:Start,patch={}){return fixture.sign({nonce:new URL(a.location).searchParams.get('nonce'),...patch})}
const failure=(r:Result|null)=>expect(r).toEqual({kind:'failed',clearCookie:expect.stringContaining('Max-Age=0')});
beforeAll(async()=>{
 fixture=await googleFixture();
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.worker/google-login-test.js',compatibilityDate:'2026-11-03',d1Databases:['DB'],outboundService:async r=>{
  destinations.push(r.url);if(r.url==='https://www.googleapis.com/oauth2/v3/certs')return Response.json(fixture.jwks);
  expect(r.url).toBe('https://oauth2.googleapis.com/token');expect(r.method).toBe('POST');expect(r.headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');exchanges++;form=new URLSearchParams(await r.text());return response();
 }}));
 const db=await mf.getD1Database('DB');for(const file of ['migrations/0003_oauth_attempts.sql','migrations/0004_private_sessions.sql'])for(const s of readFileSync(file,'utf8').replace(/^--.*$/gm,'').split(/;\s*(?:\n|$)/).filter(x=>x.trim()))await db.prepare(s).run();
 await db.prepare("INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES('fixture-account','fictional-google-subject','fixture@st.kobedenshi.ac.jp','active',?)").bind(NOW).run();
});
afterAll(async()=>{await mf?.dispose()});
describe('server-only bounded Google exchange with local D1 and real signatures',()=>{
 it('exchanges exact form and PKCE then creates a private opaque session',async()=>{
  const a=(await start())!;response=async()=>Response.json({id_token:await signed(a),access_token:'DO_NOT_STORE'});const r=(await callback(a))!;
  expect(r.kind).toBe('authenticated');expect(r.actor).toEqual({accountId:'fixture-account',accountStatus:'active'});expect(r.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(r.setCookie).toMatch(/^__Host-kobe-session=[A-Za-z0-9_-]{43};/);expect(r.clearCookie).toContain('Max-Age=0');
  const {payload}=await jwtDecrypt(a.setCookie.split(';')[0].split('=')[1],key,{currentDate:new Date(NOW)});
  expect(Object.fromEntries(form)).toEqual({grant_type:'authorization_code',code:'synthetic-code',redirect_uri:ORIGIN+'/api/auth/callback',client_id:TEST_CLIENT_ID,client_secret:'synthetic-test-only-secret',code_verifier:payload.verifier});expect(await pkceChallenge(form.get('code_verifier')!)).toBe(new URL(a.location).searchParams.get('code_challenge'));
  for(const secret of ['fictional-google-subject','st.kobedenshi','DO_NOT_STORE','Fictional name'])expect(r.setCookie).not.toContain(secret);
  const db=await mf.getD1Database('DB');const stored=JSON.stringify((await db.prepare('SELECT * FROM auth_sessions').all()).results);expect(stored).not.toContain(r.setCookie!.split(';')[0].split('=')[1]);expect(stored).not.toContain(r.csrfToken);expect(stored).not.toContain('DO_NOT_STORE');
  const before=exchanges;expect(await callback(a)).toBeNull();expect(exchanges).toBe(before);
 });
 it('fails closed before DB writes or claim with missing/invalid secrets',async()=>{
  const db=await mf.getD1Database('DB');const count=async()=> (await db.prepare('SELECT count(*) n FROM oauth_attempts').first<{n:number}>())!.n;const before=await count();
  for(const clientSecret of [null,'',' ','bad\nsecret','x'.repeat(4097)])expect(await start({clientSecret})).toBeNull();expect(await count()).toBe(before);
  const a=(await start())!;expect(await callback(a,{clientSecret:null})).toBeNull();response=async()=>Response.json({id_token:await signed(a)});expect((await callback(a))?.kind).toBe('authenticated');
 });
 it('burns signed but invalid identity and nonce failures',async()=>{
  const foreign=await googleFixture();for(const patch of [{hd:'example.invalid',email:'x@example.invalid'},{nonce:'incorrect-nonce'}]){const a=(await start())!;response=async()=>Response.json({id_token:await signed(a,patch)});failure(await callback(a));expect(await callback(a)).toBeNull()}
  const a=(await start())!;response=async()=>Response.json({id_token:await foreign.sign({nonce:new URL(a.location).searchParams.get('nonce')})});failure(await callback(a));
 });
 it('burns provider errors, redirects, malformed, missing and oversized bodies once',async()=>{
  for(const make of [async()=>new Response('PRIVATE_ERROR',{status:400}),async()=>{throw new Error('PRIVATE_NETWORK')},async()=>new Response(null,{status:302,headers:{Location:'https://evil.invalid'}}),async()=>new Response('{'),async()=>Response.json({access_token:'PRIVATE'}),async()=>new Response('x'.repeat(32769)),async()=>new Response('{}',{headers:{'Content-Length':'32769'}}),async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(32769));c.close()}}))]){
   const a=(await start())!;response=make;failure(await callback(a));const before=exchanges;expect(await callback(a)).toBeNull();expect(exchanges).toBe(before);
  }
 });
 it('never follows provider redirects to another destination',async()=>{const a=(await start())!;response=async()=>new Response(null,{status:302,headers:{Location:'https://evil.invalid/collect'}});const before=destinations.length;failure(await callback(a));expect(destinations.slice(before)).toEqual(['https://oauth2.googleapis.com/token']);});
 it('bounds stalled headers and body reads to the five-second exchange deadline',async()=>{
  for(const mode of ['headers','body']){
   const a=(await start())!;let release:()=>void=()=>{};
   response=mode==='headers'?()=>new Promise<Response>(resolve=>{release=()=>resolve(Response.json({id_token:'late-invalid-token'}))}):async()=>new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('{'));release=()=>{try{controller.close()}catch{}}}}));
   const began=Date.now();try{failure(await callback(a));expect(Date.now()-began).toBeGreaterThanOrEqual(4500);expect(Date.now()-began).toBeLessThan(6500);expect(await callback(a)).toBeNull()}finally{release()}
  }
 },15000);
 it('does not wait for a stalled upstream cancellation',async()=>{
  const a=(await start())!;let release:()=>void=()=>{};
  response=async()=>new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(32769))},cancel(){return new Promise<void>(resolve=>{release=resolve})}}));
  const began=Date.now();try{failure(await callback(a));expect(Date.now()-began).toBeLessThan(2000)}finally{release()}
 });
 it('returns generic denial without exchanging',async()=>{const a=(await start())!;const before=exchanges;failure(await callback(a,{url:ORIGIN+'/api/auth/callback?state='+new URL(a.location).searchParams.get('state')+'&error=access_denied&error_description=PRIVATE'}));expect(exchanges).toBe(before)});
 it('creates no session or account for pending or unknown identities',async()=>{
  const db=await mf.getD1Database('DB');await db.prepare("INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES('pending','pending-subject','pending@st.kobedenshi.ac.jp','pending',?)").bind(NOW).run();
  const before=(await db.prepare('SELECT count(*) n FROM auth_sessions').first<{n:number}>())!.n;
  for(const sub of ['pending-subject','unknown-subject']){const a=(await start())!;response=async()=>Response.json({id_token:await signed(a,{sub})});failure(await callback(a))}
  expect((await db.prepare('SELECT count(*) n FROM auth_sessions').first<{n:number}>())!.n).toBe(before);expect((await db.prepare('SELECT count(*) n FROM private_accounts').first<{n:number}>())!.n).toBe(2);
 });
 it('allows only one concurrent exchange',async()=>{const a=(await start())!;response=async()=>Response.json({id_token:await signed(a)});const before=exchanges;const results=await Promise.all(Array.from({length:12},()=>callback(a)));expect(results.filter(Boolean)).toHaveLength(1);expect(results.find(Boolean)?.kind).toBe('authenticated');expect(exchanges-before).toBe(1)});
});
