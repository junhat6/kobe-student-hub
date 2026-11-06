import {it,expect} from 'vitest';
import {createTrialAssetHandler} from '../worker/limited-draft-trial-entry';
const origin='https://fixture.example.test',now=1800000000000;
const bindings={AUTH_ORIGIN:origin,GOOGLE_CLIENT_ID:'fixture.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'fictional-secret',OAUTH_COOKIE_KEY:'FxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxc'};
it('serves the fixed trial entry and bundled assets only for unexpired server policy',async()=>{
 const paths:string[]=[];const assets={fetch:async(r:Request)=>{paths.push(new URL(r.url).pathname);return new Response('fixture')}} as unknown as Fetcher;
 const policy=()=>({accountId:'fictional',accountEpoch:0,expiresAtMs:now+60000}),handler=createTrialAssetHandler(assets,bindings,policy,()=>now);
 for(const [url,expected] of [['/api/auth/draft-trial','/index.html'],['/trial-assets/assets/index-A.js','/assets/index-A.js']] as const){const r=await handler(new Request(origin+url));expect(r?.status).toBe(200);expect(r?.headers.get('Cache-Control')).toBe('private, no-store');expect(paths.at(-1)).toBe(expected)}
 for(const path of ['/api/auth/draft-trial?bad=1','/trial-assets/private.js','/trial-assets/assets/x.js?bad=1'])expect((await handler(new Request(origin+path)))?.status).toBe(404);
 expect((await handler(new Request('https://other.example.test/api/auth/draft-trial')))?.status).toBe(404);
 expect((await createTrialAssetHandler(assets,bindings,policy,()=>now+60000)(new Request(origin+'/api/auth/draft-trial')))?.status).toBe(404);
 expect((await createTrialAssetHandler(assets,bindings,()=>null,()=>now)(new Request(origin+'/api/auth/draft-trial')))?.status).toBe(404);
 expect(await handler(new Request(origin+'/api/unrelated'))).toBeNull();
});
