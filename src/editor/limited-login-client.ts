/** One explicit login attempt. A timeout/cancel cannot undo server-side effects. */
export const LIMITED_LOGIN_TIMEOUT_MS=10000;
export class LimitedLoginError extends Error {
 constructor(readonly kind:'timeout'|'cancelled'|'unavailable'='unavailable'){
  super('認証の開始結果を確認できませんでした。');this.name='LimitedLoginError';
 }
}
const MAX_JSON_BYTES=16384;
export function createLimitedLoginClient(fetcher:typeof fetch=fetch){
 return {async start(signal?:AbortSignal):Promise<string>{
  const controller=new AbortController(),deadline=Date.now()+LIMITED_LOGIN_TIMEOUT_MS;
  let failure:LimitedLoginError|undefined,response:Response|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  let rejectStopped:(error:LimitedLoginError)=>void=()=>{};
  const stopped=new Promise<never>((_,reject)=>{rejectStopped=reject});
  const disposeBody=()=>{if(reader)void reader.cancel().catch(()=>{});else void response?.body?.cancel().catch(()=>{})};
  const stop=(kind:'timeout'|'cancelled')=>{if(failure)return;failure=new LimitedLoginError(kind);controller.abort();disposeBody();rejectStopped(failure)};
  const onAbort=()=>stop('cancelled');
  const check=()=>{if(failure)throw failure;if(Date.now()>=deadline){stop('timeout');throw failure}if(controller.signal.aborted)throw new LimitedLoginError('cancelled')};
  const timer=setTimeout(()=>stop('timeout'),LIMITED_LOGIN_TIMEOUT_MS);
  signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)onAbort();
  const options={method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal} as const;
  async function request(path:string,headers?:HeadersInit){
   check();response=await fetcher(path,{...options,headers});
   // Also reject fetch implementations that ignore abort and return late headers.
   try{check()}catch(error){disposeBody();throw error}return response;
  }
  async function json(value:Response):Promise<unknown>{
   if(!value.body||!/^application\/json(?:;|$)/i.test(value.headers.get('Content-Type')??''))throw new LimitedLoginError();
   const length=value.headers.get('Content-Length');if(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>MAX_JSON_BYTES))throw new LimitedLoginError();
   reader=value.body.getReader();const bytes=new Uint8Array(MAX_JSON_BYTES);let size=0,count=0;
   try{
    for(;;){const chunk=await reader.read();check();if(chunk.done)break;if(++count>MAX_JSON_BYTES||size+chunk.value.byteLength>MAX_JSON_BYTES)throw new LimitedLoginError();bytes.set(chunk.value,size);size+=chunk.value.byteLength}
    const result:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size)));check();return result;
   }finally{void reader.cancel().catch(()=>{});reader.releaseLock();reader=undefined}
  }
  const operation=(async()=>{
   const bootstrap=await request('/api/auth/bootstrap');if(!bootstrap.ok&&bootstrap.status!==409)throw new LimitedLoginError();
   // Bootstrap has no useful body. Never wait for a body or for cancellation to settle.
   disposeBody();response=undefined;
   const command=await request('/api/auth/command?action=login');if(!command.ok)throw new LimitedLoginError();
   const proof=await json(command);check();
   const commandToken=proof&&typeof proof==='object'&&'commandToken' in proof?proof.commandToken:undefined;
   if(typeof commandToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(commandToken))throw new LimitedLoginError();
   const start=await request('/api/auth/start',{Authorization:'Bearer command.'+commandToken});if(!start.ok)throw new LimitedLoginError();
   const result=await json(start);check();
   const authorizationUrl=result&&typeof result==='object'&&'authorizationUrl' in result?result.authorizationUrl:undefined;
   if(typeof authorizationUrl!=='string')throw new LimitedLoginError();
   const target=new URL(authorizationUrl);if(target.origin!=='https://accounts.google.com'||target.pathname!=='/o/oauth2/v2/auth'||target.username||target.password)throw new LimitedLoginError();
   check();return target.href;
  })();
  try{return await Promise.race([operation,stopped])}
  catch(error){if(error instanceof LimitedLoginError)throw error;throw new LimitedLoginError()}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);controller.abort();disposeBody()}
 }};
}
