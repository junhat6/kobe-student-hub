import {SessionStore} from '../../worker/auth/sessions';
import {PrivateDraftStore} from '../../worker/drafts';
// Test-only private fixture. Identity creation and race injection are never public routes.
export default {async fetch(request:Request,env:{DB:D1Database}){
 const i=await request.json() as {action:string;now:number;url:string;method?:string;headers?:Record<string,string>;subject?:string;id?:unknown;input?:unknown;race?:boolean|string};
 const origin='https://app.example.invalid';
 if(i.action==='session')return Response.json(await new SessionStore(env.DB,origin,()=>i.now).create({provider:'google',subject:i.subject!,email:'fixture@st.kobedenshi.ac.jp'}));
 let injected=false;
 const database=i.race?new Proxy(env.DB,{get(target,key){if(key!=='prepare'){const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}return (sql:string)=>{
  const wrap=(statement:D1PreparedStatement):D1PreparedStatement=>new Proxy(statement,{get(stmt,property){if(property==='bind')return (...values:unknown[])=>wrap(stmt.bind(...values));if(property==='first')return async(...args:Parameters<D1PreparedStatement['first']>)=>{const result=await stmt.first(...args);if(!injected&&sql.startsWith('UPDATE auth_sessions SET last_seen_ms=')){injected=true;if(i.race==='status')await env.DB.prepare("UPDATE private_accounts SET status='suspended'").run();else if(i.race==='epoch')await env.DB.prepare('UPDATE private_accounts SET session_epoch=session_epoch+1').run();else await env.DB.prepare('UPDATE auth_sessions SET revoked_at_ms=?').bind(i.now).run()}return result};const value=Reflect.get(stmt,property);return typeof value==='function'?value.bind(stmt):value}});
  return wrap(target.prepare(sql));
 }}}):env.DB;
 const store=new PrivateDraftStore(database,origin,()=>i.now);const target=new Request(i.url,{method:i.method??'GET',headers:i.headers});
 const result=i.action==='create'?await store.create(target,i.input):i.action==='read'?await store.read(target,i.id):i.action==='list'?await store.list(target):i.action==='update'?await store.update(target,i.id,i.input):await store.delete(target,i.id,i.input);
 return Response.json(result);
}};
