import {SessionStore} from './auth/sessions';
import {ProjectStore} from './projects';
const PREFIX='/api/private/project-';
const LIMIT=32*1024;
// Transport work bound, including zero-byte chunks; distinct from the content byte limit.
const MAX_CHUNKS=4096;
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Content-Type':'application/json; charset=utf-8'};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
const error=(status:number,code:string)=>json({error:code},status);
const unavailable=()=>error(404,'project_unavailable');
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
/** Local-only HTTP boundary; production routes remain unconnected. */
export function createPrivateProjectHandler(db:D1Database,origin:string,clock:()=>number=Date.now){
 const sessions=new SessionStore(db,origin,clock),store=new ProjectStore(db,origin,clock);
 return async(request:Request):Promise<Response|null>=>{
  const url=new URL(request.url);if(!url.pathname.startsWith(PREFIX))return null;
  if(!canonicalOrigin(origin))return error(503,'project_unavailable');
  const match=/^\/api\/private\/project-(drafts|publications)(?:\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}))?$/.exec(url.pathname);
  if(!match||url.search||url.hash||match[1]==='publications'&&!match[2])return unavailable();
  const id=match[2],publication=match[1]==='publications',allowed=publication?['GET','POST']:id?['GET','PUT']:['GET','POST'];
  if(!allowed.includes(request.method)){const r=error(405,'method_not_allowed');r.headers.set('Allow',allowed.join(', '));return r}
  try{const auth=request.method==='GET'?await sessions.authenticate(request):await sessions.authorizeMutation(request);if(!auth)return error(401,'authentication_required');
   let result:unknown;
   if(request.method==='GET')result=publication?await store.getOwnReceipt(request,id):id?await store.getDraft(request,id):await store.listDrafts(request);
   else{const body=await input(request);if(!body.ok)return error(body.status,'invalid_request');result=publication?await store.publish(request,id,body.value):id?await store.saveDraft(request,id,body.value):await store.createDraft(request,body.value)}
   if(result===null)return unavailable();if(new TextEncoder().encode(JSON.stringify(result)).length>(request.method==='GET'&&!id?262144:65536))return unavailable();
   return json(result,request.method==='POST'?201:200);
  }catch{return unavailable()}
 };
}
