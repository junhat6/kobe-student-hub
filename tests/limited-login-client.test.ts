import {afterEach,describe,expect,it,vi} from 'vitest';
import {createLimitedLoginClient,LIMITED_LOGIN_TIMEOUT_MS,LimitedLoginError} from '../src/editor/limited-login-client';
const TOKEN='A'.repeat(43),URL_VALUE='https://accounts.google.com/o/oauth2/v2/auth?state=synthetic';
const PATHS=['/api/auth/bootstrap','/api/auth/command?action=login','/api/auth/start'];
const phases=['bootstrap-headers','command-headers','command-body','start-headers','start-body'] as const;
function reply(index:number){return index===0?new Response(null,{status:204}):Response.json(index===1?{commandToken:TOKEN}:{authorizationUrl:URL_VALUE})}
function fixture(phase:typeof phases[number]){
 let release:()=>void=()=>{},bodyCancelled=false;
 const signals:AbortSignal[]=[];
 const target=phase.startsWith('bootstrap')?0:phase.startsWith('command')?1:2;
 const fetcher=vi.fn(async(_input:unknown,init?:RequestInit)=>{
  signals.push(init!.signal!);const index=signals.length-1;
  if(index!==target)return reply(index);
  if(phase.endsWith('headers'))return await new Promise<Response>(resolve=>{release=()=>resolve(reply(index))});
  // Deliberately ignore abort/cancel, as an adapter may do. A late body must still be stale.
  const response=reply(index),bytes=new TextEncoder().encode(JSON.stringify(index===1?{commandToken:TOKEN}:{authorizationUrl:URL_VALUE}));let first=true;
  const reader={read:()=>first?(first=false,new Promise<ReadableStreamReadResult<Uint8Array>>(resolve=>{release=()=>resolve({done:false,value:bytes})})):Promise.resolve({done:true,value:undefined}),cancel:()=>{bodyCancelled=true;return new Promise<void>(()=>{})},releaseLock:()=>{}};
  Object.defineProperty(response,'body',{value:{getReader:()=>reader,cancel:()=>Promise.resolve()}});return response;
 });
 return {fetcher:fetcher as unknown as typeof fetch,calls:fetcher,signals,target,release:()=>release(),cancelled:()=>bodyCancelled};
}
afterEach(()=>vi.useRealTimers());
describe('limited login operation deadline and cancellation',()=>{
 for(const phase of phases)for(const exit of ['timeout','cancel'] as const)it(`${exit} releases ${phase} and discards late completion without another request`,async()=>{
  vi.useFakeTimers();const f=fixture(phase),controller=new AbortController(),client=createLimitedLoginClient(f.fetcher);
  const pending=client.start(controller.signal),failed=expect(pending).rejects.toMatchObject({kind:exit==='timeout'?'timeout':'cancelled'});
  await vi.advanceTimersByTimeAsync(0);expect(f.calls).toHaveBeenCalledTimes(f.target+1);
  if(exit==='timeout')await vi.advanceTimersByTimeAsync(LIMITED_LOGIN_TIMEOUT_MS);else controller.abort();
  await failed;expect(f.signals.every(signal=>signal.aborted)).toBe(true);if(phase.endsWith('body'))expect(f.cancelled()).toBe(true);
  f.release();await vi.advanceTimersByTimeAsync(1);expect(f.calls).toHaveBeenCalledTimes(f.target+1);
  expect(vi.getTimerCount()).toBe(0);
 });
 it('uses one deadline across all requests, not a new timeout per response',async()=>{
  vi.useFakeTimers();let index=0;const fetcher=vi.fn(async()=>{const current=index++;await new Promise(resolve=>setTimeout(resolve,4000));return reply(current)});
  const pending=createLimitedLoginClient(fetcher as typeof fetch).start(),failed=expect(pending).rejects.toMatchObject({kind:'timeout'});
  await vi.advanceTimersByTimeAsync(10000);await failed;expect(fetcher).toHaveBeenCalledTimes(3);await vi.advanceTimersByTimeAsync(2000);expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it('ignores an unused stalled bootstrap body and preserves 409 context recovery',async()=>{
  for(const status of [200,409]){const cancel=vi.fn(()=>new Promise<void>(()=>{}));let index=0;
   const bootstrap=new Response(new ReadableStream({cancel}),{status});
   const fetcher=vi.fn(async()=>index++===0?bootstrap:reply(index-1));
   expect(await createLimitedLoginClient(fetcher as typeof fetch).start()).toBe(URL_VALUE);expect(cancel).toHaveBeenCalledTimes(1);expect(fetcher).toHaveBeenCalledTimes(3);
  }
 });
 it('posts no body, sends only command proof to start and never retries automatically',async()=>{
  let index=0;const calls:{input:unknown;init?:RequestInit}[]=[];
  const client=createLimitedLoginClient((async(input,init)=>{calls.push({input,init});return reply(index++)}) as typeof fetch);
  expect(await client.start()).toBe(URL_VALUE);expect(calls.map(c=>c.input)).toEqual(PATHS);
  for(const call of calls){expect(call.init).toMatchObject({method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error'});expect(call.init?.body).toBeUndefined()}
  expect(new Headers(calls[2].init?.headers).get('Authorization')).toBe('Bearer command.'+TOKEN);
  expect(new Headers(calls[1].init?.headers).has('Authorization')).toBe(false);
 });
 it('does not begin when already cancelled and allows a new explicit attempt after failure',async()=>{
  const controller=new AbortController();controller.abort();const fetcher=vi.fn(async()=>reply(0)),client=createLimitedLoginClient(fetcher as typeof fetch);
  await expect(client.start(controller.signal)).rejects.toMatchObject({kind:'cancelled'});expect(fetcher).not.toHaveBeenCalled();
  let index=0;const again=createLimitedLoginClient((async()=>{if(index++===0)throw Error('private network detail');return reply((index-2)%3)}) as typeof fetch);
  await expect(again.start()).rejects.toMatchObject({kind:'unavailable',message:'認証の開始結果を確認できませんでした。'});expect(await again.start()).toBe(URL_VALUE);
 });
 it('bounds and validates JSON/proof/authorization target and does not expose raw responses',async()=>{
  const invalid=[Response.json(null),Response.json({commandToken:'bad'}),new Response('{'),new Response('x'.repeat(16385),{headers:{'Content-Type':'application/json'}}),new Response('{}',{headers:{'Content-Type':'application/json','Content-Length':'999999'}})];
  for(const value of invalid){let index=0;const fetcher=vi.fn(async()=>index++===0?reply(0):value);await expect(createLimitedLoginClient(fetcher as typeof fetch).start()).rejects.toBeInstanceOf(LimitedLoginError);expect(fetcher).toHaveBeenCalledTimes(2)}
  for(const url of ['https://evil.invalid/','https://accounts.google.com/other','https://user@accounts.google.com/o/oauth2/v2/auth']){let index=0;await expect(createLimitedLoginClient((async()=>index++<2?reply(index-1):Response.json({authorizationUrl:url})) as typeof fetch).start()).rejects.toBeInstanceOf(LimitedLoginError)}
 });
});
