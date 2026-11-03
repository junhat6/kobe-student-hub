import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import {sampleCatalog} from '../src/sample';
let mf:Miniflare;
let bootstrapGitBody:string;
beforeAll(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.worker/index.js',compatibilityDate:'2026-11-03',compatibilityFlags:['nodejs_compat'],d1Databases:['DB']}));
 const db=await mf.getD1Database('DB');
 for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort()){
  const sql=readFileSync(`migrations/${f}`,'utf8').replace(/^--.*$/gm,'');
  for(const statement of sql.split(/;\s*(?:\n|$)/).filter(s=>s.trim()))await db.prepare(statement).run();
 }
 bootstrapGitBody=(await db.prepare("SELECT body FROM content WHERE id='git-branches'").first<{body:string}>())!.body;
 const revision=readFileSync('content-revisions/0001_git_practice.sql','utf8').replace(/^--.*$/gm,'').trim();await db.prepare(revision).run();
 await db.prepare('INSERT INTO oauth_attempts(state_hash,browser_hash,nonce,created_at_ms,expires_at_ms) VALUES(?,?,?,?,?)').bind('a'.repeat(64),'b'.repeat(64),'n'.repeat(43),0,600000).run();
 for(const state of ['draft','hidden','deleted'])await db.prepare("INSERT INTO content SELECT ?,kind,?,summary,'SECRET_BODY',tags_json,author_id,audience,prerequisite,outcome,updated_at,minutes,related_ids_json,?,1 FROM content WHERE id='learning-notes'").bind(`private-${state}`,`PRIVATE_${state}`,state).run();
 await db.prepare("INSERT INTO content SELECT 'real-content',kind,'REAL_PRIVATE_SAMPLE_BOUNDARY',summary,body,tags_json,author_id,audience,prerequisite,outcome,updated_at,minutes,related_ids_json,'published',0 FROM content WHERE id='learning-notes'").run();
});
afterAll(async()=>{await mf?.dispose()});
describe('public data boundary on Workers and D1',()=>{
 it('never returns draft, hidden, deleted or real non-sample content',async()=>{
  const res=await mf.dispatchFetch('http://test/api/catalog');expect(res.status).toBe(200);const body=await res.text();expect(body).not.toMatch(/PRIVATE_|SECRET_BODY|private-|state_hash|browser_hash|oauth_attempts|nonce/);const json=JSON.parse(body);expect(json.entries).toHaveLength(4);expect(json.profiles).toHaveLength(2);expect(res.headers.get('cache-control')).toBe('no-store');
 });
 it('rejects every write and never accepts user data',async()=>{for(const method of ['POST','PUT','PATCH','DELETE']){const res=await mf.dispatchFetch('http://test/api/content',{method,body:'{"title":"injected"}'});expect(res.status).toBe(405)} });
 it('keeps authentication and posting closed despite client-supplied identity claims',async()=>{
  const auth=await mf.dispatchFetch('http://test/api/auth/callback',{method:'POST',headers:{Authorization:'Bearer client-supplied-token','Content-Type':'application/json'},body:JSON.stringify({email:'fixture-do-not-use@st.kobedenshi.ac.jp',email_verified:true,role:'admin',accountId:'owner'})});
  expect(auth.status).toBe(405);expect(auth.headers.get('set-cookie')).toBeNull();
  const health=await mf.dispatchFetch('http://test/api/health');expect((await health.json() as {writesEnabled:boolean}).writesEnabled).toBe(false);
 });
 it('returns a safe error when storage is unavailable',async()=>{
  const broken=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.worker/index.js',compatibilityDate:'2026-11-03',compatibilityFlags:['nodejs_compat'],d1Databases:['DB']}));try{const r=await broken.dispatchFetch('http://test/api/catalog');expect(r.status).toBe(503);expect(await r.text()).not.toMatch(/SELECT|SQL|stack|D1_ERROR/)}finally{await broken.dispose()}
 });
});

describe('fictional content revision',()=>{
 it('serves the revised Git practice text matching the source sample',async()=>{
  const response=await mf.dispatchFetch('http://test/api/catalog');const catalog=await response.json() as {entries:{id:string;body:string}[]};
  expect(catalog.entries.find(e=>e.id==='git-branches')?.body).toBe(sampleCatalog.entries.find(e=>e.id==='git-branches')?.body);
 });
 it('does not overwrite a revised, edited, private or non-sample row',async()=>{
  const db=await mf.getD1Database('DB');const sql=readFileSync('content-revisions/0001_git_practice.sql','utf8').replace(/^--.*$/gm,'').trim();
  expect((await db.prepare(sql).run()).meta.changes).toBe(0);
  const original=sampleCatalog.entries.find(e=>e.id==='git-branches')!.body;
  try{
   for(const [status,sample,body] of [['published',1,'CHANGED_BY_OTHER_EDITOR'],['draft',1,bootstrapGitBody],['published',0,bootstrapGitBody]] as const){
    await db.prepare("UPDATE content SET body=?,status=?,is_sample=? WHERE id='git-branches'").bind(body,status,sample).run();
    expect((await db.prepare(sql).run()).meta.changes).toBe(0);
    expect((await db.prepare("SELECT body FROM content WHERE id='git-branches'").first<{body:string}>())?.body).toBe(body);
   }
  }finally{await db.prepare("UPDATE content SET body=?,status='published',is_sample=1 WHERE id='git-branches'").bind(original).run()}
 });
});
