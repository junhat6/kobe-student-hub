import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync} from 'node:fs';
import {googleFixture,TEST_CLIENT_ID} from './helpers/google-fixtures';
import {OAUTH_ATTEMPT_TTL_MS,type OAuthAttemptSecrets} from '../worker/auth/oauth-attempts';
const NOW=1_800_000_000_000;
let mf:Miniflare;let fixture:Awaited<ReturnType<typeof googleFixture>>;
async function command<T>(input:Record<string,unknown>,target=mf):Promise<T>{const r=await target.dispatchFetch('http://fixture.test',{method:'POST',body:JSON.stringify({now:NOW,...input})});return await r.json() as T;}
const start=()=>command<OAuthAttemptSecrets>({action:'start'});
beforeAll(async()=>{
 fixture=await googleFixture();
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.worker/attempt-test.js',compatibilityDate:'2026-11-03',d1Databases:['DB'],bindings:{TEST_CLIENT_ID},outboundService:async r=>{expect(r.url).toBe('https://www.googleapis.com/oauth2/v3/certs');return Response.json(fixture.jwks)}}));
 const db=await mf.getD1Database('DB');
 for(const s of readFileSync('migrations/0003_oauth_attempts.sql','utf8').replace(/^--.*$/gm,'').split(/;\s*(?:\n|$)/).filter(s=>s.trim()))await db.prepare(s).run();
});
afterAll(async()=>{await mf?.dispose()});
describe('one-time attempt state in actual local Workers/D1',()=>{
 it('generates fresh secrets and stores state/browser digests, not raw values',async()=>{
  const a=await start();const b=await start();for(const v of Object.values(a))expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(new Set([...Object.values(a),...Object.values(b)]).size).toBe(6);
  const db=await mf.getD1Database('DB');const rows=await db.prepare('SELECT * FROM oauth_attempts WHERE nonce = ?').bind(a.nonce).all();const raw=JSON.stringify(rows.results);
  expect(raw).not.toContain(a.state);expect(raw).not.toContain(a.browserBinding);expect(raw).toContain(a.nonce);expect(raw).not.toMatch(/code_verifier|access_token|id_token|client_secret/);
 });
 it('returns nonce only once and denies sequential replay',async()=>{
  const a=await start();expect(await command({action:'consume',...a})).toEqual({nonce:a.nonce});expect(await command({action:'consume',...a})).toBeNull();
 });
 it('permits exactly one winner among twenty concurrent consumers',async()=>{
  const a=await start();const results=await Promise.all(Array.from({length:20},()=>command({action:'consume',...a})));
  expect(results.filter(r=>r!==null)).toEqual([{nonce:a.nonce}]);
 });
 it('does not burn a valid attempt for wrong state or another browser',async()=>{
  const a=await start();const b=await start();expect(await command({action:'consume',state:b.state,browserBinding:a.browserBinding})).toBeNull();
  expect(await command({action:'consume',state:a.state,browserBinding:b.browserBinding})).toBeNull();expect(await command({action:'consume',...a})).toEqual({nonce:a.nonce});
 });
 it('denies missing/malformed/oversized state and keeps the valid attempt usable',async()=>{
  const a=await start();for(const state of [undefined,'short',"' OR 1=1 --",'x'.repeat(17000)])expect(await command({action:'consume',state,browserBinding:a.browserBinding})).toBeNull();
  expect(await command({action:'consume',...a})).toEqual({nonce:a.nonce});
 });
 it('rejects at exact expiry and before creation, including after previous consumption',async()=>{
  const a=await start();expect(await command({action:'consume',...a,now:NOW-1})).toBeNull();expect(await command({action:'consume',...a,now:NOW+OAUTH_ATTEMPT_TTL_MS})).toBeNull();
  const b=await start();expect(await command({action:'consume',...b,now:NOW+OAUTH_ATTEMPT_TTL_MS-1})).toEqual({nonce:b.nonce});expect(await command({action:'consume',...b,now:NOW+OAUTH_ATTEMPT_TTL_MS})).toBeNull();
 });
 it('binds the stored nonce to real signature verification and blocks repeated completion',async()=>{
  const a=await start();const token=await fixture.sign({nonce:a.nonce});expect(await command({action:'complete',...a,token})).toEqual({verified:true});expect(await command({action:'complete',...a,token})).toEqual({verified:false});
 });
 it('burns a claimed attempt on verification failure so retry requires a new attempt',async()=>{
  const a=await start();expect(await command({action:'complete',...a,token:await fixture.sign({nonce:'wrong'})})).toEqual({verified:false});expect(await command({action:'complete',...a,token:await fixture.sign({nonce:a.nonce})})).toEqual({verified:false});
 });
 it('cleans up only expired attempts in bounded batches',async()=>{
  const active=await command<OAuthAttemptSecrets>({action:'start',now:NOW+OAUTH_ATTEMPT_TTL_MS});
  const db=await mf.getD1Database('DB');await db.batch(Array.from({length:101},(_,i)=>db.prepare('INSERT INTO oauth_attempts(state_hash,browser_hash,nonce,created_at_ms,expires_at_ms) VALUES(?,?,?,?,?)').bind(i.toString(16).padStart(64,'0'),'0'.repeat(64),'n'.repeat(43),0,1)));
  expect(await command({action:'cleanup',now:NOW+OAUTH_ATTEMPT_TTL_MS})).toEqual({removed:100});const second=await command<{removed:number}>({action:'cleanup',now:NOW+OAUTH_ATTEMPT_TTL_MS});expect(second.removed).toBeGreaterThan(0);expect(second.removed).toBeLessThanOrEqual(100);
  expect(await command({action:'consume',...active,now:NOW+OAUTH_ATTEMPT_TTL_MS})).toEqual({nonce:active.nonce});
 });
 it('fails closed for invalid clocks and unavailable storage',async()=>{
  expect(await command({action:'start',now:-1})).toBeNull();expect(await command({action:'start',now:1.5})).toBeNull();
  const broken=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.worker/attempt-test.js',compatibilityDate:'2026-11-03',d1Databases:['DB']}));
  try{expect(await command({action:'start'},broken)).toBeNull();expect(await command({action:'consume',state:'a'.repeat(43),browserBinding:'b'.repeat(43)},broken)).toBeNull()}finally{await broken.dispose()}
 });
});
