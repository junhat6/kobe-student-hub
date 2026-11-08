import {beforeAll,afterAll,it,expect} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync} from 'node:fs';
import {base64url,jwtDecrypt} from 'jose';
import {googleFixture,TEST_CLIENT_ID} from './helpers/google-fixtures';
import {enrollmentWindow} from '../src/shared/enrollment';

const O='https://registration.example.invalid',NOW=Date.now(),key=crypto.getRandomValues(new Uint8Array(32));
const bindings={AUTH_ORIGIN:O,GOOGLE_CLIENT_ID:TEST_CLIENT_ID,GOOGLE_CLIENT_SECRET:'fictional-only-secret',OAUTH_COOKIE_KEY:base64url.encode(key)};
const years={admissionYear:2026,graduationYear:2028};
let mf:Miniflare,fixture:Awaited<ReturnType<typeof googleFixture>>,exchanges=0;const tokens=new Map<string,string>();
async function http(path:string,method='GET',headers:Record<string,string>={},body?:string,extra:Record<string,unknown>={}){return mf.dispatchFetch('https://fixture.invalid',{method:'POST',redirect:'manual',body:JSON.stringify({url:O+path,method,headers,body,now:NOW,bindings,...extra})})}
type HttpResponse=Awaited<ReturnType<typeof http>>;
const cookie=(response:HttpResponse)=>response.headers.getSetCookie().map(value=>value.split(';')[0]);
async function command(context:string,action='self-registration'){const response=await http('/api/auth/command?action='+action,'POST',{Origin:O,Cookie:context});expect(response.status).toBe(200);return (await response.json() as {commandToken:string}).commandToken}
type Start={url:URL;cookies:string;context:string};
async function start(input:unknown=years,login=false):Promise<Start>{
 const boot=await http('/api/auth/bootstrap','POST',{Origin:O});expect(boot.status).toBe(204);const context=cookie(boot)[0],proof=await command(context,login?'login':'self-registration');
 const response=await http(login?'/api/auth/start':'/api/auth/register','POST',{Origin:O,Cookie:context,Authorization:'Bearer command.'+proof,...(login?{}:{'Content-Type':'application/json'})},login?undefined:JSON.stringify(input));
 expect(response.status).toBe(303);return {url:new URL(response.headers.get('Location')!),cookies:[...cookie(response),context].join('; '),context};
}
async function prepare(subject:string,input:unknown=years,patch:Record<string,unknown>={},login=false){const attempt=await start(input,login),state=attempt.url.searchParams.get('state')!;tokens.set(state,await fixture.sign({sub:subject,email:subject+'@st.kobedenshi.ac.jp',nonce:attempt.url.searchParams.get('nonce'),...patch}));return attempt}
async function finish(attempt:Start,extra:Record<string,unknown>={}){const state=attempt.url.searchParams.get('state')!;const response=await http('/api/auth/callback?state='+state+'&code='+state,'GET',{Cookie:attempt.cookies},undefined,extra);expect(response.status).toBe(303);expect(response.headers.get('Location')).toBe(O+'/');expect(response.headers.get('Cache-Control')).toBe('private, no-store');return response}
const sessionCookie=(response:HttpResponse)=>cookie(response).find(value=>value.startsWith('__Host-kobe-session='));
const database=()=>mf.getD1Database('DB');
async function account(subject:string){return (await database()).prepare('SELECT * FROM private_accounts WHERE google_subject=?').bind(subject).first<Record<string,unknown>>()}
async function period(subject:string){return (await database()).prepare('SELECT p.* FROM private_enrollment_periods p JOIN private_accounts a ON a.id=p.owner_account_id WHERE a.google_subject=?').bind(subject).first<Record<string,unknown>>()}
async function seed(subject:string,status='active',epoch=0,email=subject+'@st.kobedenshi.ac.jp'){await(await database()).prepare('INSERT INTO private_accounts(id,google_subject,email,status,session_epoch,created_at_ms) VALUES(?,?,?,?,?,?)').bind('account-'+subject,subject,email,status,epoch,NOW).run()}
async function count(table:string){return (await(await database()).prepare('SELECT count(*) n FROM '+table).first<{n:number}>())!.n}

beforeAll(async()=>{
 fixture=await googleFixture();mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.worker/self-registration-test.js',compatibilityDate:'2026-11-03',d1Databases:['DB'],outboundService:async request=>{
  if(request.url==='https://www.googleapis.com/oauth2/v3/certs')return Response.json(fixture.jwks);
  expect(request.url).toBe('https://oauth2.googleapis.com/token');exchanges++;const form=new URLSearchParams(await request.text());expect(form.get('redirect_uri')).toBe(O+'/api/auth/callback');expect(form.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);return Response.json({id_token:tokens.get(form.get('code')!),access_token:'PRIVATE_PROVIDER_TOKEN'});
 }}));const db=await database();
 for(const file of ['0003_oauth_attempts.sql','0004_private_sessions.sql','0012_browser_session_order.sql','0016_self_declared_enrollment.sql','0017_self_registration.sql']){const source=readFileSync('migrations/'+file,'utf8');const parts=source.includes('-- @statement')?source.split(/^-- @statement\s*$/m):source.replace(/^--.*$/gm,'').split(/;\s*(?:\n|$)/);for(const sql of parts.map(part=>part.replace(/^--.*$/gm,'').trim()).filter(Boolean))await db.prepare(sql).run()}
});
afterAll(async()=>{await mf?.dispose()});

it('binds two private years to one sealed attempt and creates a usable same-callback session',async()=>{
 const attempt=await prepare('new'),state=attempt.url.searchParams.get('state')!,sealed=attempt.cookies.split('; ')[0].split('=')[1];
 expect((await jwtDecrypt(sealed,key,{currentDate:new Date(NOW)})).payload.aud).toBe(TEST_CLIENT_ID+'|'+O+'/api/auth/callback|self-registration');
 expect(attempt.url.searchParams.has('admissionYear')).toBe(false);expect(attempt.url.searchParams.has('graduationYear')).toBe(false);
 const response=await finish(attempt),session=sessionCookie(response);expect(session).toBeDefined();expect(await account('new')).toMatchObject({status:'active',session_epoch:1,created_at_ms:NOW});
 expect(await period('new')).toMatchObject({admission_year:years.admissionYear,graduation_year:years.graduationYear,starts_at_ms:enrollmentWindow(years)!.startsAtMs,ends_at_ms:enrollmentWindow(years)!.endsAtMs,policy_version:1,version:1,updated_at_ms:NOW});
 expect(await(await database()).prepare('SELECT completed_at_ms FROM oauth_attempts WHERE state_hash=(SELECT state_hash FROM auth_self_registration_commits WHERE account_id=?)').bind((await account('new'))!.id).first()).toEqual({completed_at_ms:NOW});
 const inspection=await http('/api/private/session','GET',{Cookie:session+'; '+attempt.context});expect(inspection.status).toBe(200);expect(await inspection.json()).toMatchObject({csrfToken:expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)});
 expect(sessionCookie(await finish(attempt))).toBeUndefined();expect(state).toBeTruthy();for(const value of ['new@','PRIVATE_PROVIDER_TOKEN','fictional-only-secret','admissionYear','graduationYear'])expect(response.headers.get('Set-Cookie')).not.toContain(value);
});

it('keeps ordinary unknown login account-free and refuses invalid signed identity',async()=>{
 const response=await finish(await prepare('unknown-login',years,{},true));expect(sessionCookie(response)).toBeUndefined();expect(await account('unknown-login')).toBeNull();
 for(const patch of [{nonce:'wrong'},{hd:'other.invalid'},{email_verified:false}]){const attempt=await prepare('bad-identity',years,patch);expect(sessionCookie(await finish(attempt))).toBeUndefined();expect(await account('bad-identity')).toBeNull();expect(sessionCookie(await finish(attempt))).toBeUndefined()}
});

it('rejects mismatched sealed purposes before claiming the one-time attempt',async()=>{
 for(const login of [false,true]){const subject=login?'purpose-login':'purpose-registration',attempt=await prepare(subject,years,{},login),state=attempt.url.searchParams.get('state')!;const response=await http('/api/auth/callback?state='+state+'&code='+state,'GET',{Cookie:attempt.cookies},undefined,{claimPurpose:login?'self-registration':'login'});expect(await response.json()).toBeNull();const before=exchanges,finished=await finish(attempt);expect(exchanges-before).toBe(1);expect(!!sessionCookie(finished)).toBe(!login)}
});

it('binds the original years to the executed command and rejects changed-year command replay',async()=>{
 const boot=await http('/api/auth/bootstrap','POST',{Origin:O}),context=cookie(boot)[0],proof=await command(context),headers={Origin:O,Cookie:context,Authorization:'Bearer command.'+proof,'Content-Type':'application/json'};
 const first=await http('/api/auth/register','POST',headers,JSON.stringify(years));expect(first.status).toBe(303);const attempt={url:new URL(first.headers.get('Location')!),cookies:[...cookie(first),context].join('; '),context};
 expect((await http('/api/auth/register','POST',headers,JSON.stringify({admissionYear:2025,graduationYear:2027}))).status).toBe(400);
 const state=attempt.url.searchParams.get('state')!;tokens.set(state,await fixture.sign({sub:'bound-years',email:'bound-years@st.kobedenshi.ac.jp',nonce:attempt.url.searchParams.get('nonce')}));expect(sessionCookie(await finish(attempt))).toBeDefined();expect(await period('bound-years')).toMatchObject({admission_year:2026,graduation_year:2028});
});

it('accepts explicit declaration for an existing active account without replacing identity or epoch',async()=>{
 await seed('existing-active','active',7);const before=await account('existing-active'),response=await finish(await prepare('existing-active'));expect(sessionCookie(response)).toBeDefined();expect(await account('existing-active')).toEqual(before);expect(await period('existing-active')).toMatchObject({version:1,...{admission_year:2026,graduation_year:2028}});
});

it('activates an existing pending account and preserves its status epoch and subject-floor guarantees',async()=>{
 await seed('existing-pending','pending',4);const before=await account('existing-pending'),response=await finish(await prepare('existing-pending'));expect(sessionCookie(response)).toBeDefined();expect(await account('existing-pending')).toEqual({...before,status:'active',session_epoch:5});
 const db=await database();expect(await db.prepare('SELECT generation FROM auth_subject_fences WHERE google_subject=?').bind('existing-pending').first()).toEqual(await db.prepare('SELECT generation FROM auth_revocation_fence WHERE id=1').first());
});

it('retains the first declaration on later registration callbacks, including ended periods',async()=>{
 const old={admissionYear:2020,graduationYear:2021},first=await finish(await prepare('retained',old));expect(sessionCookie(first)).toBeDefined();const initial=await period('retained');expect(sessionCookie(await finish(await prepare('retained')))).toBeDefined();expect(await period('retained')).toEqual(initial);
});

it('never restores suspended/deleted accounts, links another subject by email or overwrites contact',async()=>{
 for(const status of ['suspended','deleted']){const subject='blocked-'+status;await seed(subject,status,5);const before=await account(subject);expect(sessionCookie(await finish(await prepare(subject)))).toBeUndefined();expect(await account(subject)).toEqual(before);expect(await period(subject)).toBeNull()}
 await seed('contact-owner');const initial=await account('contact-owner');expect(sessionCookie(await finish(await prepare('contact-owner',years,{email:'changed@st.kobedenshi.ac.jp'})))).toBeUndefined();expect(await account('contact-owner')).toEqual(initial);
 expect(sessionCookie(await finish(await prepare('collision',years,{email:'CONTACT-OWNER@ST.KOBEDENSHI.AC.JP'})))).toBeUndefined();expect(await account('collision')).toBeNull();
});

it('issues one exchange, account, declaration and session for twelve simultaneous identical callbacks',async()=>{
 const attempt=await prepare('parallel'),before=exchanges,sessions=await count('auth_sessions');const responses=await Promise.all(Array.from({length:12},()=>finish(attempt)));expect(responses.filter(sessionCookie)).toHaveLength(1);expect(exchanges-before).toBe(1);expect(await count('auth_sessions')).toBe(sessions+1);expect(await period('parallel')).toMatchObject({version:1});
});

it('refuses an older independently claimed callback after a competing registration activates the subject',async()=>{
 const a=await prepare('competing'),b=await prepare('competing',{admissionYear:2025,graduationYear:2027});const responses=await Promise.all([finish(a),finish(b)]);expect(responses.filter(sessionCookie)).toHaveLength(1);expect(await period('competing')).toMatchObject({version:1});expect(await(await database()).prepare('SELECT count(*) n FROM auth_sessions WHERE account_id=?').bind((await account('competing'))!.id).first()).toEqual({n:1});
});

it('rechecks suspension, account epoch and browser generation immediately before the terminal transaction',async()=>{
 for(const race of [{subject:'race-suspended',status:'suspended'},{subject:'race-epoch',epoch:true},{subject:'race-context',generation:true}]){await seed(race.subject,'pending',2);const attempt=await prepare(race.subject);expect(sessionCookie(await finish(attempt,{race}))).toBeUndefined();expect(await period(race.subject)).toBeNull();expect((await account(race.subject))!.status).toBe(race.status??'pending')}
});

it('rolls back activation, floor, declaration and receipt when final session insertion is ignored',async()=>{
 const db=await database();await seed('rollback-pending','pending',3);const before=await account('rollback-pending'),fence=await db.prepare('SELECT * FROM auth_revocation_fence').first();
 await db.prepare("CREATE TRIGGER registration_session_noop BEFORE INSERT ON auth_sessions WHEN NEW.account_id='account-rollback-pending' OR EXISTS(SELECT 1 FROM private_accounts a WHERE a.id=NEW.account_id AND a.google_subject='rollback-new') BEGIN SELECT RAISE(IGNORE); END").run();
 try{for(const subject of ['rollback-pending','rollback-new']){const attempt=await prepare(subject);expect(sessionCookie(await finish(attempt))).toBeUndefined();expect(await period(subject)).toBeNull();expect(sessionCookie(await finish(attempt))).toBeUndefined()}expect(await account('rollback-pending')).toEqual(before);expect(await account('rollback-new')).toBeNull();expect(await db.prepare('SELECT * FROM auth_revocation_fence').first()).toEqual(fence);expect(await db.prepare("SELECT count(*) n FROM auth_self_registration_commits WHERE account_id='account-rollback-pending'").first()).toEqual({n:0})}finally{await db.prepare('DROP TRIGGER registration_session_noop').run()}
});

it('rejects missing/extra/oversized/invalid years and foreign Origin before consuming the command',async()=>{
 const boot=await http('/api/auth/bootstrap','POST',{Origin:O}),context=cookie(boot)[0],proof=await command(context),headers={Origin:O,Cookie:context,Authorization:'Bearer command.'+proof,'Content-Type':'application/json'};const before=await count('oauth_attempts');
 for(const input of [{},{admissionYear:2026},{...years,email:'client@st.kobedenshi.ac.jp'},{...years,admissionYear:'2026'},{admissionYear:2199,graduationYear:2200},{admissionYear:2028,graduationYear:2026}])expect((await http('/api/auth/register','POST',headers,JSON.stringify(input))).status).toBe(400);
 expect((await http('/api/auth/register','POST',headers,' '.repeat(129))).status).toBe(400);expect((await http('/api/auth/register','POST',{...headers,Origin:'https://foreign.invalid'},JSON.stringify(years))).status).toBe(400);expect(await count('oauth_attempts')).toBe(before);
 expect((await http('/api/auth/register','POST',headers,JSON.stringify(years))).status).toBe(303);expect(await count('oauth_attempts')).toBe(before+1);
});

it('accepts fragmented bodies and waits for delayed EOF before starting OAuth',async()=>{
 for(const streamMode of ['small','slow-eof']){const boot=await http('/api/auth/bootstrap','POST',{Origin:O}),context=cookie(boot)[0],proof=await command(context),began=Date.now();
  const response=await http('/api/auth/register','POST',{Origin:O,Cookie:context,Authorization:'Bearer command.'+proof,'Content-Type':'application/json'},JSON.stringify(years),{streamMode});
  expect(response.status).toBe(303);expect(response.headers.get('X-Fixture-Stream-Cancelled')).toBe('false');if(streamMode==='slow-eof')expect(Date.now()-began).toBeGreaterThanOrEqual(60);
 }
});

it('bounds empty-chunk floods and streamed size without awaiting noncooperative cancellation',async()=>{
 const boot=await http('/api/auth/bootstrap','POST',{Origin:O}),context=cookie(boot)[0],proof=await command(context),headers={Origin:O,Cookie:context,Authorization:'Bearer command.'+proof,'Content-Type':'application/json'},before=await count('oauth_attempts');
 for(const streamMode of ['empty','oversize']){const response=await http('/api/auth/register','POST',headers,undefined,{streamMode});expect(response.status).toBe(400);expect(cookie(response)).toEqual([]);expect(response.headers.get('X-Fixture-Stream-Cancelled')).toBe('true');if(streamMode==='empty'){expect(Number(response.headers.get('X-Fixture-Stream-Pulls'))).toBeGreaterThanOrEqual(128);expect(Number(response.headers.get('X-Fixture-Stream-Pulls'))).toBeLessThanOrEqual(130)}}
 const mismatch=await http('/api/auth/register','POST',{...headers,'Content-Length':'2'},JSON.stringify(years),{streamMode:'small'});expect(mismatch.status).toBe(400);expect(cookie(mismatch)).toEqual([]);expect(await count('oauth_attempts')).toBe(before);
 expect((await http('/api/auth/register','POST',headers,JSON.stringify(years))).status).toBe(303);expect(await count('oauth_attempts')).toBe(before+1);
});

it('expires complete-looking JSON with late or missing EOF without consuming its command',async()=>{
 const before=await count('oauth_attempts'),providerCalls=exchanges;
 const requests=await Promise.all(['late-eof','never-eof'].map(async streamMode=>{const boot=await http('/api/auth/bootstrap','POST',{Origin:O}),context=cookie(boot)[0],proof=await command(context);return {streamMode,headers:{Origin:O,Cookie:context,Authorization:'Bearer command.'+proof,'Content-Type':'application/json'}}}));
 const began=Date.now(),responses=await Promise.all(requests.map(({streamMode,headers})=>http('/api/auth/register','POST',headers,JSON.stringify(years),{streamMode})));
 expect(Date.now()-began).toBeGreaterThanOrEqual(4900);
 for(const response of responses){expect(response.status).toBe(400);expect(cookie(response)).toEqual([]);expect(response.headers.get('X-Fixture-Stream-Cancelled')).toBe('true')}
 expect(await count('oauth_attempts')).toBe(before);expect(exchanges).toBe(providerCalls);
 // Both original commands remain usable after the bounded body failures.
 for(const {headers} of requests)expect((await http('/api/auth/register','POST',headers,JSON.stringify(years))).status).toBe(303);
 expect(await count('oauth_attempts')).toBe(before+2);
},15000);
