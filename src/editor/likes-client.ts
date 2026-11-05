import {proofAuthorization} from '../shared/auth-proof';
import {publicKeys} from './public-author-client';
export class LikeClientError extends Error{constructor(){super('いいねの状態を確認できませんでした。');this.name='LikeClientError'}}
export function createLikesClient(csrfToken:string,fetcher:typeof fetch=fetch){
 async function request(contentId:string,desired?:boolean,signal?:AbortSignal):Promise<boolean>{
 if((desired!==undefined&&typeof desired!=='boolean')||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(contentId)||(desired!==undefined&&!/^[A-Za-z0-9_-]{43}$/.test(csrfToken)))throw new LikeClientError();
  const controller=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;let timer:ReturnType<typeof setTimeout>|undefined;let expired=false;let rejectAbort:(error:LikeClientError)=>void=()=>{};
  const cancel=()=>{controller.abort();if(reader)void reader.cancel().catch(()=>{})};
  const aborted=new Promise<never>((_,reject)=>{rejectAbort=reject});
  const externalAbort=()=>{cancel();rejectAbort(new LikeClientError())};
  signal?.addEventListener('abort',externalAbort,{once:true});if(signal?.aborted)externalAbort();
  const operation=(async()=>{
   if(controller.signal.aborted)throw new LikeClientError();
   const response=await fetcher('/api/private/article-likes/'+contentId,{method:desired===undefined?'GET':'PUT',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,headers:desired===undefined?{Accept:'application/json'}:{Accept:'application/json','Content-Type':'application/json',Authorization:proofAuthorization('csrf',csrfToken)},...(desired===undefined?{}:{body:JSON.stringify(desired?{liked:true,confirmPublic:true}:{liked:false})})});
   if(expired||controller.signal.aborted||response.status!==200||!response.body||!/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type')??'')){void response.body?.cancel().catch(()=>{});throw new LikeClientError()}
   const length=response.headers.get('Content-Length');if(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>4096)){void response.body.cancel().catch(()=>{});throw new LikeClientError()}
   reader=response.body.getReader();const bytes=new Uint8Array(4096);let size=0,count=0;
   try{for(;;){const next=await reader.read();if(expired||controller.signal.aborted)throw new LikeClientError();if(next.done)break;if(++count>4096||size+next.value.byteLength>bytes.length)throw new LikeClientError();bytes.set(next.value,size);size+=next.value.byteLength}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size))) as unknown}
   finally{void reader.cancel().catch(()=>{});reader.releaseLock();reader=undefined}
  })();
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;cancel();reject(new LikeClientError())},10000)});
  try{const result=await Promise.race([operation,deadline,aborted]);if(!publicKeys(result,['liked'])||typeof result.liked!=='boolean'||(desired!==undefined&&result.liked!==desired))throw new LikeClientError();return result.liked}catch(error){if(error instanceof LikeClientError)throw error;throw new LikeClientError()}finally{clearTimeout(timer);signal?.removeEventListener('abort',externalAbort);cancel()}
 }
 return {read:(id:string,signal?:AbortSignal)=>request(id,undefined,signal),set:(id:string,liked:boolean,signal?:AbortSignal)=>request(id,liked,signal)};
}
