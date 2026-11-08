import {afterEach,describe,it,expect,vi} from 'vitest';
import {createDraftClient,DraftClientError,type EditorDraft} from '../src/editor/draft-client';
const id='11111111-1111-4111-8111-111111111111';
const value:EditorDraft={id,title:'private fixture',body:'fixture text',version:1,updatedAt:1800000000000};
const csrf='c'.repeat(43);
afterEach(()=>vi.useRealTimers());
describe('private draft browser transport',()=>{
 it('sends request-bound CSRF and no-store credentials, never requests publication',async()=>{
  let init:RequestInit|undefined;let path:RequestInfo|URL|undefined;
  const client=createDraftClient(csrf,(async(p,i)=>{path=p;init=i;return Response.json({...value,version:2})}) as typeof fetch);
  expect(await client.save(value)).toEqual({...value,version:2});expect(path).toBe('/api/private/drafts/'+id);
  expect(init).toMatchObject({method:'PATCH',credentials:'same-origin',cache:'no-store',redirect:'error'});
  expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer csrf.'+(csrf));
  expect(JSON.parse(init!.body as string)).toEqual({title:value.title,body:value.body,expectedVersion:1});
 });
 it('rejects invalid/private extra DTO fields, mismatched identity and save acknowledgements',async()=>{
  for(const result of [{...value,owner:'private-account'},{...value,id:'not-an-id'},{...value,updatedAt:9000000000000000},{...value,version:1.5},{...value,title:'x'.repeat(201)}]){
   const client=createDraftClient(csrf,(async()=>Response.json(result)) as typeof fetch);await expect(client.read(id)).rejects.toBeInstanceOf(DraftClientError);
  }
  for(const result of [value,{...value,version:2,body:'unexpected server text'},{...value,id:'22222222-2222-4222-8222-222222222222',version:2}])await expect(createDraftClient(csrf,(async()=>Response.json(result)) as typeof fetch).save(value)).rejects.toBeInstanceOf(DraftClientError);
 });
 it('bounds summary lists and rejects duplicate IDs or bodies in metadata',async()=>{
  const {body:_,...s}=value;
  for(const result of [[s,s],[value],Array.from({length:21},()=>s)])await expect(createDraftClient(csrf,(async()=>Response.json(result)) as typeof fetch).list()).rejects.toBeInstanceOf(DraftClientError);
  expect(await createDraftClient(csrf,(async()=>Response.json([s])) as typeof fetch).list()).toEqual([s]);
 });
 it('requires empty version-one creation and never exposes internal error text',async()=>{
  await expect(createDraftClient(csrf,(async()=>Response.json(value,{status:201})) as typeof fetch).createEmpty()).rejects.toBeInstanceOf(DraftClientError);
  expect(await createDraftClient(csrf,(async()=>Response.json({...value,title:'',body:''},{status:201})) as typeof fetch).createEmpty()).toMatchObject({title:'',body:'',version:1});
  const client=createDraftClient(csrf,(async()=>new Response('PRIVATE_SQL_ERROR',{status:503})) as typeof fetch);
  await expect(client.read(id)).rejects.toThrow('下書きの操作結果を確認できませんでした。');
 });
 it('bounds malformed and oversized responses and rejects unsafe paths before fetching',async()=>{
  for(const make of [()=>new Response('{',{headers:{'Content-Type':'application/json'}}),()=>new Response('{}',{headers:{'Content-Type':'text/html'}}),()=>new Response('x'.repeat(2097153),{headers:{'Content-Type':'application/json'}}),()=>new Response('{}',{headers:{'Content-Type':'application/json','Content-Length':'2097153'}})])await expect(createDraftClient(csrf,(async()=>make()) as typeof fetch).read(id)).rejects.toBeInstanceOf(DraftClientError);
  const fetcher=vi.fn();await expect(createDraftClient(csrf,fetcher as typeof fetch).read('../private')).rejects.toBeInstanceOf(DraftClientError);expect(fetcher).not.toHaveBeenCalled();
 });
 it('times out a stalled response without retrying the mutation or accepting late data',async()=>{
  vi.useFakeTimers();let release:(r:Response)=>void=()=>{};const fetcher=vi.fn(()=>new Promise<Response>(resolve=>{release=resolve}));
  const promise=createDraftClient(csrf,fetcher as typeof fetch).save(value);const rejected=expect(promise).rejects.toBeInstanceOf(DraftClientError);
  await vi.advanceTimersByTimeAsync(10000);await rejected;expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0]).toBeDefined();
  release(Response.json({...value,version:2}));await vi.advanceTimersByTimeAsync(1);expect(fetcher).toHaveBeenCalledTimes(1);
 });
});

describe('private draft deletion transport',()=>{
 const {body:_,...target}=value;
 it('uses the confirmed saved version, CSRF and exact success acknowledgement',async()=>{
  const fetcher=vi.fn(async()=>Response.json({deleted:true}));
  await createDraftClient(csrf,fetcher as typeof fetch).delete(target);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [path,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit];
  expect(path).toBe('/api/private/drafts/'+id);expect(init).toMatchObject({method:'DELETE',credentials:'same-origin',cache:'no-store',redirect:'error'});
  expect(new Headers(init.headers).get('Authorization')).toBe('Bearer csrf.'+csrf);
  expect(JSON.parse(init.body as string)).toEqual({expectedVersion:1});
 });
 it('rejects ambiguous acknowledgements and invalid versions without automatic mutation retries',async()=>{
  for(const result of [{deleted:false},{},{deleted:true,body:'extra'},value]){
   const fetcher=vi.fn(async()=>Response.json(result));
   await expect(createDraftClient(csrf,fetcher as typeof fetch).delete(target)).rejects.toBeInstanceOf(DraftClientError);expect(fetcher).toHaveBeenCalledTimes(1);
  }
  for(const status of [401,404,503])await expect(createDraftClient(csrf,(async()=>Response.json({deleted:true},{status})) as typeof fetch).delete(target)).rejects.toBeInstanceOf(DraftClientError);
  const fetcher=vi.fn();await expect(createDraftClient(csrf,fetcher as typeof fetch).delete({...target,version:0})).rejects.toBeInstanceOf(DraftClientError);expect(fetcher).not.toHaveBeenCalled();
 });
 it('times out stalled DELETE response EOF without retrying or accepting late success',async()=>{
  vi.useFakeTimers();let end=()=>{};
  const fetcher=vi.fn(async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"deleted":true}'));end=()=>{try{c.close()}catch{}}}}),{headers:{'Content-Type':'application/json'}}));
  const pending=createDraftClient(csrf,fetcher as typeof fetch).delete(target),rejected=expect(pending).rejects.toBeInstanceOf(DraftClientError);
  await vi.advanceTimersByTimeAsync(10000);await rejected;end();await vi.advanceTimersByTimeAsync(1);expect(fetcher).toHaveBeenCalledTimes(1);
 });
});
