import {base64url} from 'jose';
import type {VerifiedSchoolIdentity} from './google-identity';
import type {ServerSessionActor} from './private-access';
export const SESSION_ABSOLUTE_MS=28_800_000;
export const SESSION_IDLE_MS=1_800_000;
const NAME='__Host-kobe-session';
const validToken=(v:string)=>/^[A-Za-z0-9_-]{43}$/.test(v);
const cookie=(value:string,age:number)=>`${NAME}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
async function hash(value:string){return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))}
const tokenHash=async(token:string)=>Array.from(await hash('session-v1:'+token),x=>x.toString(16).padStart(2,'0')).join('');
const csrf=async(token:string)=>base64url.encode(await hash('csrf-v1:'+token));
function rawCookie(request:Request){
 const header=request.headers.get('Cookie');if(!header||header.length>16384)return null;
 const values=header.split(';').map(x=>x.trim()).filter(x=>x.startsWith(NAME+'=')).map(x=>x.slice(NAME.length+1));return values.length===1&&validToken(values[0])?values[0]:null;
}
function equalToken(a:string,b:string){if(!validToken(a)||!validToken(b))return false;let diff=0;for(let i=0;i<43;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
/** No production endpoint uses this repository. Identity must come from real server verification. */
export class SessionStore {
 constructor(private readonly db:D1Database,private readonly origin:string,private readonly clock:()=>number=Date.now){}
 private now(){const n=this.clock();return Number.isSafeInteger(n)&&n>=0&&n<Number.MAX_SAFE_INTEGER-SESSION_ABSOLUTE_MS?n:null}
 private configured(){try{return new URL(this.origin).protocol==='https:'&&new URL(this.origin).origin===this.origin}catch{return false}}
 /** Creates no account/admission. Caller must never construct identity from client input. */
 async create(identity:VerifiedSchoolIdentity):Promise<{setCookie:string;csrfToken:string;actor:ServerSessionActor}|null>{
  if(!this.configured()||identity?.provider!=='google'||typeof identity.subject!=='string'||(!identity.subject.trim()||identity.subject.length>255)||typeof identity.email!=='string'||identity.email.length>320||!/^[^@\s]+@st\.kobedenshi\.ac\.jp$/i.test(identity.email))return null;
  try{
   const raw=base64url.encode(crypto.getRandomValues(new Uint8Array(32)));const digest=await tokenHash(raw);const csrfToken=await csrf(raw);const now=this.now();if(now===null)return null;
   const row=await this.db.prepare(`INSERT INTO auth_sessions(token_hash,account_id,account_epoch,created_at_ms,last_seen_ms,expires_at_ms)
    SELECT ?,id,session_epoch,?,?,? FROM private_accounts WHERE google_subject=? AND status='active' RETURNING account_id`)
    .bind(digest,now,now,now+SESSION_ABSOLUTE_MS,identity.subject).first<{account_id:string}>();
   return row?{setCookie:cookie(raw,SESSION_ABSOLUTE_MS/1000),csrfToken,actor:{accountId:row.account_id,accountStatus:'active'}}:null;
  }catch{return null}
 }
 async authenticate(request:Request):Promise<{actor:ServerSessionActor;csrfToken:string}|null>{
  if(!this.configured()||new URL(request.url).origin!==this.origin)return null;
  const raw=rawCookie(request);if(!raw)return null;
  try{
   const digest=await tokenHash(raw);const csrfToken=await csrf(raw);const now=this.now();if(now===null)return null;
   const row=await this.db.prepare(`UPDATE auth_sessions SET last_seen_ms=? WHERE token_hash=? AND revoked_at_ms IS NULL
    AND created_at_ms<=? AND last_seen_ms<=? AND last_seen_ms>? AND expires_at_ms>?
    AND EXISTS(SELECT 1 FROM private_accounts a WHERE a.id=auth_sessions.account_id AND a.status='active' AND a.session_epoch=auth_sessions.account_epoch)
    RETURNING account_id`).bind(now,digest,now,now,now-SESSION_IDLE_MS,now).first<{account_id:string}>();
   return row?{actor:{accountId:row.account_id,accountStatus:'active'},csrfToken}:null;
  }catch{return null}
 }
 async authorizeMutation(request:Request){
  if(!['POST','PUT','PATCH','DELETE'].includes(request.method)||request.headers.get('Origin')!==this.origin||!['same-origin','none',null].includes(request.headers.get('Sec-Fetch-Site')))return null;
  const supplied=request.headers.get('X-CSRF-Token');if(!supplied||!validToken(supplied))return null;
  const session=await this.authenticate(request);return session&&equalToken(session.csrfToken,supplied)?session:null;
 }
 async logout(request:Request):Promise<{clearCookie:string}|null>{
  const session=await this.authorizeMutation(request);const raw=rawCookie(request);if(!session||!raw)return null;
  try{const digest=await tokenHash(raw);const now=this.now();if(now===null)return null;const r=await this.db.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=? AND revoked_at_ms IS NULL').bind(now,digest).run();return r.success?{clearCookie:cookie('',0)}:null}catch{return null}
 }
 async cleanupExpired():Promise<number|null>{
  try{const now=this.now();if(now===null)return null;const r=await this.db.prepare(`DELETE FROM auth_sessions WHERE token_hash IN(SELECT token_hash FROM auth_sessions WHERE expires_at_ms<=? OR last_seen_ms<=? ORDER BY expires_at_ms LIMIT 100)`).bind(now,now-SESSION_IDLE_MS).run();return r.success?r.meta.changes:null}catch{return null}
 }
}
