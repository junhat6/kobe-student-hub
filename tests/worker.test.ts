import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync} from 'node:fs';
let mf:Miniflare;
beforeAll(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.worker/index.js',compatibilityDate:'2026-11-03',compatibilityFlags:['nodejs_compat'],d1Databases:['DB']}));
 const db=await mf.getD1Database('DB');
 for(const f of ['0001_discovery.sql','0002_sample_content.sql']){
  const sql=readFileSync(`migrations/${f}`,'utf8').replace(/^--.*$/gm,'');
  for(const statement of sql.split(/;\s*(?:\n|$)/).filter(s=>s.trim()))await db.prepare(statement).run();
 }
 for(const state of ['draft','hidden','deleted'])await db.prepare("INSERT INTO content SELECT ?,kind,?,summary,'SECRET_BODY',tags_json,author_id,audience,prerequisite,outcome,updated_at,minutes,related_ids_json,?,1 FROM content WHERE id='learning-notes'").bind(`private-${state}`,`PRIVATE_${state}`,state).run();
 await db.prepare("INSERT INTO content SELECT 'real-content',kind,'REAL_PRIVATE_SAMPLE_BOUNDARY',summary,body,tags_json,author_id,audience,prerequisite,outcome,updated_at,minutes,related_ids_json,'published',0 FROM content WHERE id='learning-notes'").run();
});
afterAll(async()=>{await mf?.dispose()});
describe('public data boundary on Workers and D1',()=>{
 it('never returns draft, hidden, deleted or real non-sample content',async()=>{
  const res=await mf.dispatchFetch('http://test/api/catalog');expect(res.status).toBe(200);const body=await res.text();expect(body).not.toMatch(/PRIVATE_|SECRET_BODY|private-/);const json=JSON.parse(body);expect(json.entries).toHaveLength(4);expect(json.profiles).toHaveLength(2);expect(res.headers.get('cache-control')).toBe('no-store');
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
