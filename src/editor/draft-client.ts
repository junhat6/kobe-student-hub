import {proofAuthorization} from '../shared/auth-proof';
export interface DraftSummary {id:string;title:string;version:number;updatedAt:number}
export interface EditorDraft extends DraftSummary {body:string}
const ROOT='/api/private/drafts';
const LIMIT=2*1024*1024;
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
function keys(v:unknown,wanted:string[]):v is Record<string,unknown>{return v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===wanted.length&&wanted.every(k=>Object.hasOwn(v,k))}
function summary(v:unknown):v is DraftSummary{return keys(v,['id','title','version','updatedAt'])&&fields(v)}
function fields(v:Record<string,unknown>){return validId(v.id)&&typeof v.title==='string'&&v.title.length<=400&&Array.from(v.title).length<=200&&typeof v.version==='number'&&Number.isSafeInteger(v.version)&&v.version>=1&&typeof v.updatedAt==='number'&&Number.isSafeInteger(v.updatedAt)&&v.updatedAt>=0&&v.updatedAt<=8640000000000000}
function draft(v:unknown):v is EditorDraft{return keys(v,['id','title','body','version','updatedAt'])&&fields(v)&&typeof v.body==='string'&&v.body.length<=262144&&new TextEncoder().encode(v.body).byteLength<=262144}
export class DraftClientError extends Error {constructor(){super('下書きの操作結果を確認できませんでした。');this.name='DraftClientError'}}
/** Browser client only. Never persists private content or retries a mutation automatically. */
export function createDraftClient(csrfToken:string,fetcher:typeof fetch=fetch){
 async function request(path:string,method='GET',body?:unknown):Promise<unknown>{
  const controller=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;let timer:ReturnType<typeof setTimeout>|undefined;let expired=false;
  const cancel=()=>{controller.abort();if(reader)void reader.cancel().catch(()=>{})};
  const operation=(async()=>{
   const response=await fetcher(path,{method,credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,headers:body===undefined?{Accept:'application/json'}:{Accept:'application/json','Content-Type':'application/json; charset=utf-8',Authorization:proofAuthorization('csrf',csrfToken)},...(body===undefined?{}:{body:JSON.stringify(body)})});
   if(expired){void response.body?.cancel().catch(()=>{});throw new DraftClientError()}
   if(response.status!==(method==='POST'?201:200)||!response.body||!/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type')??'')){void response.body?.cancel().catch(()=>{});throw new DraftClientError()}
   const length=response.headers.get('Content-Length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>LIMIT)){void response.body.cancel().catch(()=>{});throw new DraftClientError()}
   reader=response.body.getReader();
   try{const bytes=new Uint8Array(LIMIT);let size=0;let count=0;for(;;){const next=await reader.read();if(expired)throw new DraftClientError();if(next.done)break;if(++count>65536||size+next.value.byteLength>LIMIT)throw new DraftClientError();bytes.set(next.value,size);size+=next.value.byteLength}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size))) as unknown}
   finally{if(reader){void reader.cancel().catch(()=>{});reader.releaseLock()}}
  })();
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;cancel();reject(new DraftClientError())},10000)});
  try{return await Promise.race([operation,deadline])}catch{throw new DraftClientError()}finally{clearTimeout(timer);cancel()}
 }
 const readId=(id:string)=>{if(!validId(id))throw new DraftClientError();return ROOT+'/'+id};
 return {
  async list():Promise<DraftSummary[]>{const result=await request(ROOT);if(!Array.isArray(result)||result.length>20||!result.every(summary)||new Set(result.map(v=>v.id)).size!==result.length)throw new DraftClientError();return result},
  async createEmpty():Promise<EditorDraft>{const result=await request(ROOT,'POST',{title:'',body:''});if(!draft(result)||result.title!==''||result.body!==''||result.version!==1)throw new DraftClientError();return result},
  async read(id:string):Promise<EditorDraft>{const result=await request(readId(id));if(!draft(result)||result.id!==id)throw new DraftClientError();return result},
  async delete(value:DraftSummary):Promise<void>{if(!summary(value))throw new DraftClientError();const result=await request(readId(value.id),'DELETE',{expectedVersion:value.version});if(!keys(result,['deleted'])||result.deleted!==true)throw new DraftClientError()},
  async save(value:EditorDraft):Promise<EditorDraft>{const result=await request(readId(value.id),'PATCH',{title:value.title,body:value.body,expectedVersion:value.version});if(!draft(result)||result.id!==value.id||result.version!==value.version+1||result.title!==value.title||result.body!==value.body)throw new DraftClientError();return result},
 };
}
