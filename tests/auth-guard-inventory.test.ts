import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';

// Independent inventory: counts include helper reads, retries, sentinel reads and batch assertions.
const inventory:Record<string,{private:Record<string,number>;public?:Record<string,number>}>= {
 'drafts':{private:{create:1,read:1,list:1,update:1,delete:1}},
 'public-profile':{private:{current:1,create:3}},
 'publication':{private:{publish:2,getOwnReceipt:1},public:{readPublished:1,readPublishedSelection:1,boundedPublications:2}},
 'projects':{private:{createDraft:1,getDraft:1,listDrafts:1,saveDraft:1,publish:2,receiptRow:1,getOwnReceipt:1},public:{readPublished:1,readAuthor:2,readRecentPublished:2}},
 'own-publications':{private:{list:1}},
 'publication-stops':{private:{state:1,stop:1}},
 'likes':{private:{getOwn:1,setOwn:3},public:{readPublic:3}},
 'moderation':{private:{report:1,getOwnReport:1,queue:1,readCase:1}},
 'project-reports':{private:{report:1,getOwnReceipt:2,queue:1,readCase:1}},
};
const source=(name:string)=>readFileSync(resolve('worker',`${name}.ts`),'utf8');
function methodAt(text:string,offset:number){
 const methods=[...text.slice(0,offset).matchAll(/\basync\s+(\w+)\s*\(/g)];
 return methods.at(-1)?.[1]??'<outside method>';
}
function bindingArgs(text:string,offset:number){
 const start=text.indexOf('.bind(',offset);
 if(start<0)throw new Error('prepare must bind its guarded proof');
 let depth=1,quote='';
 for(let i=start+6;i<text.length;i++){
  const c=text[i];
  if(quote){if(c==='\\')i++;else if(c===quote)quote='';continue}
  if(c==='\''||c==='"'||c==='`'){quote=c;continue}
  if(c==='(')depth++;if(c===')'&&--depth===0)return text.slice(start+6,i);
 }
 throw new Error('unclosed binding argument list');
}
function statements(text:string){
 // All current repository SQL is literal. Fail if a future dynamic statement evades parsing.
 const found=[...text.matchAll(/\.prepare\(\s*(`(?:\\.|[^`])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")\s*\)/g)];
 expect(found.length,'every prepare call must remain auditable').toBe([...text.matchAll(/\.prepare\s*\(/g)].length);
 return found.map(m=>({method:methodAt(text,m.index!),sql:m[1],bindings:bindingArgs(text,m.index!+m[0].length)}));
}
function importedAlias(text:string,exported:string){
 const importLine=text.match(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/auth\/session-guard['"]/);
 expect(importLine,'repository must import central session guard').not.toBeNull();
 const item=importLine?.[1].split(',').map(s=>s.trim()).find(s=>new RegExp(`^${exported}(?:\\s|$)`).test(s));
 expect(item,`missing ${exported} import`).toBeTruthy();
 return item?.split(/\s+as\s+/)[1]??exported;
}

describe('independent private SQL guard inventory',()=>{
 for(const [file,expected] of Object.entries(inventory))it(`${file}: every private SQL site uses central predicate and bindings`,()=>{
  const text=source(file),sqlAlias=importedAlias(text,'liveSessionSql'),bindAlias=importedAlias(text,'liveSessionBindings');
  const actual:Record<string,number>={};
  for(const statement of statements(text)){
   actual[statement.method]=(actual[statement.method]??0)+1;
   const label=`${file}.${statement.method}`;
   if(Object.hasOwn(expected.public??{},statement.method))continue;
   expect(Object.hasOwn(expected.private,statement.method),`unclassified SQL: ${label}`).toBe(true);
   expect(statement.sql,`${label}: final statement must recheck current context/session`).toContain('${'+sqlAlias+'}');
   expect(statement.bindings,`${label}: central proof bindings must accompany predicate`).toMatch(new RegExp(`\\.\\.\\.${bindAlias}\\s*\\(`));
   expect(statement.sql,`${label}: no copied session guard`).not.toMatch(/\b(?:FROM|JOIN)\s+auth_sessions\b/i);
  }
  expect(actual).toEqual({...expected.private,...expected.public});
  expect(text,'repository must not duplicate idle timeout arithmetic').not.toContain('SESSION_IDLE_MS');
 });
 it('new authenticated repositories cannot silently evade the inventory',()=>{const found=readdirSync('worker').filter(f=>f.endsWith('.ts')).filter(f=>{const text=readFileSync(resolve('worker',f),'utf8');return /new SessionStore\s*\(/.test(text)&&/\.prepare\s*\(/.test(text)}).map(f=>f.slice(0,-3)).sort();expect(found).toEqual(Object.keys(inventory).sort())});
 it('inventory totals remain 36 private and 12 deliberate public SQL sites',()=>{
  expect(Object.values(inventory).flatMap(x=>Object.values(x.private)).reduce((a,b)=>a+b,0)).toBe(36);
  expect(Object.values(inventory).flatMap(x=>Object.values(x.public??{})).reduce((a,b)=>a+b,0)).toBe(12);
 });
});
