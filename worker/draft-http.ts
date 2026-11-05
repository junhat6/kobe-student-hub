import type {SessionRestrictionReader} from './auth/session-guard';
import {SessionStore} from './auth/sessions';
import {PrivateDraftStore} from './drafts';
const PREFIX='/api/private/drafts';
const LIMIT=2*1024*1024;
// Transport work bound, including zero-byte chunks; distinct from the content byte limit.
const MAX_CHUNKS=65536;
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Content-Type':'application/json; charset=utf-8'};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
const error=(status:number,code:string)=>json({error:code},status);
const unavailable=()=>error(404,'draft_unavailable');
function canonicalOrigin(origin:string){try{return new URL(origin).protocol==='https:'&&new URL(origin).origin===origin}catch{return false}}
type Body={ok:true;value:unknown}|{ok:false;status:number};
async function input(request:Request):Promise<Body>{
 const type=request.headers.get('Content-Type');
 if(!type||!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(type))return {ok:false,status:415};
 const encoding=request.headers.get('Content-Encoding');if(encoding!==null&&encoding.toLowerCase()!=='identity')return {ok:false,status:415};
 const length=request.headers.get('Content-Length');if(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))))return {ok:false,status:400};
 if(length!==null&&Number(length)>LIMIT){void request.body?.cancel().catch(()=>{});return {ok:false,status:413}};
 if(!request.body)return {ok:false,status:400};
 const reader=request.body.getReader();let expired=false;let timer:ReturnType<typeof setTimeout>|undefined;
 const cancel=()=>{void reader.cancel().catch(()=>{})};
 const read=(async():Promise<Body>=>{
  try{const bytes=new Uint8Array(LIMIT);let size=0;let count=0;for(;;){const chunk=await reader.read();if(expired)return {ok:false,status:408};if(chunk.done)break;if(++count>MAX_CHUNKS){cancel();return {ok:false,status:413}}if(chunk.value.byteLength===0)continue;const next=size+chunk.value.byteLength;if(next>LIMIT){cancel();return {ok:false,status:413}}bytes.set(chunk.value,size);size=next}
   if(length!==null&&Number(length)!==size)return {ok:false,status:400};
   return {ok:true,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size)))};
  }catch{return {ok:false,status:400}}finally{reader.releaseLock()}
 })();
 const deadline=new Promise<Body>(resolve=>{timer=setTimeout(()=>{expired=true;cancel();resolve({ok:false,status:408})},5000)});
 try{return await Promise.race([read,deadline])}finally{clearTimeout(timer)}
}
/** Unconnected HTTP boundary. Production must not mount this before the logging/auth gates. */
export function createPrivateDraftHandler(db:D1Database,origin:string,clock:()=>number=Date.now,restriction?:SessionRestrictionReader){
 const sessions=new SessionStore(db,origin,clock,restriction);const drafts=new PrivateDraftStore(db,origin,clock,restriction);
 return async(request:Request):Promise<Response|null>=>{
  const url=new URL(request.url);if(!url.pathname.startsWith(PREFIX))return null;
  if(!canonicalOrigin(origin))return error(503,'draft_unavailable');
  const suffix=url.pathname.slice(PREFIX.length);const collection=suffix==='';const id=suffix.slice(1);
  if(url.search||url.hash||(!collection&&!/^\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(suffix)))return unavailable();
  const allowed=collection?['GET','POST']:['GET','PATCH','PUT','DELETE'];if(!allowed.includes(request.method)){const response=error(405,'method_not_allowed');response.headers.set('Allow',allowed.join(', '));return response;}
  try{
   const authorized=request.method==='GET'?await sessions.authenticate(request):await sessions.authorizeMutation(request);if(!authorized)return error(401,'authentication_required');
   if(request.method==='GET'){const result=collection?await drafts.list(request):await drafts.read(request,id);return result===null?unavailable():json(result)}
   const body=await input(request);if(!body.ok)return error(body.status,'invalid_request');
   const result=collection?await drafts.create(request,body.value):request.method==='DELETE'?await drafts.delete(request,id,body.value):await drafts.update(request,id,body.value);
   return result===null?unavailable():json(result,collection?201:200);
  }catch{return unavailable()}
 };
}
