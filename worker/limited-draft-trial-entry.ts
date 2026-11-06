import {parseOAuthConfig,type OAuthBindings} from './auth/oauth-http';
import {readSessionRestriction,type SessionRestrictionReader} from './auth/session-guard';
/** Explicit opt-in adapter for a separately built TRIAL_ASSETS binding; not mounted by production entry. */
export function createTrialAssetHandler(assets:Fetcher,bindings:OAuthBindings,restriction:SessionRestrictionReader,clock:()=>number=Date.now){
 return async(request:Request):Promise<Response|null>=>{
  const u=new URL(request.url),entry=u.pathname==='/api/auth/draft-trial',asset=u.pathname.startsWith('/trial-assets/');
  if(!entry&&!asset)return null;
  const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'};
  const closed=()=>new Response('Not found',{status:404,headers});
  const config=parseOAuthConfig(bindings);if(!config||u.origin!==config.origin||request.method!=='GET'||u.search)return closed();
  try{if(!readSessionRestriction(restriction,clock()))return closed()}catch{return closed()}
  const path=entry?'/index.html':u.pathname.slice('/trial-assets'.length);
  if(!entry&&!/^\/assets\/[a-zA-Z0-9_.-]+$/.test(path))return closed();
  try{const result=await assets.fetch(new Request(new URL(path,config.origin),{method:'GET'}));if(!result.ok)return closed();const output=new Headers(result.headers);for(const [key,value]of Object.entries(headers))output.set(key,value);return new Response(result.body,{status:200,headers:output})}catch{return closed()}
 };
}
