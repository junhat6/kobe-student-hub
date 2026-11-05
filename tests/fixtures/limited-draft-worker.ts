import {createLimitedDraftHandler} from '../../worker/limited-draft-http';
import {type OAuthBindings} from '../../worker/auth/oauth-http';
import type {SessionRestriction} from '../../worker/auth/session-guard';
// Fictional local controls only. Never imported by the production entry.
export default {async fetch(r:Request,env:{DB:D1Database}){
 const i=await r.json() as {url:string;method:string;headers:Record<string,string>;body?:string;bindings:OAuthBindings;policy:SessionRestriction|null;now:number;race?:string};
 let now=i.now,policy=i.policy;
 let ready:()=>void=()=>{};const authorized=new Promise<void>(resolve=>{ready=resolve});
 const db=new Proxy(env.DB,{get(t,k){if(k==='prepare')return(sql:string)=>{const wrap=(q:D1PreparedStatement):D1PreparedStatement=>new Proxy(q,{get(stmt,key){if(key==='bind')return(...v:unknown[])=>wrap(stmt.bind(...v));if(key==='first')return async(...args:Parameters<D1PreparedStatement['first']>)=>{if(sql.includes('private_article_drafts')&&i.race==='final-clock')await new Promise(resolve=>setTimeout(resolve,1200));
 if(sql.includes('private_article_drafts')&&i.race==='final-revoke')await env.DB.prepare("UPDATE limited_draft_grants SET revoked_at_ms=? WHERE account_id='account-a'").bind(now).run();
 if(sql.includes('private_article_drafts')&&i.race==='final-expiry')await env.DB.prepare("UPDATE limited_draft_grants SET expires_at_ms=? WHERE account_id='account-a'").bind(Date.now()-1).run();
 const result=await stmt.first(...args);if(sql.startsWith('UPDATE auth_sessions SET last_seen_ms='))ready();return result};const v=Reflect.get(stmt,key);return typeof v==='function'?v.bind(stmt):v}});return wrap(t.prepare(sql))};const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v}});
 const reader=()=>policy;
 const body=i.body===undefined?undefined:new ReadableStream<Uint8Array>({async pull(c){
  await authorized;
  if(i.race==='expiry')now=i.policy!.expiresAtMs;
  if(i.race==='remove')policy=null;
  if(i.race==='epoch')await env.DB.prepare("UPDATE private_accounts SET session_epoch=session_epoch+1 WHERE id='account-a'").run();
  c.enqueue(new TextEncoder().encode(i.body));c.close();
 }});
 const target=new Request(i.url,{method:i.method,headers:i.headers,body});
 return createLimitedDraftHandler(db,i.bindings,reader,()=>now)(target);
}};
