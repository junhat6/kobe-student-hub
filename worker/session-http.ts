import {SessionStore} from './auth/sessions';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Content-Type':'application/json; charset=utf-8'};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
const error=(status:number,code:string)=>json({error:code},status);
function configured(origin:string){try{return new URL(origin).protocol==='https:'&&new URL(origin).origin===origin}catch{return false}}
/** Unconnected current-session boundary. It never creates an identity or revokes other sessions. */
export function createPrivateSessionHandler(db:D1Database,origin:string,clock:()=>number=Date.now){
 const sessions=new SessionStore(db,origin,clock);
 return async(request:Request):Promise<Response|null>=>{
  const url=new URL(request.url);if(!url.pathname.startsWith('/api/private/session')&&!url.pathname.startsWith('/api/private/logout'))return null;
  if(!configured(origin))return error(503,'session_unavailable');
  const logout=url.pathname==='/api/private/logout';if(url.search||url.hash||(!logout&&url.pathname!=='/api/private/session'))return error(404,'session_unavailable');
  const method=logout?'POST':'GET';if(request.method!==method){const response=error(405,'method_not_allowed');response.headers.set('Allow',method);return response;}
  try{
   if(!logout){const session=await sessions.inspect(request);return session.kind==='authenticated'?json({csrfToken:session.csrfToken}):session.kind==='signed-out'?error(401,'authentication_required'):error(503,'session_unavailable')}
   const authorized=await sessions.authorizeMutation(request);if(!authorized)return error(401,'authentication_required');
   const length=request.headers.get('Content-Length');
   // Workers exposes a non-null stream even for protocol-framed Content-Length: 0.
   if((request.body!==null&&length!=='0')||(length!==null&&length!=='0')||request.headers.has('Transfer-Encoding')){void request.body?.cancel().catch(()=>{});return error(400,'invalid_request')}
   if(request.headers.has('Content-Type')){void request.body?.cancel().catch(()=>{});return error(415,'invalid_request')}
   const encoding=request.headers.get('Content-Encoding');if(encoding!==null&&encoding.toLowerCase()!=='identity')return error(415,'invalid_request');
   void request.body?.cancel().catch(()=>{});
   const result=await sessions.logout(request);if(!result)return error(503,'session_unavailable');
   const response=json({loggedOut:true});response.headers.set('Set-Cookie',result.clearCookie);return response;
  }catch{return error(503,'session_unavailable')}
 };
}
