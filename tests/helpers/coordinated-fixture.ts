import enrollmentSchema from '../../migrations/0016_self_declared_enrollment.sql';
import {enrollmentWindow} from '../../src/shared/enrollment';
import {AUTHORIZATION_HEADER,proofAuthorization} from '../../src/shared/auth-proof';
// Test-only identity/schema preparation. Never import from worker/ or production bundles.
import migration from '../../migrations/0012_browser_session_order.sql';
import sessionSchema from '../../migrations/0004_private_sessions.sql';
import attempts from '../../migrations/0003_oauth_attempts.sql';
import {BrowserSessionCoordinator} from '../../worker/auth/browser-session';
import {BrowserOAuthFlow,type OAuthIntent,isSameOriginPost} from '../../worker/auth/browser-flow';
import {SessionStore} from '../../worker/auth/sessions';
import type {VerifiedSchoolIdentity} from '../../worker/auth/google-identity';
export async function ensureFixtureOrderSchema(db:D1Database){
 const cols=(await db.prepare('PRAGMA table_info(auth_sessions)').all<{name:string}>()).results;if(!cols.length)for(const sql of sessionSchema.replace(/^--.*$/gm,'').split(/;\s*(?:\n|$)/).filter(s=>s.trim()))await db.prepare(sql).run();if(cols.some(c=>c.name==='context_hash'))return;
 if(!await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='oauth_attempts'").first())for(const sql of attempts.replace(/^--.*$/gm,'').split(/;\s*(?:\n|$)/).filter(s=>s.trim()))await db.prepare(sql).run();
 const statements=migration.split(/^-- @statement\s*$/m).map(s=>s.replace(/^--.*$/gm,'').trim()).filter(Boolean);
 try{await db.batch(statements.map(s=>db.prepare(s)))}catch(e){const after=await db.prepare('PRAGMA table_info(auth_sessions)').all<{name:string}>();if(!after.results.some(c=>c.name==='context_hash'))throw e}
}
const config=(origin:string)=>({origin,clientId:'fixture.apps.googleusercontent.com',cookieKey:new Uint8Array(32).fill(29)});
export async function fixtureStartRequest(db:D1Database,request:Request,origin:string,now:number,action:OAuthIntent='login'){
 if(!isSameOriginPost(request,origin))return {request,contextCookie:''};
 await ensureFixtureOrderSchema(db);const coordinator=new BrowserSessionCoordinator(db,origin,()=>now);
 const bootstrap=await coordinator.bootstrap(new Request(origin+'/api/auth/bootstrap',{method:'POST',headers:{Origin:origin}}));if(!bootstrap)return {request,contextCookie:''};
 const contextCookie=bootstrap.setCookie,headers=new Headers(request.headers);headers.set('Cookie',contextCookie.split(';')[0]);
 const proof=await coordinator.command(new Request(origin+'/api/auth/command',{method:'POST',headers}),action);if(!proof)return {request,contextCookie};headers.set(AUTHORIZATION_HEADER,proofAuthorization('command',proof.commandToken));
 return {request:new Request(request.url,{method:request.method,headers}),contextCookie};
}
export async function fixtureClaim(db:D1Database,origin:string,now:number,intent:OAuthIntent='login'){
 const start=await fixtureStartRequest(db,new Request(origin+'/api/auth/start',{method:'POST',headers:{Origin:origin}}),origin,now,intent),flow=new BrowserOAuthFlow(db,config(origin),()=>now);
 const attempt=await flow.start(start.request,intent);if(!attempt)return null;const state=new URL(attempt.location).searchParams.get('state')!;
 const claim=await flow.claim(new Request(origin+'/api/auth/callback?state='+state+'&code=fictional',{headers:{Cookie:start.contextCookie.split(';')[0]+'; '+attempt.setCookie.split(';')[0]}}),intent);
 return claim?.kind==='code'?{proof:claim.proof,contextCookie:start.contextCookie}:null;
}
export async function seedFixtureEnrollment(db:D1Database,now:number,subject:string){
 if(!await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='private_enrollment_periods'").first()){
  const statements=(enrollmentSchema.includes('-- @statement')?enrollmentSchema.split(/^-- @statement\s*$/m):enrollmentSchema.split(/;\s*(?:\n|$)/)).map(s=>s.replace(/^--.*$/gm,'').trim()).filter(Boolean);
  try{await db.batch(statements.map(s=>db.prepare(s)))}catch(e){if(!await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='private_enrollment_periods'").first())throw e}
 }
 const date=new Date(now+9*3600000),academicYear=date.getUTCFullYear()-(date.getUTCMonth()<3?1:0);
 const years={admissionYear:academicYear-1,graduationYear:academicYear+1},period=enrollmentWindow(years);if(!period)throw Error('Invalid fixture enrollment window');
 await db.prepare(`INSERT INTO private_enrollment_periods(owner_account_id,admission_year,graduation_year,starts_at_ms,ends_at_ms,policy_version,version,updated_at_ms) SELECT id,?,?,?,?,1,1,? FROM private_accounts WHERE google_subject=? ON CONFLICT(owner_account_id) DO NOTHING`).bind(years.admissionYear,years.graduationYear,period.startsAtMs,period.endsAtMs,now,subject).run();
}
export async function createFixtureSession(db:D1Database,origin:string,clock:()=>number,identity:VerifiedSchoolIdentity,options:{enrollment?:boolean}={}){
 try{if(!(await db.prepare('PRAGMA table_info(auth_sessions)').all()).results.length)return null;const now=clock();if(!Number.isSafeInteger(now)||now<0||now>=Number.MAX_SAFE_INTEGER-28800000)return null;const claim=await fixtureClaim(db,origin,now);if(!claim)return null;const session=await new SessionStore(db,origin,clock).create(identity,claim.proof);if(session&&options.enrollment!==false)await seedFixtureEnrollment(db,now,identity.subject);return session?{...session,contextCookie:claim.contextCookie}:null}catch{return null}
}
