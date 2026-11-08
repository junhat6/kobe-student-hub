import {createFixtureSession} from '../helpers/coordinated-fixture';
import {EnrollmentStore} from '../../worker/auth/enrollment';
import {createEnrollmentHandler} from '../../worker/enrollment-http';
// Test-only fictional sessions and after-auth faults. Never mount or deploy this entry.
export default {async fetch(request:Request,env:{DB:D1Database}) {
 const url=new URL(request.url),origin='https://enrollment.example.invalid',now=Number(request.headers.get('X-Test-Now')??1800000000000);
 if(url.pathname==='/fixture/session')return Response.json(await createFixtureSession(env.DB,origin,()=>now,{provider:'google',subject:'subject-'+request.headers.get('X-Test-Who'),email:'fixture@st.kobedenshi.ac.jp'},{enrollment:false}));
 let injected=false;const race=request.headers.get('X-Test-Race');
 const db=race?new Proxy(env.DB,{get(target,key){
  if(key!=='prepare'){const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}
  return(sql:string)=>{
   const wrap=(statement:D1PreparedStatement):D1PreparedStatement=>new Proxy(statement,{get(st,prop){
    if(prop==='bind')return(...values:unknown[])=>wrap(st.bind(...values));
    if(prop==='first')return async(...args:Parameters<D1PreparedStatement['first']>)=>{
     const result=await st.first(...args);
     if(!injected&&sql.startsWith('UPDATE auth_sessions SET last_seen_ms=')){
      injected=true;const account=(result as {account_id?:string}|null)?.account_id??'';
      if(race==='status')await env.DB.prepare("UPDATE private_accounts SET status='suspended' WHERE id=?").bind(account).run();
      else if(race==='epoch')await env.DB.prepare('UPDATE private_accounts SET session_epoch=session_epoch+1 WHERE id=?').bind(account).run();
      else if(race==='context')await env.DB.prepare('UPDATE auth_browser_contexts SET generation=generation+1 WHERE context_hash IN(SELECT context_hash FROM auth_sessions WHERE account_id=?)').bind(account).run();
      else await env.DB.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE account_id=?').bind(now,account).run();
     }
     return result;
    };
    const value=Reflect.get(st,prop);return typeof value==='function'?value.bind(st):value;
   }});return wrap(target.prepare(sql));
  };
 }}):env.DB;
 if(url.pathname==='/fixture/store'){
  const input=await request.json() as {action:string;input?:unknown;method?:string;headers:Record<string,string>};
  const target=new Request(origin+'/api/private/enrollment',{method:input.method??(input.action==='save'?'PUT':'GET'),headers:input.headers});
  const store=new EnrollmentStore(db,origin,()=>now);return Response.json(input.action==='save'?await store.save(target,input.input):await store.getOwn(target));
 }
 let target=request;const mode=request.headers.get('X-Test-Body'),declared=request.headers.get('X-Test-Length');
 if(mode||declared!==null){
  const headers=new Headers(request.headers);headers.delete('Content-Length');if(declared!==null)headers.set('Content-Length',declared);
  let offset=0;const valid=new TextEncoder().encode('{"admissionYear":2026,"graduationYear":2027,"expectedVersion":0}');
  const body=mode?new ReadableStream<Uint8Array>({
   pull(controller){if(mode==='small'){if(offset<valid.length)controller.enqueue(valid.subarray(offset,++offset));else controller.close()}else if(mode==='empty')controller.enqueue(new Uint8Array(0))},
   start(controller){if(mode==='oversize')controller.enqueue(new Uint8Array(1025));else if(mode==='utf8'){controller.enqueue(new Uint8Array([255]));controller.close()}else if(mode==='late')setTimeout(()=>{try{controller.enqueue(valid);controller.close()}catch{}},5500)},
   cancel(){if(mode==='oversize')return new Promise<void>(()=>{})}
  }):request.body;
  target=new Request(request.url,{method:request.method,headers,body});
 }
 return await createEnrollmentHandler(db,request.headers.get('X-Test-Origin')??origin,()=>now)(target)??new Response('unmatched',{status:418});
}};
