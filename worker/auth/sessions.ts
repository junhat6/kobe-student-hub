import {AUTHORIZATION_HEADER,proofAuthorization,parseProofAuthorization,hasLegacyProofHeader} from '../../src/shared/auth-proof';
import {base64url} from 'jose';
import type {VerifiedSchoolIdentity} from './google-identity';
import type {ServerSessionActor} from './private-access';
import {BrowserSessionCoordinator,CONTEXT_COOKIE,singleSecretCookie,browserDigest,type BrowserClaim} from './browser-session';
import {SESSION_ABSOLUTE_MS,SESSION_IDLE_MS,type SessionStorageProof,type SessionRestrictionReader,readSessionRestriction,sessionRestrictionSql,sessionRestrictionBindings} from './session-guard';
export {SESSION_ABSOLUTE_MS,SESSION_IDLE_MS} from './session-guard';
const NAME='__Host-kobe-session';
const validToken=(v:string)=>/^[A-Za-z0-9_-]{43}$/.test(v);
const cookie=(value:string,age:number)=>`${NAME}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
async function hash(value:string){return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))}
const tokenHash=async(token:string)=>Array.from(await hash('session-v1:'+token),x=>x.toString(16).padStart(2,'0')).join('');
const csrf=async(token:string)=>base64url.encode(await hash('csrf-v1:'+token));
/** Server-private issuance material. Return only the cookie and explicit CSRF DTO to a browser. */
export async function newSessionMaterial(){const raw=base64url.encode(crypto.getRandomValues(new Uint8Array(32)));return {tokenHash:await tokenHash(raw),csrfToken:await csrf(raw),setCookie:cookie(raw,SESSION_ABSOLUTE_MS/1000)}}
function rawCookie(request:Request){
 const header=request.headers.get('Cookie');if(!header||header.length>16384)return null;
 const values=header.split(';').map(x=>x.trim()).filter(x=>x.startsWith(NAME+'=')).map(x=>x.slice(NAME.length+1));return values.length===1&&validToken(values[0])?values[0]:null;
}
function equalToken(a:string,b:string){if(!validToken(a)||!validToken(b))return false;let diff=0;for(let i=0;i<43;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
/** Server-private result; never serialize its actor or storage state directly. */
export type SessionInspection={kind:'authenticated';actor:ServerSessionActor;csrfToken:string;contextHash:string;generation:number;checkedAt:number}|{kind:'signed-out'}|{kind:'unavailable'};
/** No production endpoint uses this repository. Identity must come from real server verification. */
export class SessionStore {
 constructor(private readonly db:D1Database,private readonly origin:string,private readonly clock:()=>number=Date.now,private readonly restriction?:SessionRestrictionReader){}
 private now(){const n=this.clock();return Number.isSafeInteger(n)&&n>=0&&n<Number.MAX_SAFE_INTEGER-SESSION_ABSOLUTE_MS?n:null}
 private configured(){try{return new URL(this.origin).protocol==='https:'&&new URL(this.origin).origin===this.origin}catch{return false}}
 /** Creates no account/admission. Caller must never construct identity from client input. */
 async create(identity:VerifiedSchoolIdentity,claim:BrowserClaim):Promise<{setCookie:string;csrfToken:string;actor:ServerSessionActor}|null>{
  if(!claim||!this.configured()||identity?.provider!=='google'||typeof identity.subject!=='string'||(!identity.subject.trim()||identity.subject.length>255)||typeof identity.email!=='string'||identity.email.length>320||!/^[^@\s]+@st\.kobedenshi\.ac\.jp$/i.test(identity.email))return null;
  try{
   const material=await newSessionMaterial();const digest=material.tokenHash;const now=this.now();if(now===null)return null;
   const row=await this.db.prepare(`INSERT INTO auth_sessions(token_hash,account_id,account_epoch,created_at_ms,last_seen_ms,expires_at_ms,context_hash,context_generation,attempt_hash)
    SELECT ?1,a.id,a.session_epoch,?2,?2,min(?3,c.expires_at_ms,?15),c.context_hash,c.generation,t.state_hash FROM private_accounts a JOIN oauth_attempts t ON t.state_hash=?4 JOIN auth_browser_contexts c ON c.context_hash=t.context_hash JOIN auth_revocation_fence f ON f.id=1
    WHERE a.google_subject=?5 AND a.status=${this.restriction?"'pending'":"'active'"} AND t.intent='login' AND t.claim_owner=?6 AND t.completed_at_ms IS NULL AND t.consumed_at_ms<=?2 AND t.created_at_ms<=?2 AND t.expires_at_ms>?2
    AND c.context_hash=?7 AND c.generation=?8 AND t.context_generation=c.generation AND c.created_at_ms<=?2 AND c.expires_at_ms>?2 AND t.revocation_fence=?9 AND t.revocation_fence>=f.minimum_generation AND NOT EXISTS(SELECT 1 FROM auth_subject_fences b WHERE b.google_subject=a.google_subject AND b.generation>t.revocation_fence) ${this.restriction?"AND (a.id=?10 AND a.session_epoch=?11 AND ?12>?13 AND EXISTS(SELECT 1 FROM limited_draft_grants g WHERE g.account_id=a.id AND g.account_epoch=a.session_epoch AND g.expires_at_ms=?14 AND g.revoked_at_ms IS NULL AND g.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)))":"AND ?10 IS NULL AND ?11 IS NULL AND ?12 IS NULL AND ?13>=0 AND ?14 IS NULL"} RETURNING account_id`)
    .bind(digest,now,now+SESSION_ABSOLUTE_MS,claim.stateHash,identity.subject,claim.owner,claim.contextHash,claim.generation,claim.fence,...sessionRestrictionBindings(this.restriction,now),readSessionRestriction(this.restriction,now)?.expiresAtMs??now+SESSION_ABSOLUTE_MS).first<{account_id:string}>();
   return row?{setCookie:material.setCookie,csrfToken:material.csrfToken,actor:{accountId:row.account_id,accountStatus:this.restriction?'pending':'active'}}:null;
  }catch{return null}
 }
 private async lookup(request:Request):Promise<SessionInspection>{
  if(!this.configured())return {kind:'unavailable'};
  if(hasLegacyProofHeader(request.headers))return {kind:'signed-out'};
  if(new URL(request.url).origin!==this.origin)return {kind:'signed-out'};
  const raw=rawCookie(request),context=singleSecretCookie(request,CONTEXT_COOKIE);if(!raw||!context)return {kind:'signed-out'};
  const contextHash=await browserDigest('browser-v1',context);
  const digest=await tokenHash(raw);const csrfToken=await csrf(raw);const now=this.now();if(now===null)return {kind:'unavailable'};
  const row=await this.db.prepare(`UPDATE auth_sessions SET last_seen_ms=? WHERE token_hash=? AND revoked_at_ms IS NULL
    AND context_hash=? AND EXISTS(SELECT 1 FROM auth_browser_contexts c WHERE c.context_hash=auth_sessions.context_hash AND c.generation=auth_sessions.context_generation AND c.created_at_ms<=? AND c.expires_at_ms>?)
    AND created_at_ms<=? AND last_seen_ms<=? AND last_seen_ms>? AND expires_at_ms>?
    AND EXISTS(SELECT 1 FROM private_accounts a WHERE a.id=auth_sessions.account_id AND a.status=${this.restriction?"'pending'":"'active'"} AND a.session_epoch=auth_sessions.account_epoch ${this.restriction?'AND '+sessionRestrictionSql('a'):'AND ? IS NULL AND ? IS NULL AND ? IS NULL AND ?>=0 AND ? IS NULL'})
    RETURNING account_id,context_generation`).bind(now,digest,contextHash,now,now,now,now,now-SESSION_IDLE_MS,now,...sessionRestrictionBindings(this.restriction,now)).first<{account_id:string;context_generation:number}>();
  return row?{kind:'authenticated',actor:{accountId:row.account_id,accountStatus:this.restriction?'pending':'active'},csrfToken,contextHash,generation:row.context_generation,checkedAt:now}:{kind:'signed-out'};
 }
 /** Existing fail-closed API: storage/configuration failures retain the original null behavior. */
 async authenticate(request:Request):Promise<{actor:ServerSessionActor;csrfToken:string}|null>{
  try{const result=await this.lookup(request);return result.kind==='authenticated'?{actor:result.actor,csrfToken:result.csrfToken}:null}catch{return null}
 }
 /** Distinguishes a failed check from confirmed absence for session lifecycle controllers only. */
 async inspect(request:Request):Promise<SessionInspection>{
  try{return await this.lookup(request)}catch{return {kind:'unavailable'}}
 }
 async authorizeMutation(request:Request){
  if(!['POST','PUT','PATCH','DELETE'].includes(request.method)||request.headers.get('Origin')!==this.origin||!['same-origin','none',null].includes(request.headers.get('Sec-Fetch-Site')))return null;
  const proof=parseProofAuthorization(request.headers),supplied=proof?.purpose==='csrf'?proof.token:null;if(!supplied)return null;
  const session=await this.authenticate(request);return session&&equalToken(session.csrfToken,supplied)?session:null;
 }
 /** Server-private storage proof. Never serialize this value or accept it from clients.
  * Repositories must recheck this session and account inside their final SQL statement. */
 async storageAuthorization(request:Request):Promise<SessionStorageProof|null>{
  if(!['GET','POST','PUT','PATCH','DELETE'].includes(request.method))return null;
  if(request.method!=='GET'&&(request.headers.get('Origin')!==this.origin||!['same-origin','none',null].includes(request.headers.get('Sec-Fetch-Site'))))return null;
  const session=await this.inspect(request),raw=rawCookie(request);if(session.kind!=='authenticated'||!raw)return null;
  if(request.method!=='GET'){const proof=parseProofAuthorization(request.headers),supplied=proof?.purpose==='csrf'?proof.token:null;if(!supplied||!equalToken(session.csrfToken,supplied))return null}
  const nowMs=this.now();if(nowMs===null||nowMs<session.checkedAt)return null;
  return {tokenHash:await tokenHash(raw),accountId:session.actor.accountId,contextHash:session.contextHash,nowMs,clock:this.clock,restriction:this.restriction};
 }
 async logout(request:Request):Promise<{loggedOut:true}|null>{
  const proof=await this.storageAuthorization(request);if(!proof)return null;
  try{const row=await this.db.prepare('SELECT context_generation FROM auth_sessions WHERE token_hash=?').bind(proof.tokenHash).first<{context_generation:number}>();if(!row)return null;
   const coordinator=new BrowserSessionCoordinator(this.db,this.origin,this.clock);
   const command=await coordinator.command(request,'logout',row.context_generation,proof.tokenHash);if(!command)return null;
   const h=new Headers(request.headers);h.set(AUTHORIZATION_HEADER,proofAuthorization('command',command.commandToken));
   const result=await coordinator.execute(new Request(request.url,{method:'POST',headers:h}),'logout',undefined,proof);
   return result.kind==='executed'?{loggedOut:true}:null;
  }catch{return null}
 }
 async cleanupExpired():Promise<number|null>{
  try{const now=this.now();if(now===null)return null;const r=await this.db.prepare(`DELETE FROM auth_sessions WHERE token_hash IN(SELECT token_hash FROM auth_sessions WHERE expires_at_ms<=? OR last_seen_ms<=? ORDER BY expires_at_ms LIMIT 100)`).bind(now,now-SESSION_IDLE_MS).run();return r.success?r.meta.changes:null}catch{return null}
 }
}
