import {EncryptJWT,jwtDecrypt,base64url} from 'jose';
import {OAuthAttemptStore,OAUTH_ATTEMPT_TTL_MS} from './oauth-attempts';
const COOKIE='__Host-kobe-oauth';
const ISSUER='kobe-student-hub:oauth-attempt';
const secret=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
export interface BrowserFlowConfig {origin:string;clientId:string;cookieKey:Uint8Array}
function context(config:BrowserFlowConfig){
 try{
  const url=new URL(config.origin);
  if(url.protocol!=='https:'||url.origin!==config.origin||!config.cookieKey||config.cookieKey.byteLength!==32||!(config.cookieKey instanceof Uint8Array)||!/^[A-Za-z0-9_-]{1,220}\.apps\.googleusercontent\.com$/.test(config.clientId))return null;
  const redirect=config.origin+'/api/auth/callback';return {redirect,audience:config.clientId+'|'+redirect};
 }catch{return null}
}
// Only start/mutating actions use this check. Cross-site provider GET callbacks use state/binding.
export function isSameOriginPost(request:Request,origin:string):boolean{
 try{return request.method==='POST'&&new URL(request.url).origin===origin&&request.headers.get('Origin')===origin&&['same-origin','none',null].includes(request.headers.get('Sec-Fetch-Site'))}catch{return false}
}
function cookie(value:string,maxAge:number){return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`}
function readCookie(header:string|null):string|null{
 if(!header||header.length>16384)return null;
 const values=header.split(';').map(x=>x.trim()).filter(x=>x.startsWith(COOKIE+'=')).map(x=>x.slice(COOKIE.length+1));
 return values.length===1&&values[0].length<=4096?values[0]:null;
}
export async function pkceChallenge(verifier:string):Promise<string|null>{
 if(!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))return null;
 return base64url.encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
}
/** Server-private orchestration; production does not import or expose it. */
export class BrowserOAuthFlow {
 constructor(private readonly db:D1Database,private readonly config:BrowserFlowConfig,private readonly clock:()=>number=Date.now){}
 private now(){const value=this.clock();return Number.isSafeInteger(value)&&value>=0&&value<Number.MAX_SAFE_INTEGER-OAUTH_ATTEMPT_TTL_MS?value:null}
 async start(request:Request):Promise<{location:string;setCookie:string}|null>{
  const ctx=context(this.config);const now=this.now();
  if(!ctx||now===null||request.url.length>8192||new URL(request.url).pathname!=='/api/auth/start'||!isSameOriginPost(request,this.config.origin))return null;
  try{
   const verifier=base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
   const attempt=await new OAuthAttemptStore(this.db,()=>now).start();if(!attempt)return null;
   const issued=Math.floor(now/1000);
   const sealed=await new EncryptJWT({state:attempt.state,browserBinding:attempt.browserBinding,verifier}).setProtectedHeader({alg:'dir',enc:'A256GCM',typ:'JWT'}).setIssuer(ISSUER).setAudience(ctx.audience).setIssuedAt(issued).setExpirationTime(issued+600).encrypt(this.config.cookieKey);
   const challenge=await pkceChallenge(verifier);if(!challenge)return null;
   const readyAt=this.now();if(readyAt===null||readyAt<now||readyAt>=(issued+600)*1000)return null;
   const location=new URL('https://accounts.google.com/o/oauth2/v2/auth');
   for(const [key,value] of Object.entries({client_id:this.config.clientId,redirect_uri:ctx.redirect,response_type:'code',scope:'openid email',hd:'st.kobedenshi.ac.jp',state:attempt.state,nonce:attempt.nonce,code_challenge:challenge,code_challenge_method:'S256'}))location.searchParams.set(key,value);
   return {location:location.toString(),setCookie:cookie(sealed,600)};
  }catch{return null}
 }
 /** Claimed secrets are for server-side exchange only, never a JSON response or log. */
 async claim(request:Request):Promise<{kind:'code';code:string;verifier:string;nonce:string;clearCookie:string}|{kind:'denied';clearCookie:string}|null>{
  const ctx=context(this.config);const now=this.now();if(!ctx||now===null||request.url.length>8192)return null;
  try{
   const url=new URL(request.url);if(request.method!=='GET'||url.origin!==this.config.origin||url.pathname!=='/api/auth/callback')return null;
   const params=url.searchParams;
   if(['state','code','error'].some(k=>params.getAll(k).length>1)||!secret(params.get('state')))return null;
   const code=params.get('code');const error=params.get('error');
   if((code!==null)===(error!==null)||code!==null&&!/^[\x21-\x7e]{1,2048}$/.test(code)||error!==null&&!/^[A-Za-z0-9_]{1,100}$/.test(error))return null;
   const sealed=readCookie(request.headers.get('Cookie'));if(!sealed)return null;
   const {payload}=await jwtDecrypt(sealed,this.config.cookieKey,{issuer:ISSUER,audience:ctx.audience,keyManagementAlgorithms:['dir'],contentEncryptionAlgorithms:['A256GCM'],typ:'JWT',requiredClaims:['iat','exp'],maxTokenAge:600,clockTolerance:0,currentDate:new Date(now)});
   if(!secret(payload.state)||!secret(payload.browserBinding)||!secret(payload.verifier)||payload.state!==params.get('state'))return null;
   const claimedAt=this.now();
   if(claimedAt===null||claimedAt<now||typeof payload.exp!=='number'||claimedAt>=payload.exp*1000)return null;
   const claimed=await new OAuthAttemptStore(this.db,()=>claimedAt).consume({state:payload.state,browserBinding:payload.browserBinding});if(!claimed)return null;
   const clearCookie=cookie('',0);
   return error!==null?{kind:'denied',clearCookie}:{kind:'code',code:code!,verifier:payload.verifier,nonce:claimed.nonce,clearCookie};
  }catch{return null}
 }
}
