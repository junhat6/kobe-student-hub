import {SessionStore} from './auth/sessions';
import {PublicationStopStore} from './publication-stops';
const PREFIX='/api/private/publication-stops';
const LIMIT=16*1024;
// Transport work bound, including zero-byte chunks; distinct from the content byte limit.
const MAX_CHUNKS=4096;
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Content-Type':'application/json; charset=utf-8'};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
const error=(status:number,code:string)=>json({error:code},status);
const unavailable=()=>error(404,'publication_stop_unavailable');
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
/** Unconnected local owner-stop boundary. */
export function createPrivatePublicationStopHandler(db:D1Database,origin:string,clock:()=>number=Date.now){const sessions=new SessionStore(db,origin,clock),store=new PublicationStopStore(db,origin,clock);return async(request:Request):Promise<Response|null>=>{const u=new URL(request.url);if(!u.pathname.startsWith(PREFIX))return null;if(!canonicalOrigin(origin))return error(503,'publication_stop_unavailable');const m=/^\/api\/private\/publication-stops\/(article|project)\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.exec(u.pathname);if(!m||u.search||u.hash)return unavailable();if(!['GET','POST'].includes(request.method)){const r=error(405,'method_not_allowed');r.headers.set('Allow','GET, POST');return r}try{const auth=await sessions.inspect(request);if(auth.kind==='unavailable')return error(503,'publication_stop_unavailable');if(auth.kind!=='authenticated'||request.method==='POST'&&!await sessions.authorizeMutation(request))return error(401,'authentication_required');let result;if(request.method==='GET')result=await store.getOwn(request,m[1],m[2]);else{const body=await input(request);if(!body.ok)return error(body.status,'invalid_request');result=await store.stop(request,m[1],m[2],body.value)}return result===null?unavailable():json(result)}catch{return unavailable()}}}
