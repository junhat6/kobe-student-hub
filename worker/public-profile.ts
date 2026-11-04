import {SessionStore,SESSION_IDLE_MS} from './auth/sessions';
export interface OwnPublicProfile {id:string;displayName:string;department:string;yearLabel:string;bio:string;initials:string}
export interface OwnProfileResult {profile:OwnPublicProfile|null}
type Input={displayName:string;department:string;yearLabel:string;bio:string;initials:string};
type Proof=NonNullable<Awaited<ReturnType<SessionStore['storageAuthorization']>>>;
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max*2&&!v.includes('\0')&&Array.from(v).length<=max&&new TextDecoder().decode(new TextEncoder().encode(v))===v;
function canonical(value:unknown):Input|null{
 if(value===null||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)return null;const v=value as Record<string,unknown>;
 if(Reflect.ownKeys(v).some(k=>typeof k!=='string'||!['displayName','department','yearLabel','bio','confirmPublic'].includes(k))||!Object.hasOwn(v,'displayName')||!Object.hasOwn(v,'confirmPublic')||v.confirmPublic!==true||!text(v.displayName,80)||!v.displayName.trim())return null;
 for(const [key,max] of [['department',80],['yearLabel',32],['bio',800]] as const)if(Object.hasOwn(v,key)&&!text(v[key],max))return null;
 return {displayName:v.displayName,department:v.department as string??'',yearLabel:v.yearLabel as string??'',bio:v.bio as string??'',initials:Array.from(v.displayName.trim())[0]};
}
const live=`EXISTS(SELECT 1 FROM auth_sessions s JOIN private_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.account_id=? AND a.status='active' AND a.session_epoch=s.account_epoch AND s.revoked_at_ms IS NULL AND s.created_at_ms<=? AND s.last_seen_ms<=? AND s.last_seen_ms>? AND s.expires_at_ms>?)`;
const bindings=(p:Proof)=>[p.tokenHash,p.accountId,p.nowMs,p.nowMs,p.nowMs-SESSION_IDLE_MS,p.nowMs];
const validProfile=`p.is_sample=0 AND length(p.id) BETWEEN 1 AND 128 AND instr(p.id,char(0))=0 AND p.id NOT GLOB '*[^A-Za-z0-9_-]*' AND substr(p.id,1,1) GLOB '[A-Za-z0-9]' AND length(CAST(p.id AS BLOB))<=128 AND length(CAST(p.display_name AS BLOB))<=320 AND length(CAST(p.department AS BLOB))<=320 AND length(CAST(p.year_label AS BLOB))<=128 AND length(CAST(p.bio AS BLOB))<=3200 AND length(CAST(p.initials AS BLOB))<=32 AND NOT EXISTS(SELECT 1 FROM private_accounts private_id WHERE private_id.id=p.id OR private_id.google_subject=p.id)`;
type Row={id:string;display_name:string;department:string;year_label:string;bio:string;initials:string};
function dto(r:Row):OwnPublicProfile|null{return typeof r.id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(r.id)&&text(r.display_name,80)&&r.display_name.trim()&&text(r.department,80)&&text(r.year_label,32)&&text(r.bio,800)&&text(r.initials,8)?{id:r.id,displayName:r.display_name,department:r.department,yearLabel:r.year_label,bio:r.bio,initials:r.initials}:null}
/** First explicit creation only. No enrollment inference, Google defaults, edits, or account-deletion policy. */
export class PublicProfileStore {
 private readonly sessions:SessionStore;
 constructor(private readonly db:D1Database,origin:string,clock:()=>number=Date.now){this.sessions=new SessionStore(db,origin,clock)}
 private async current(p:Proof):Promise<OwnProfileResult|null>{
  const rows=await this.db.prepare(`SELECT m.public_profile_id mapped_id,p.id,p.display_name,p.department,p.year_label,p.bio,p.initials FROM (SELECT 1 WHERE ${live}) authorized LEFT JOIN account_public_profiles m ON m.owner_account_id=? LEFT JOIN public_profiles p ON p.id=m.public_profile_id AND ${validProfile}`).bind(...bindings(p),p.accountId).all<Row&{mapped_id:string|null}>();
  if(!rows.results.length)return null;const row=rows.results[0];if(row.id===null)return row.mapped_id===null?{profile:null}:null;const profile=dto(row);return profile?{profile}:null;
 }
 async getOwn(request:Request):Promise<OwnProfileResult|null>{
  if(request.method!=='GET')return null;try{const p=await this.sessions.storageAuthorization(request);return p?await this.current(p):null}catch{return null}
 }
 async create(request:Request,input:unknown):Promise<OwnProfileResult|null>{
  const value=canonical(input);if(request.method!=='POST'||!value)return null;
  try{const proof=await this.sessions.storageAuthorization(request);if(!proof)return null;
   const existing=await this.current(proof);if(!existing)return null;
   const same=(profile:OwnPublicProfile)=>profile.displayName===value.displayName&&profile.department===value.department&&profile.yearLabel===value.yearLabel&&profile.bio===value.bio&&profile.initials===value.initials;
   if(existing.profile)return same(existing.profile)?existing:null;
   const id='profile-'+crypto.randomUUID();
   try{
    // D1 batch is one transaction: any ownership/auth/constraint failure rolls back the profile too.
    await this.db.batch([
     this.db.prepare(`INSERT INTO public_profiles(id,display_name,department,year_label,bio,initials,is_sample) SELECT ?,?,?,?,?,?,0 WHERE ${live} AND NOT EXISTS(SELECT 1 FROM private_accounts private_id WHERE private_id.id=? OR private_id.google_subject=?) AND NOT EXISTS(SELECT 1 FROM account_public_profiles WHERE owner_account_id=?)`).bind(id,value.displayName,value.department,value.yearLabel,value.bio,value.initials,...bindings(proof),id,id,proof.accountId),
     this.db.prepare(`INSERT INTO account_public_profiles(owner_account_id,public_profile_id) VALUES(?,(SELECT p.id FROM public_profiles p WHERE p.id=? AND ${validProfile} AND ${live}))`).bind(proof.accountId,id,...bindings(proof)),
     // SELECT cannot be skipped by INSERT IGNORE triggers; a failed guard aborts the entire batch.
     this.db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM account_public_profiles m JOIN public_profiles p ON p.id=m.public_profile_id WHERE m.owner_account_id=? AND p.id=? AND p.display_name=? AND p.department=? AND p.year_label=? AND p.bio=? AND p.initials=? AND ${validProfile} AND ${live}) THEN 1 ELSE json('') END AS guarded`).bind(proof.accountId,id,value.displayName,value.department,value.yearLabel,value.bio,value.initials,...bindings(proof)),
    ]);
   }catch{
    // A concurrent winner can be acknowledged only through another fully authenticated final read.
    const retry=await this.sessions.storageAuthorization(request);if(!retry)return null;const result=await this.current(retry);return result?.profile&&same(result.profile)?result:null;
   }
   const final=await this.sessions.storageAuthorization(request);if(!final)return null;const result=await this.current(final);return result?.profile&&same(result.profile)?result:null;
  }catch{return null}
 }
}
