import type {SessionRestrictionReader} from './session-guard';
import {parsePendingPilot} from './pending-pilot-policy';
import {hasLegacyProofHeader} from '../../src/shared/auth-proof';
import {base64url} from 'jose';
import {BrowserSessionCoordinator,type BrowserAction} from './browser-session';
import {GoogleLoginBroker,type GoogleLoginConfig} from './google-login';
import {createPrivateSessionHandler} from '../session-http';
/** Optional binding names only. This does not create secrets or alter generated Env/configuration. */
export interface OAuthBindings {AUTH_ORIGIN?:string;GOOGLE_CLIENT_ID?:string;GOOGLE_CLIENT_SECRET?:string;OAUTH_COOKIE_KEY?:string;OAUTH_PENDING_PILOT?:string}
export function parseOAuthConfig(raw:OAuthBindings):GoogleLoginConfig|null{
 try{const origin=raw.AUTH_ORIGIN,clientId=raw.GOOGLE_CLIENT_ID,clientSecret=raw.GOOGLE_CLIENT_SECRET,key=raw.OAUTH_COOKIE_KEY;
  if(typeof origin!=='string'||new URL(origin).protocol!=='https:'||new URL(origin).origin!==origin||typeof clientId!=='string'||!/^[A-Za-z0-9_-]{1,220}\.apps\.googleusercontent\.com$/.test(clientId)||typeof clientSecret!=='string'||! /^[\x21-\x7e]{1,4096}$/.test(clientSecret)||typeof key!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(key))return null;
  const cookieKey=base64url.decode(key);return cookieKey.length===32&&base64url.encode(cookieKey)===key?{origin,clientId,clientSecret,cookieKey}:null;
 }catch{return null}
}
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'};
const json=(status:number,code:string)=>new Response(JSON.stringify({error:code}),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8'}});
/** Independently testable HTTP glue. Production's separate source release gate must remain false.
 * Normal login remains source-gated. Explicit pendingPilot mode requires a valid private policy. */
export function createOAuthHttpHandler(db:D1Database,bindings:OAuthBindings,options:{enabled?:boolean;pendingPilot?:boolean;restriction?:SessionRestrictionReader;loginOnly?:boolean;authorizationJson?:boolean}={},clock:()=>number=Date.now){
 return async(request:Request):Promise<Response|null>=>{
  const pilot=options.pendingPilot===true?parsePendingPilot(bindings.OAUTH_PENDING_PILOT,clock()):null;
  if(options.enabled!==true&&!pilot){
   // Even a late callback must shed provider query credentials after the pilot closes.
   if(options.pendingPilot===true){const closedConfig=parseOAuthConfig(bindings),closedUrl=new URL(request.url);if(closedConfig&&closedUrl.origin===closedConfig.origin&&closedUrl.pathname==='/api/auth/callback'&&request.method==='GET')return new Response(null,{status:303,headers:{...headers,Location:closedConfig.origin+'/api/auth/pilot#unavailable'}})}
   return null;
  }
  const url=new URL(request.url),auth=url.pathname.startsWith('/api/auth/'),session=url.pathname.startsWith('/api/private/session')||url.pathname.startsWith('/api/private/logout');if(!auth&&!session)return null;
  const config=parseOAuthConfig(bindings);if(!config)return json(503,'authentication_unavailable');
  if(url.origin!==config.origin)return json(404,'authentication_unavailable');
  if(hasLegacyProofHeader(request.headers))return json(400,'authentication_unavailable');
  if(pilot&&session)return json(404,'authentication_unavailable');
  if(session)return createPrivateSessionHandler(db,config.origin,clock,options.restriction)(request);
  const coordinator=new BrowserSessionCoordinator(db,config.origin,clock);
  if(url.pathname==='/api/auth/bootstrap'||url.pathname==='/api/auth/command'){
   if(request.method!=='POST')return json(405,'method_not_allowed');
   try{if(url.pathname.endsWith('bootstrap')){if(url.search||url.hash)return json(404,'authentication_unavailable');const result=await coordinator.bootstrap(request);return result?new Response(null,{status:204,headers:{...headers,'Set-Cookie':result.setCookie}}):json(409,'authentication_restart_required')}
    const action=url.searchParams.get('action');if(url.hash||url.searchParams.getAll('action').length!==1||[...url.searchParams.keys()].some(k=>k!=='action')||!['login','pending-registration'].includes(action??''))return json(400,'authentication_unavailable');if(options.loginOnly&&action!=='login')return json(400,'authentication_unavailable');if(pilot&&action!=='pending-registration')return json(400,'authentication_unavailable');const result=await coordinator.command(request,action as BrowserAction);return result?new Response(JSON.stringify(result),{headers:{...headers,'Content-Type':'application/json; charset=utf-8'}}):json(409,'authentication_restart_required');
   }catch{return json(503,'authentication_unavailable')}
  }
  const callback=url.pathname==='/api/auth/callback',login=url.pathname==='/api/auth/start',register=url.pathname==='/api/auth/register';
  if(!callback&&!login&&!register||!callback&&(url.hash||url.search))return json(404,'authentication_unavailable');
  if(options.loginOnly&&register)return json(404,'authentication_unavailable');if(pilot&&login)return json(404,'authentication_unavailable');
  const method=callback?'GET':'POST';if(request.method!==method){const r=json(405,'method_not_allowed');r.headers.set('Allow',method);return r}
  const broker=new GoogleLoginBroker(db,config,clock,options.restriction);
  if(callback){
   // A matched failure already consumed its attempt. Only an unmatched claim may try the other sealed purpose.
   let result:Awaited<ReturnType<GoogleLoginBroker['callback']>>|Awaited<ReturnType<GoogleLoginBroker['registrationCallback']>>=null;
   try{if(!url.hash){if(pilot)result=await broker.registrationCallback(request,identity=>identity.email===pilot.allowedEmail&&parsePendingPilot(bindings.OAUTH_PENDING_PILOT,clock())!==null);else{result=await broker.callback(request);if(result===null&&!options.loginOnly)result=await broker.registrationCallback(request)}}}catch{/* No provider/body/error reflection. */}
   const response=new Response(null,{status:303,headers:{...headers,Location:config.origin+(pilot?'/api/auth/pilot#'+(result?.kind==='pending-receipt'?'received':'unavailable'):'/')}});
   // Never mutate the shared attempt cookie: even a claimed response can arrive after a newer start.
   // Its original expiry remains in force; consumed attempts cannot be replayed.
   if(result?.kind==='authenticated')response.headers.append('Set-Cookie',result.setCookie);return response;
  }
  // Start commands derive no authority from a payload. Do not read or allocate an unbounded body.
  void request.body?.cancel().catch(()=>{});
  try{const target=register?new Request(config.origin+'/api/auth/start',{method:'POST',headers:request.headers}):request;const result=register?await broker.startRegistration(target):await broker.start(target);if(!result)return json(400,'authentication_unavailable');if(pilot||options.authorizationJson){const authorizationUrl=new URL(result.location);authorizationUrl.searchParams.set('prompt','select_account');return new Response(JSON.stringify({authorizationUrl:authorizationUrl.toString()}),{status:200,headers:{...headers,'Content-Type':'application/json; charset=utf-8','Set-Cookie':result.setCookie}})}return new Response(null,{status:303,headers:{...headers,Location:result.location,'Set-Cookie':result.setCookie}})}catch{return json(503,'authentication_unavailable')}
 };
}
