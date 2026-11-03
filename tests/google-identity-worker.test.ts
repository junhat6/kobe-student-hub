import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { googleFixture, TEST_CLIENT_ID, TEST_NONCE } from './helpers/google-fixtures';
let fixture: Awaited<ReturnType<typeof googleFixture>>; let mf: Miniflare;
beforeAll(async()=>{
 fixture=await googleFixture();
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.worker/auth-test.js',compatibilityDate:'2026-11-03',bindings:{TEST_CLIENT_ID,TEST_EXPECTED_NONCE:TEST_NONCE},outboundService:async(request)=>{
  expect(request.url).toBe('https://www.googleapis.com/oauth2/v3/certs');
  return Response.json(fixture.jwks);
 }}));
});
afterAll(async()=>{await mf?.dispose()});
describe('same verifier in the Workers runtime',()=>{
 it('accepts a real signed fixture with the fixed Google JWKS response',async()=>{const r=await mf.dispatchFetch('http://fixture.test',{method:'POST',body:await fixture.sign()});expect(r.status).toBe(200);expect(await r.json()).toEqual({verified:true})});
 it('rejects forged signatures and non-school identities',async()=>{const foreign=await googleFixture();for(const token of [await foreign.sign(),await fixture.sign({hd:'example.invalid'}),await fixture.sign({nonce:'wrong'})]){const r=await mf.dispatchFetch('http://fixture.test',{method:'POST',body:token});expect(r.status).toBe(401);expect(await r.json()).toEqual({verified:false})}});
});
