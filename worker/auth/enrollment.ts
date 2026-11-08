import {canonicalEnrollmentYears,enrollmentWindow,enrollmentParticipation,ENROLLMENT_POLICY_VERSION,type EnrollmentYears,type OwnEnrollmentResult} from '../../src/shared/enrollment';
import {SessionStore} from './sessions';
import {liveSessionSql,liveSessionBindings} from './session-guard';
export type {OwnEnrollmentRecord,OwnEnrollmentResult} from '../../src/shared/enrollment';
export interface EnrollmentSaveInput extends EnrollmentYears {expectedVersion:number}
type Row={owner_account_id:string|null;admission_year:number;graduation_year:number;starts_at_ms:number;ends_at_ms:number;policy_version:number;version:number;updated_at_ms:number};
const columns='owner_account_id,admission_year,graduation_year,starts_at_ms,ends_at_ms,policy_version,version,updated_at_ms';
export function canonicalEnrollmentSaveInput(value:unknown):EnrollmentSaveInput|null {
 if(value===null||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)return null;
 const input=value as Record<string,unknown>;
 if(Reflect.ownKeys(input).length!==3||!Object.hasOwn(input,'admissionYear')||!Object.hasOwn(input,'graduationYear')||!Object.hasOwn(input,'expectedVersion')||typeof input.expectedVersion!=='number'||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0||input.expectedVersion>=Number.MAX_SAFE_INTEGER)return null;
 const years=canonicalEnrollmentYears({admissionYear:input.admissionYear,graduationYear:input.graduationYear});
 return years?{...years,expectedVersion:input.expectedVersion}:null;
}
function dto(row:Row,now:number):OwnEnrollmentResult|null {
 const years=canonicalEnrollmentYears({admissionYear:row.admission_year,graduationYear:row.graduation_year}),window=years&&enrollmentWindow(years);
 if(!years||!window||row.starts_at_ms!==window.startsAtMs||row.ends_at_ms!==window.endsAtMs||row.policy_version!==ENROLLMENT_POLICY_VERSION||!Number.isSafeInteger(row.version)||row.version<1||!Number.isSafeInteger(row.updated_at_ms)||row.updated_at_ms<0||row.updated_at_ms>now)return null;
 const participation=enrollmentParticipation(years,now);
 return participation?{enrollment:{...years,version:row.version,updatedAtMs:row.updated_at_ms},participation}:null;
}
/** Base identity session only: ended/upcoming participants may correct their own years.
 * No production mount, enrollment proof, operator approval, or client-selected owner. */
export class EnrollmentStore {
 private readonly sessions:SessionStore;
 constructor(private readonly db:D1Database,origin:string,private readonly clock:()=>number=Date.now){this.sessions=new SessionStore(db,origin,clock)}
 async getOwn(request:Request):Promise<OwnEnrollmentResult|null> {
  if(request.method!=='GET')return null;
  try {
   const proof=await this.sessions.storageAuthorization(request);if(!proof)return null;
   const bindings=liveSessionBindings(proof),now=bindings[3] as number;
   const rows=await this.db.prepare(`SELECT e.${columns.split(',').join(',e.')} FROM (SELECT 1 WHERE ${liveSessionSql}) authorized LEFT JOIN private_enrollment_periods e ON e.owner_account_id=?`).bind(...bindings,proof.accountId).all<Row>();
   if(!rows.success||rows.results.length!==1)return null;
   return rows.results[0].owner_account_id===null?{enrollment:null,participation:'missing'}:dto(rows.results[0],now);
  } catch{return null}
 }
 async save(request:Request,input:unknown):Promise<OwnEnrollmentResult|null> {
  const value=canonicalEnrollmentSaveInput(input);if(request.method!=='PUT'||!value)return null;
  const window=enrollmentWindow({admissionYear:value.admissionYear,graduationYear:value.graduationYear});if(!window)return null;
  try {
   const proof=await this.sessions.storageAuthorization(request);if(!proof)return null;
   const bindings=liveSessionBindings(proof),now=bindings[3] as number,nextVersion=value.expectedVersion+1;
   const saved=[value.admissionYear,value.graduationYear,window.startsAtMs,window.endsAtMs,ENROLLMENT_POLICY_VERSION,nextVersion,now];
   const mutation=value.expectedVersion===0
    ?this.db.prepare(`INSERT INTO private_enrollment_periods(${columns}) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM private_enrollment_periods WHERE owner_account_id=?) AND ${liveSessionSql} RETURNING ${columns}`).bind(proof.accountId,...saved,proof.accountId,...bindings)
    :this.db.prepare(`UPDATE private_enrollment_periods SET admission_year=?,graduation_year=?,starts_at_ms=?,ends_at_ms=?,policy_version=?,version=?,updated_at_ms=? WHERE owner_account_id=? AND version=? AND updated_at_ms<=? AND ${liveSessionSql} RETURNING ${columns}`).bind(...saved,proof.accountId,value.expectedVersion,now,...bindings);
   const finalBindings=liveSessionBindings(proof),finalNow=finalBindings[3] as number;
   // changes() requires this invocation to have changed exactly one row. An IGNORE,
   // stale CAS or identical replay cannot be mistaken for a successful mutation.
   const results=await this.db.batch<Row>([mutation,this.db.prepare(`SELECT CASE WHEN changes()=1 AND EXISTS(SELECT 1 FROM private_enrollment_periods WHERE owner_account_id=? AND admission_year=? AND graduation_year=? AND starts_at_ms=? AND ends_at_ms=? AND policy_version=? AND version=? AND updated_at_ms=? AND ${liveSessionSql}) THEN 1 ELSE json('') END AS guarded`).bind(proof.accountId,...saved,...finalBindings)]);
   if(results.some(result=>!result.success)||results[0].results.length!==1)return null;
   return dto(results[0].results[0],finalNow);
  } catch{return null}
 }
}
