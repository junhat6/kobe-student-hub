import type {OwnPublications} from '../own-publication-types';
import {publicKeys,publicText} from './public-author-client';
import {projectUUID} from './project-client';
export class OwnPublicationsClientError extends Error{constructor(){super('自分の公開記録を確認できませんでした。');this.name='OwnPublicationsClientError'}}
function valid(value:unknown):value is OwnPublications{if(!publicKeys(value,['publications','moreExists'])||typeof value.moreExists!=='boolean'||!Array.isArray(value.publications)||value.publications.length>20||(value.moreExists&&value.publications.length!==20))return false;const seen=new Set<string>();return value.publications.every(row=>{if(!publicKeys(row,['kind','publicId','title','status','publishedAt','sourceVersion'])||(row.kind!=='article'&&row.kind!=='project')||!projectUUID(row.publicId)||!publicText(row.title,200)||!row.title.trim()||(row.status!=='published'&&row.status!=='hidden'&&row.status!=='deleted')||!Number.isSafeInteger(row.publishedAt)||Number(row.publishedAt)<0||Number(row.publishedAt)>253402300799999||!Number.isSafeInteger(row.sourceVersion)||Number(row.sourceVersion)<1)return false;const key=row.kind+':'+row.publicId;if(seen.has(key))return false;seen.add(key);return true})}
export function createOwnPublicationsClient(fetcher:typeof fetch=fetch){return {async read(signal?:AbortSignal):Promise<OwnPublications>{
  const controller=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;let timer:ReturnType<typeof setTimeout>|undefined;let expired=false;let rejectAbort:(error:OwnPublicationsClientError)=>void=()=>{};
  const cancel=()=>{controller.abort();if(reader)void reader.cancel().catch(()=>{})};
  const aborted=new Promise<never>((_,reject)=>{rejectAbort=reject});
  const externalAbort=()=>{cancel();rejectAbort(new OwnPublicationsClientError())};
  signal?.addEventListener('abort',externalAbort,{once:true});if(signal?.aborted)externalAbort();
  const operation=(async()=>{
   if(controller.signal.aborted)throw new OwnPublicationsClientError();
   const response=await fetcher('/api/private/own-publications',{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,headers:{Accept:'application/json'}});
   if(expired||controller.signal.aborted||response.status!==200||!response.body||!/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type')??'')){void response.body?.cancel().catch(()=>{});throw new OwnPublicationsClientError()}
   const length=response.headers.get('Content-Length');if(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>65536)){void response.body.cancel().catch(()=>{});throw new OwnPublicationsClientError()}
   reader=response.body.getReader();const bytes=new Uint8Array(65536);let size=0,count=0;
   try{for(;;){const next=await reader.read();if(expired||controller.signal.aborted)throw new OwnPublicationsClientError();if(next.done)break;if(++count>65536||size+next.value.byteLength>bytes.length)throw new OwnPublicationsClientError();bytes.set(next.value,size);size+=next.value.byteLength}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size))) as unknown}
   finally{void reader.cancel().catch(()=>{});reader.releaseLock();reader=undefined}
  })();
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;cancel();reject(new OwnPublicationsClientError())},10000)});
  try{const result=await Promise.race([operation,deadline,aborted]);if(!valid(result))throw new OwnPublicationsClientError();return result}catch(error){if(error instanceof OwnPublicationsClientError)throw error;throw new OwnPublicationsClientError()}finally{clearTimeout(timer);signal?.removeEventListener('abort',externalAbort);cancel()}
 }}}
