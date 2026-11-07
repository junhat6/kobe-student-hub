import {it,expect} from 'vitest';
import app from '../worker/index';
const origin='https://fixture.example.test',now=Date.now();
const env={DB:{prepare(){throw Error('unexpected database access')}},ASSETS:{fetch:async(r:Request)=>new Response(new URL(r.url).pathname)},AUTH_ORIGIN:origin,GOOGLE_CLIENT_ID:'fixture.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'fictional',OAUTH_COOKIE_KEY:'FxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxc'};
async function req(path:string,extra:Record<string,unknown>={}){return app.fetch(new Request(origin+path),{...env,...extra} as unknown as Env)}
it('production entry keeps the trial closed without a valid private server setting',async()=>{
 for(const setting of [undefined,'{}','invalid',JSON.stringify({accountId:'fixture',accountEpoch:0,expiresAtMs:now-1})]){
  expect((await req('/api/auth/draft-trial',{OAUTH_DRAFT_TRIAL:setting})).status).toBe(404);
  expect((await req('/trial-assets/assets/trial.js',{OAUTH_DRAFT_TRIAL:setting})).status).toBe(404);
 }
 expect((await req('/api/private/session')).status).toBe(405);
});
it('valid setting serves only trial assets from dedicated dist paths without exposing policy',async()=>{
 const policy=JSON.stringify({accountId:'fixture',accountEpoch:0,expiresAtMs:now+60000});
 for(const [path,expected] of [['/api/auth/draft-trial','/trial-assets/index.html'],['/trial-assets/assets/trial.js','/trial-assets/assets/trial.js']] as const){const r=await req(path,{OAUTH_DRAFT_TRIAL:policy});expect(r.status).toBe(200);expect(await r.text()).toBe(expected);expect(r.headers.get('Cache-Control')).toBe('private, no-store')}
 expect((await req('/api/private/publications',{OAUTH_DRAFT_TRIAL:policy})).status).toBe(405);
});
