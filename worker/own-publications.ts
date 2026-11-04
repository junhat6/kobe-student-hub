import {SessionStore,SESSION_IDLE_MS} from './auth/sessions';
import type {OwnPublications,OwnPublicationSummary} from '../src/own-publication-types';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const live=`EXISTS(SELECT 1 FROM auth_sessions s JOIN private_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.account_id=? AND a.status='active' AND a.session_epoch=s.account_epoch AND s.revoked_at_ms IS NULL AND s.created_at_ms<=? AND s.last_seen_ms<=? AND s.last_seen_ms>? AND s.expires_at_ms>?)`;
type Row={kind:OwnPublicationSummary['kind']|null;public_id:string|null;title:string|null;status:OwnPublicationSummary['status'];published_at_ms:number;source_version:number;consistent:number};
/** Private stored publication records, not proof of current public delivery or eligibility. */
export class OwnPublicationStore{
 private sessions:SessionStore;
 constructor(private db:D1Database,origin:string,clock:()=>number=Date.now){this.sessions=new SessionStore(db,origin,clock)}
 async list(request:Request):Promise<OwnPublications|null>{if(request.method!=='GET')return null;try{const p=await this.sessions.storageAuthorization(request);if(!p)return null;
 const rows=await this.db.prepare(`WITH authorized AS MATERIALIZED(SELECT 1 WHERE ${live}),article_base AS MATERIALIZED(SELECT content_id,public_profile_id,published_at_ms,source_version FROM article_publications WHERE owner_account_id=? ORDER BY published_at_ms DESC,content_id ASC LIMIT 21),project_base AS MATERIALIZED(SELECT id,CASE WHEN length(CAST(title AS BLOB))<=800 THEN title ELSE NULL END title,status,published_at_ms,source_version FROM project_publications WHERE owner_account_id=? ORDER BY published_at_ms DESC,id ASC LIMIT 21),owned AS MATERIALIZED(
 SELECT 'article' kind,r.content_id public_id,CASE WHEN length(CAST(c.title AS BLOB))<=800 THEN c.title ELSE NULL END title,c.status,r.published_at_ms,r.source_version,CASE WHEN c.id IS NOT NULL AND c.kind='article' AND c.is_sample=0 AND c.author_id=r.public_profile_id THEN 1 ELSE 0 END consistent FROM article_base r LEFT JOIN content c ON c.id=r.content_id
 UNION ALL SELECT 'project',r.id,r.title,r.status,r.published_at_ms,r.source_version,1 FROM project_base r)
 SELECT owned.* FROM authorized LEFT JOIN owned ON 1=1 ORDER BY owned.published_at_ms DESC,owned.kind ASC,owned.public_id ASC LIMIT 21`).bind(p.tokenHash,p.accountId,p.nowMs,p.nowMs,p.nowMs-SESSION_IDLE_MS,p.nowMs,p.accountId,p.accountId).all<Row>();
 if(!rows.results.length)return null;const values:OwnPublicationSummary[]=[];
 for(const r of rows.results){if(r.kind===null){if(rows.results.length!==1||r.public_id!==null)return null;continue}
 if(!['article','project'].includes(r.kind)||!uuid(r.public_id)||r.consistent!==1||typeof r.title!=='string'||r.title.length>400||r.title.includes('\0')||!r.title.trim()||Array.from(r.title).length>200||new TextDecoder().decode(new TextEncoder().encode(r.title))!==r.title||!['published','hidden','deleted'].includes(r.status)||!Number.isSafeInteger(r.published_at_ms)||r.published_at_ms<0||r.published_at_ms>253402300799999||r.published_at_ms>p.nowMs||!Number.isSafeInteger(r.source_version)||r.source_version<1)return null;
 values.push({kind:r.kind,publicId:r.public_id,title:r.title,status:r.status,publishedAt:r.published_at_ms,sourceVersion:r.source_version})}
 return {publications:values.slice(0,20),moreExists:values.length>20};
 }catch{return null}}
}
