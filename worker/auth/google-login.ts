import {BrowserOAuthFlow,type BrowserFlowConfig} from './browser-flow';
import {verifySchoolGoogleIdToken} from './google-identity';
import {SessionStore} from './sessions';
export interface GoogleLoginConfig extends BrowserFlowConfig {clientSecret:string}
export type GoogleLoginResult = {kind:'failed';clearCookie:string}|({kind:'authenticated';clearCookie:string}&NonNullable<Awaited<ReturnType<SessionStore['create']>>>);
const TOKEN_URL='https://oauth2.googleapis.com/token';
const MAX_BODY=32*1024;
function configured(c:GoogleLoginConfig){
 try{return typeof c.clientSecret==='string'&&/^[\x21-\x7e]{1,4096}$/.test(c.clientSecret)&&new URL(c.origin).protocol==='https:'&&new URL(c.origin).origin===c.origin&&c.cookieKey instanceof Uint8Array&&c.cookieKey.byteLength===32&&/^[A-Za-z0-9_-]{1,220}\.apps\.googleusercontent\.com$/.test(c.clientId)}catch{return false}
}
async function readToken(response:Response):Promise<string|null>{
 if(!response.ok||response.redirected||!response.body){void response.body?.cancel().catch(()=>{});return null;}
 const length=response.headers.get('Content-Length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BODY)){void response.body.cancel().catch(()=>{});return null;}
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>MAX_BODY){void reader.cancel().catch(()=>{});return null}chunks.push(next.value)}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
  const body:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  return body!==null&&typeof body==='object'&&!Array.isArray(body)&&'id_token' in body&&typeof body.id_token==='string'?body.id_token:null;
 }finally{reader.releaseLock()}
}
/** Server-private only. No route, account admission, or provider payload is exposed. */
export class GoogleLoginBroker {
 constructor(private readonly db:D1Database,private readonly config:GoogleLoginConfig,private readonly clock:()=>number=Date.now){}
 async start(request:Request){return configured(this.config)?new BrowserOAuthFlow(this.db,this.config,this.clock).start(request):null}
 async callback(request:Request):Promise<GoogleLoginResult|null>{
  if(!configured(this.config))return null;
  const claim=await new BrowserOAuthFlow(this.db,this.config,this.clock).claim(request);if(!claim)return null;
  const failure:GoogleLoginResult={kind:'failed',clearCookie:claim.clearCookie};if(claim.kind==='denied')return failure;
  const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<null>(resolve=>{timer=setTimeout(()=>{abort.abort();resolve(null)},5000)});
  try{
   // Workers supports manual rather than error; reject every redirect without following it.
   const exchange=(async()=>{const response=await fetch(TOKEN_URL,{method:'POST',redirect:'manual',signal:abort.signal,headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code:claim.code,redirect_uri:this.config.origin+'/api/auth/callback',client_id:this.config.clientId,client_secret:this.config.clientSecret,code_verifier:claim.verifier})});
   if(abort.signal.aborted){void response.body?.cancel().catch(()=>{});return null;}
   return readToken(response)})();
   // The race also bounds a non-cooperative stream; Promise.race handles late rejections.
   const token=await Promise.race([exchange,deadline]);if(!token||abort.signal.aborted)return failure;
   clearTimeout(timer);abort.abort();
   const identity=await verifySchoolGoogleIdToken(token,{clientId:this.config.clientId,expectedNonce:claim.nonce});if(!identity)return failure;
   const session=await new SessionStore(this.db,this.config.origin,this.clock).create(identity);
   return session?{kind:'authenticated',...session,clearCookie:claim.clearCookie}:failure;
  }catch{return failure}finally{clearTimeout(timer);abort.abort()}
 }
}
