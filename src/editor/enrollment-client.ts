import type {OwnEnrollmentResult} from '../shared/enrollment';
import {proofAuthorization} from '../shared/auth-proof';

export interface EnrollmentInput {admissionYear:number;graduationYear:number;expectedVersion:number}
export class EnrollmentClientError extends Error {
 constructor(){super('年度の保存状態を確認できませんでした。');this.name='EnrollmentClientError'}
}
const LIMIT=4096;
const keys=(value:unknown,wanted:readonly string[]):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===wanted.length&&wanted.every(key=>Object.hasOwn(value,key));
const year=(value:unknown):value is number=>Number.isInteger(value)&&Number(value)>=1900&&Number(value)<=2199;
const integer=(value:unknown,min:number):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=min;
function validInput(value:unknown):value is EnrollmentInput {
 return keys(value,['admissionYear','graduationYear','expectedVersion'])&&year(value.admissionYear)&&year(value.graduationYear)&&value.graduationYear>=value.admissionYear&&integer(value.expectedVersion,0)&&value.expectedVersion<Number.MAX_SAFE_INTEGER;
}
function result(value:unknown):value is OwnEnrollmentResult {
 if(!keys(value,['enrollment','participation']))return false;
 if(value.enrollment===null)return value.participation==='missing';
 const record=value.enrollment;
 return keys(record,['admissionYear','graduationYear','version','updatedAtMs'])&&year(record.admissionYear)&&year(record.graduationYear)&&record.graduationYear>=record.admissionYear&&integer(record.version,1)&&integer(record.updatedAtMs,0)&&typeof value.participation==='string'&&['upcoming','current','ended'].includes(value.participation);
}

/** Private account data only. No persistence, identity defaults, or mutation retries. */
export function createEnrollmentClient(csrfToken:string,fetcher:typeof fetch=fetch){
 async function request(value?:EnrollmentInput,signal?:AbortSignal):Promise<OwnEnrollmentResult>{
  const controller=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;let timer:ReturnType<typeof setTimeout>|undefined;let expired=false;let rejectAbort:(error:EnrollmentClientError)=>void=()=>{};
  const cancel=()=>{controller.abort();if(reader)void reader.cancel().catch(()=>{})};
  const aborted=new Promise<never>((_,reject)=>{rejectAbort=reject});
  const externalAbort=()=>{cancel();rejectAbort(new EnrollmentClientError())};
  signal?.addEventListener('abort',externalAbort,{once:true});if(signal?.aborted)externalAbort();
  const operation=(async()=>{
   if(controller.signal.aborted)throw new EnrollmentClientError();
   const response=await fetcher('/api/private/enrollment',{method:value?'PUT':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,headers:value?{Accept:'application/json','Content-Type':'application/json; charset=utf-8',Authorization:proofAuthorization('csrf',csrfToken)}:{Accept:'application/json'},...(value?{body:JSON.stringify(value)}:{})});
   if(expired||controller.signal.aborted||response.status!==200||!response.body||!/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type')??'')){void response.body?.cancel().catch(()=>{});throw new EnrollmentClientError()}
   const length=response.headers.get('Content-Length');
   if(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>LIMIT)){void response.body.cancel().catch(()=>{});throw new EnrollmentClientError()}
   reader=response.body.getReader();const bytes=new Uint8Array(LIMIT);let size=0,count=0;
   try{
    for(;;){const next=await reader.read();if(expired||controller.signal.aborted)throw new EnrollmentClientError();if(next.done)break;if(++count>LIMIT||size+next.value.byteLength>LIMIT)throw new EnrollmentClientError();bytes.set(next.value,size);size+=next.value.byteLength}
    if(length!==null&&Number(length)!==size)throw new EnrollmentClientError();
    const parsed:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size)));
    if(!result(parsed)||value&&(!parsed.enrollment||parsed.enrollment.admissionYear!==value.admissionYear||parsed.enrollment.graduationYear!==value.graduationYear||parsed.enrollment.version!==value.expectedVersion+1))throw new EnrollmentClientError();
    return parsed;
   }finally{void reader.cancel().catch(()=>{});reader.releaseLock();reader=undefined}
  })();
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;cancel();reject(new EnrollmentClientError())},10000)});
  try{return await Promise.race([operation,deadline,aborted])}catch{throw new EnrollmentClientError()}finally{clearTimeout(timer);signal?.removeEventListener('abort',externalAbort);cancel()}
 }
 return {
  read:(signal?:AbortSignal)=>request(undefined,signal),
  save:(value:EnrollmentInput,signal?:AbortSignal)=>{
   if(!/^[A-Za-z0-9_-]{43}$/.test(csrfToken)||!validInput(value))return Promise.reject(new EnrollmentClientError());
   return request({...value},signal);
  },
 };
}
