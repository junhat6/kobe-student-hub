// Local-only fictional provider + ephemeral D1; never deploy this entry or its assets.
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync} from 'node:fs';
await build({entryPoints:['tests/fixtures/limited-browser-worker.ts'],outfile:'.worker/limited-browser.js',bundle:true,format:'esm',platform:'browser'});
await build({entryPoints:['tests/helpers/google-fixtures.ts'],outfile:'.worker/limited-google.mjs',bundle:true,format:'esm',platform:'node'});
const {googleFixture,TEST_EMAIL,TEST_CLIENT_ID}=await import('../.worker/limited-google.mjs'),signer=await googleFixture();
const origin='https://127.0.0.1:8792';let ready=false;const expiry=Date.now()+600000;
const mf=new Miniflare(convertV4MiniflareOptions({name:'local-limited-drafts',modules:true,scriptPath:'.worker/limited-browser.js',compatibilityDate:'2026-11-03',host:'127.0.0.1',port:8792,https:true,d1Databases:['DB'],assets:{directory:'.limited-preview',binding:'ASSETS',routerConfig:{has_user_worker:true},run_worker_first:['/api/*'],assetConfig:{not_found_handling:'single-page-application'}},bindings:{AUTH_ORIGIN:origin,GOOGLE_CLIENT_ID:TEST_CLIENT_ID,GOOGLE_CLIENT_SECRET:'synthetic-only',OAUTH_COOKIE_KEY:'FxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxc',LOCAL_RESTRICTION:{accountId:'account-a',accountEpoch:0,expiresAtMs:expiry}},outboundService:async r=>{
 if(r.url==='https://limited-readiness.invalid/')return new Response('',{status:ready?200:503});
 if(r.url==='https://www.googleapis.com/oauth2/v3/certs')return Response.json(signer.jwks);
 if(r.url==='https://oauth2.googleapis.com/token'){const f=new URLSearchParams(await r.text());return Response.json({id_token:await signer.sign({nonce:f.get('code')})})}
 throw Error('Unexpected provider');
}}));
const db=await mf.getD1Database('DB');
for(const f of ['0003_oauth_attempts.sql','0004_private_sessions.sql','0005_private_article_drafts.sql','0012_browser_session_order.sql']){
 const sql=readFileSync('migrations/'+f,'utf8'),parts=sql.includes('-- @statement')?sql.split('-- @statement'):sql.replace(/^--.*$/gm,'').split(/;\s*(?:\n|$)/);
 for(const p of parts)if(p.replace(/^--.*$/gm,'').trim())await db.prepare(p).run();
}
await db.prepare("INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES('account-a','fictional-google-subject',?,'active',?)").bind(TEST_EMAIL,Date.now()).run();
await db.prepare(readFileSync('tests/fixtures/limited-draft-grants.sql','utf8')).run();
await db.prepare('INSERT INTO limited_draft_grants(account_id,account_epoch,expires_at_ms,revoked_at_ms) VALUES(?,?,?,NULL)').bind('account-a',0,expiry).run();
ready=true;await mf.ready;console.log('Local limited draft fixture ready');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await mf.dispose();process.exit()});
