import {createOAuthHttpHandler,type OAuthBindings} from '../../worker/auth/oauth-http';
import {BrowserOAuthFlow} from '../../worker/auth/browser-flow';
import {base64url} from 'jose';
// Fictional local HTTP harness; never mounted by production or an editor lab.
export default {async fetch(request:Request,env:{DB:D1Database}){
 const input=await request.json() as {url:string;method:string;headers?:Record<string,string>;body?:string;streamMode?:'small'|'slow-eof'|'late-eof'|'never-eof'|'empty'|'oversize';now:number;bindings:OAuthBindings;authorizationJson?:boolean;claimPurpose?:'login'|'self-registration';race?:{subject:string;status?:string;epoch?:boolean;generation?:boolean}};
 const statements=new WeakMap<object,string>();let changed=false;
 const db=input.race?new Proxy(env.DB,{get(target,key){
  if(key==='prepare')return(sql:string)=>{const wrap=(statement:D1PreparedStatement):D1PreparedStatement=>{const proxy=new Proxy(statement,{get(value,property){if(property==='bind')return(...args:unknown[])=>wrap(value.bind(...args));const result=Reflect.get(value,property);return typeof result==='function'?result.bind(value):result}});statements.set(proxy,sql);return proxy};return wrap(target.prepare(sql))};
  if(key==='batch')return async(batch:D1PreparedStatement[])=>{if(!changed&&batch.some(statement=>statements.get(statement)?.startsWith('INSERT INTO auth_self_registration_commits'))){changed=true;const race=input.race!;if(race.status)await target.prepare('UPDATE private_accounts SET status=? WHERE google_subject=?').bind(race.status,race.subject).run();if(race.epoch)await target.prepare('UPDATE private_accounts SET session_epoch=session_epoch+1 WHERE google_subject=?').bind(race.subject).run();if(race.generation)await target.prepare('UPDATE auth_browser_contexts SET generation=generation+1 WHERE context_hash IN(SELECT context_hash FROM oauth_attempts WHERE consumed_at_ms IS NOT NULL AND completed_at_ms IS NULL)').run()}return target.batch(batch)};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }}):env.DB;
 let pulls=0,cancelled=false,body:BodyInit|undefined=input.body;
 if(input.streamMode){const mode=input.streamMode,valid=new TextEncoder().encode(input.body??'{"admissionYear":2026,"graduationYear":2028}');let offset=0;
  body=new ReadableStream<Uint8Array>({
   start(controller){if(mode==='oversize')controller.enqueue(new Uint8Array(129));else if(mode==='slow-eof'||mode==='late-eof'||mode==='never-eof')controller.enqueue(valid)},
   async pull(controller){pulls++;if(mode==='small'){if(offset<valid.length)controller.enqueue(valid.subarray(offset,++offset));else controller.close()}else if(mode==='empty')controller.enqueue(new Uint8Array(0));else if(mode==='slow-eof'||mode==='late-eof'){await new Promise(resolve=>setTimeout(resolve,mode==='slow-eof'?80:5500));try{controller.close()}catch{}}else if(mode==='never-eof')await new Promise<void>(()=>{})},
   cancel(){cancelled=true;return new Promise<void>(()=>{})},
  });
 }
 const target=new Request(input.url,{method:input.method,headers:input.headers,body});
 if(input.claimPurpose){const flow=new BrowserOAuthFlow(db,{origin:input.bindings.AUTH_ORIGIN!,clientId:input.bindings.GOOGLE_CLIENT_ID!,cookieKey:base64url.decode(input.bindings.OAUTH_COOKIE_KEY!)},()=>input.now);return Response.json(input.claimPurpose==='self-registration'?await flow.claimSelfRegistration(target):await flow.claim(target))}
 const result=await createOAuthHttpHandler(db,input.bindings,{enabled:true,authorizationJson:input.authorizationJson},()=>input.now)(target),response=result??new Response(null,{status:418});
 if(input.streamMode){response.headers.set('X-Fixture-Stream-Pulls',String(pulls));response.headers.set('X-Fixture-Stream-Cancelled',String(cancelled))}return response;
}};
