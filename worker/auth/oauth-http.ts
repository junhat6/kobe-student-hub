import {base64url} from 'jose';
import {GoogleLoginBroker,type GoogleLoginConfig} from './google-login';
import {createPrivateSessionHandler} from '../session-http';
/** Optional binding names only. This does not create secrets or alter generated Env/configuration. */
export interface OAuthBindings {AUTH_ORIGIN?:string;GOOGLE_CLIENT_ID?:string;GOOGLE_CLIENT_SECRET?:string;OAUTH_COOKIE_KEY?:string}
export function parseOAuthConfig(raw:OAuthBindings):GoogleLoginConfig|null{
 try{const origin=raw.AUTH_ORIGIN,clientId=raw.GOOGLE_CLIENT_ID,clientSecret=raw.GOOGLE_CLIENT_SECRET,key=raw.OAUTH_COOKIE_KEY;
  if(typeof origin!=='string'||new URL(origin).protocol!=='https:'||new URL(origin).origin!==origin||typeof clientId!=='string'||!/^[A-Za-z0-9_-]{1,220}\.apps\.googleusercontent\.com$/.test(clientId)||typeof clientSecret!=='string'||! /^[\x21-\x7e]{1,4096}$/.test(clientSecret)||typeof key!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(key))return null;
  const cookieKey=base64url.decode(key);return cookieKey.length===32&&base64url.encode(cookieKey)===key?{origin,clientId,clientSecret,cookieKey}:null;
 }catch{return null}
}
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'};
const json=(status:number,code:string)=>new Response(JSON.stringify({error:code}),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8'}});
/** Independently testable HTTP glue. Production's separate source release gate must remain false.
 * No runtime binding can enable this factory. Its option is supplied by source/test code only. */
export function createOAuthHttpHandler(db:D1Database,bindings:OAuthBindings,options:{enabled?:boolean}={},clock:()=>number=Date.now){
 return async(request:Request):Promise<Response|null>=>{
  if(options.enabled!==true)return null;
  const url=new URL(request.url),auth=url.pathname.startsWith('/api/auth/'),session=url.pathname.startsWith('/api/private/session')||url.pathname.startsWith('/api/private/logout');if(!auth&&!session)return null;
  const config=parseOAuthConfig(bindings);if(!config)return json(503,'authentication_unavailable');
  if(url.origin!==config.origin)return json(404,'authentication_unavailable');
  if(session)return createPrivateSessionHandler(db,config.origin,clock)(request);
  const callback=url.pathname==='/api/auth/callback',login=url.pathname==='/api/auth/start',register=url.pathname==='/api/auth/register';
  if(!callback&&!login&&!register||!callback&&(url.hash||url.search))return json(404,'authentication_unavailable');
  const method=callback?'GET':'POST';if(request.method!==method){const r=json(405,'method_not_allowed');r.headers.set('Allow',method);return r}
  const broker=new GoogleLoginBroker(db,config,clock);
  if(callback){
   // A matched failure already consumed its attempt. Only an unmatched claim may try the other sealed purpose.
   let result:Awaited<ReturnType<GoogleLoginBroker['callback']>>|Awaited<ReturnType<GoogleLoginBroker['registrationCallback']>>=null;
   try{if(!url.hash){result=await broker.callback(request);if(result===null)result=await broker.registrationCallback(request)}}catch{/* No provider/body/error reflection. */}
   const response=new Response(null,{status:303,headers:{...headers,Location:config.origin+'/'}});
   // Never mutate the shared attempt cookie: even a claimed response can arrive after a newer start.
   // Its original expiry remains in force; consumed attempts cannot be replayed.
   if(result?.kind==='authenticated')response.headers.append('Set-Cookie',result.setCookie);return response;
  }
  // Start commands derive no authority from a payload. Do not read or allocate an unbounded body.
  void request.body?.cancel().catch(()=>{});
  try{const target=register?new Request(config.origin+'/api/auth/start',{method:'POST',headers:request.headers}):request;const result=register?await broker.startRegistration(target):await broker.start(target);if(!result)return json(400,'authentication_unavailable');return new Response(null,{status:303,headers:{...headers,Location:result.location,'Set-Cookie':result.setCookie}})}catch{return json(503,'authentication_unavailable')}
 };
}
