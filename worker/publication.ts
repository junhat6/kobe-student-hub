import {SessionStore,SESSION_IDLE_MS} from './auth/sessions';
import type {Entry,Profile} from '../src/types';
const slug=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
const draftId=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const chars=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max*2&&Array.from(v).length<=max&&!v.includes('\0')&&new TextDecoder().decode(new TextEncoder().encode(v))===v;
const nonblank=(v:string)=>v.trim().length>0;
const profileBounds=`p.is_sample=0 AND length(p.id) BETWEEN 1 AND 128 AND instr(p.id,char(0))=0 AND length(CAST(p.id AS BLOB))<=512 AND substr(p.id,1,1) GLOB '[A-Za-z0-9]' AND p.id NOT GLOB '*[^A-Za-z0-9_-]*' AND length(trim(p.display_name,char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))>0 AND length(p.display_name)<=80 AND instr(p.display_name,char(0))=0 AND length(CAST(p.display_name AS BLOB))<=320 AND length(p.department)<=80 AND instr(p.department,char(0))=0 AND length(CAST(p.department AS BLOB))<=320 AND length(p.year_label)<=32 AND instr(p.year_label,char(0))=0 AND length(CAST(p.year_label AS BLOB))<=128 AND length(p.bio)<=800 AND instr(p.bio,char(0))=0 AND length(CAST(p.bio AS BLOB))<=3200 AND length(p.initials)<=8 AND instr(p.initials,char(0))=0 AND length(CAST(p.initials AS BLOB))<=32`;
function tags(value:unknown):string[]|null{
 if(!Array.isArray(value)||value.length>5)return null;const result:string[]=[];
 for(const item of value){if(typeof item!=='string'||item.length>128)return null;const tag=item.normalize('NFKC').trim();if(!nonblank(tag)||!chars(tag,24)||/[\p{Cc}\p{Cf}]/u.test(tag)||result.includes(tag))return null;result.push(tag)}return result.sort();
}
function metadata(value:unknown){
 if(value===null||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)return null;
 const v=value as Record<string,unknown>;const allowed=['expectedVersion','confirmPublic','summary','tags','audience','prerequisite','outcome','minutes'];
 if(Reflect.ownKeys(v).some(k=>typeof k!=='string'||!allowed.includes(k))||!['expectedVersion','confirmPublic','summary','tags','minutes'].every(k=>Object.hasOwn(v,k)))return null;
 if(typeof v.expectedVersion!=='number'||!Number.isSafeInteger(v.expectedVersion)||v.expectedVersion<1||v.confirmPublic!==true||!chars(v.summary,300)||typeof v.minutes!=='number'||!Number.isInteger(v.minutes)||v.minutes<1||v.minutes>240)return null;
 const normalized=tags(v.tags);if(!normalized)return null;const optional:Record<string,string>={};for(const key of ['audience','prerequisite','outcome']){if(Object.hasOwn(v,key)&&!chars(v[key],200))return null;optional[key]=v[key] as string??''}
 return {expectedVersion:v.expectedVersion,summary:v.summary,tagsJson:JSON.stringify(normalized),audience:optional.audience,prerequisite:optional.prerequisite,outcome:optional.outcome,minutes:v.minutes};
}

type PublicRow={id:string;title:string;summary:string;body:string;tags_json:string;author_id:string;audience:string;prerequisite:string;outcome:string;updated_at:string;minutes:number;related_ids_json:string;display_name:string;department:string;year_label:string;bio:string;initials:string};
const publicColumns=`c.id,c.title,c.summary,c.body,c.tags_json,c.author_id,c.audience,c.prerequisite,c.outcome,c.updated_at,c.minutes,c.related_ids_json,p.display_name,p.department,p.year_label,p.bio,p.initials`;
const publicBounds=`c.kind='article' AND c.status='published' AND c.is_sample=0 AND ${profileBounds} AND NOT EXISTS(SELECT 1 FROM private_accounts private_id WHERE private_id.id=p.id OR private_id.google_subject=p.id) AND length(trim(c.title,char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))>0 AND length(c.title)<=200 AND length(CAST(c.title AS BLOB))<=800 AND instr(c.body,char(0))=0 AND length(CAST(c.body AS BLOB))<=262144 AND length(c.summary)<=300 AND length(CAST(c.summary AS BLOB))<=1200 AND length(c.tags_json)<=1024 AND length(CAST(c.tags_json AS BLOB))<=1024 AND length(c.related_ids_json)<=4096 AND length(CAST(c.related_ids_json AS BLOB))<=4096 AND length(c.audience)<=200 AND length(CAST(c.audience AS BLOB))<=800 AND length(c.prerequisite)<=200 AND length(CAST(c.prerequisite AS BLOB))<=800 AND length(c.outcome)<=200 AND length(CAST(c.outcome AS BLOB))<=800 AND c.minutes BETWEEN 1 AND 240 AND length(c.updated_at)=10`;
function publicDto(r:PublicRow):{entry:Entry;author:Profile}|null{
   if(!chars(r.title,200)||!nonblank(r.title)||!chars(r.summary,300)||!chars(r.audience,200)||!chars(r.prerequisite,200)||!chars(r.outcome,200)||!chars(r.display_name,80)||!nonblank(r.display_name)||!chars(r.department,80)||!chars(r.year_label,32)||!chars(r.bio,800)||!chars(r.initials,8))return null;
   const parsed:unknown=JSON.parse(r.tags_json);const checked=tags(parsed);if(!checked||!Array.isArray(parsed)||JSON.stringify(checked)!==JSON.stringify(parsed))return null;
   const related:unknown=JSON.parse(r.related_ids_json);if(!Array.isArray(related)||related.length>20||!related.every(slug)||!slug(r.author_id)||!/^\d{4}-\d{2}-\d{2}$/.test(r.updated_at)||r.updated_at<'0000-01-01'||!Number.isInteger(r.minutes)||!nonblank(r.body))return null;
   const date=new Date(r.updated_at+'T00:00:00.000Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==r.updated_at)return null;
   return {entry:{id:r.id,kind:'article',title:r.title,summary:r.summary,body:r.body,tags:checked,authorId:r.author_id,audience:r.audience,prerequisite:r.prerequisite,outcome:r.outcome,updatedAt:r.updated_at,minutes:r.minutes,relatedIds:related},author:{id:r.author_id,name:r.display_name,department:r.department,year:r.year_label,bio:r.bio,initials:r.initials}};
}
/** Unconnected publication prototype. Active accounts do not prove current enrollment/admission. */
export class ArticlePublicationStore {
 private readonly sessions:SessionStore;
 constructor(private readonly db:D1Database,origin:string,clock:()=>number=Date.now){this.sessions=new SessionStore(db,origin,clock)}
 async publish(request:Request,id:unknown,input:unknown):Promise<{contentId:string}|null>{
  const m=metadata(input);if(request.method!=='POST'||!draftId(id)||!m)return null;
  try{const p=await this.sessions.storageAuthorization(request);if(!p||p.nowMs>253402300799999)return null;
   // Receipt-only retry: the original saved snapshot remains immutable after later private edits.
   const existing=await this.db.prepare(`SELECT r.content_id FROM article_publications r JOIN private_article_drafts d ON d.id=r.draft_id JOIN account_public_profiles m ON m.owner_account_id=d.owner_account_id JOIN public_profiles p ON p.id=m.public_profile_id JOIN content c ON c.id=r.content_id
    WHERE r.draft_id=? AND r.owner_account_id=? AND d.owner_account_id=r.owner_account_id AND r.public_profile_id=m.public_profile_id AND r.source_version=? AND r.summary=? AND r.tags_json=? AND r.audience=? AND r.prerequisite=? AND r.outcome=? AND r.minutes=? AND r.published_at_ms<=? AND c.kind='article' AND c.status='published' AND c.is_sample=0 AND c.author_id=r.public_profile_id AND ${profileBounds}
    AND NOT EXISTS(SELECT 1 FROM private_accounts private_id WHERE private_id.id=m.public_profile_id OR private_id.google_subject=m.public_profile_id)
    AND EXISTS(SELECT 1 FROM auth_sessions s JOIN private_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.account_id=d.owner_account_id AND a.status='active' AND a.session_epoch=s.account_epoch AND s.revoked_at_ms IS NULL AND s.created_at_ms<=? AND s.last_seen_ms<=? AND s.last_seen_ms>? AND s.expires_at_ms>?)`).bind(id,p.accountId,m.expectedVersion,m.summary,m.tagsJson,m.audience,m.prerequisite,m.outcome,m.minutes,p.nowMs,p.tokenHash,p.nowMs,p.nowMs,p.nowMs-SESSION_IDLE_MS,p.nowMs).first<{content_id:string}>();
   if(existing)return {contentId:existing.content_id};
   const row=await this.db.prepare(`INSERT INTO article_publications(content_id,owner_account_id,draft_id,public_profile_id,source_version,summary,tags_json,audience,prerequisite,outcome,minutes,published_at_ms)
    SELECT ?,d.owner_account_id,d.id,m.public_profile_id,d.version,?,?,?,?,?,?,? FROM private_article_drafts d JOIN account_public_profiles m ON m.owner_account_id=d.owner_account_id JOIN public_profiles p ON p.id=m.public_profile_id
    WHERE d.id=? AND d.owner_account_id=? AND d.version=? AND d.updated_at_ms<=? AND length(trim(d.title,char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))>0 AND length(d.title)<=200 AND instr(d.title,char(0))=0 AND length(CAST(d.title AS BLOB))<=800 AND length(trim(d.body,char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))>0 AND instr(d.body,char(0))=0 AND length(CAST(d.body AS BLOB))<=262144 AND ${profileBounds} AND NOT EXISTS(SELECT 1 FROM private_accounts private_id WHERE private_id.id=m.public_profile_id OR private_id.google_subject=m.public_profile_id)
    AND EXISTS(SELECT 1 FROM auth_sessions s JOIN private_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.account_id=d.owner_account_id AND a.status='active' AND a.session_epoch=s.account_epoch AND s.revoked_at_ms IS NULL AND s.created_at_ms<=? AND s.last_seen_ms<=? AND s.last_seen_ms>? AND s.expires_at_ms>?)
    ON CONFLICT(draft_id) DO UPDATE SET content_id=article_publications.content_id WHERE article_publications.owner_account_id=excluded.owner_account_id AND article_publications.public_profile_id=excluded.public_profile_id AND article_publications.source_version=excluded.source_version AND article_publications.summary=excluded.summary AND article_publications.tags_json=excluded.tags_json AND article_publications.audience=excluded.audience AND article_publications.prerequisite=excluded.prerequisite AND article_publications.outcome=excluded.outcome AND article_publications.minutes=excluded.minutes AND EXISTS(SELECT 1 FROM content c WHERE c.id=article_publications.content_id AND c.author_id=article_publications.public_profile_id AND c.kind='article' AND c.status='published' AND c.is_sample=0) RETURNING content_id`).bind(crypto.randomUUID(),m.summary,m.tagsJson,m.audience,m.prerequisite,m.outcome,m.minutes,p.nowMs,id,p.accountId,m.expectedVersion,p.nowMs,p.tokenHash,p.nowMs,p.nowMs,p.nowMs-SESSION_IDLE_MS,p.nowMs).first<{content_id:string}>();
   return row?{contentId:row.content_id}:null;
  }catch{return null}
 }
 async readPublished(id:unknown):Promise<{entry:Entry;author:Profile}|null>{
  if(!slug(id))return null;
  try{const row=await this.db.prepare(`SELECT ${publicColumns} FROM content c JOIN article_publications publication ON publication.content_id=c.id AND publication.public_profile_id=c.author_id JOIN public_profiles p ON p.id=c.author_id WHERE c.id=? AND ${publicBounds}`).bind(id).first<PublicRow>();return row?publicDto(row):null}catch{return null}
 }
 async getOwnReceipt(request:Request,id:unknown):Promise<{publication:({contentId:string;sourceVersion:number;entry:Entry;author:Profile})|null}|null>{
  if(request.method!=='GET'||!draftId(id))return null;
  try{const proof=await this.sessions.storageAuthorization(request);if(!proof||proof.nowMs>253402300799999)return null;
   const row=await this.db.prepare(`SELECT r.content_id receipt_id,r.source_version,${publicColumns} FROM private_article_drafts d
    LEFT JOIN article_publications r ON r.draft_id=d.id LEFT JOIN account_public_profiles m ON m.owner_account_id=d.owner_account_id
    LEFT JOIN content c ON c.id=r.content_id AND c.author_id=r.public_profile_id LEFT JOIN public_profiles p ON p.id=c.author_id
    WHERE d.id=? AND d.owner_account_id=? AND d.updated_at_ms<=?
    AND EXISTS(SELECT 1 FROM auth_sessions s JOIN private_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.account_id=d.owner_account_id AND a.status='active' AND a.session_epoch=s.account_epoch AND s.revoked_at_ms IS NULL AND s.created_at_ms<=? AND s.last_seen_ms<=? AND s.last_seen_ms>? AND s.expires_at_ms>?)
    AND (r.content_id IS NULL OR (r.owner_account_id=d.owner_account_id AND r.public_profile_id=m.public_profile_id AND r.published_at_ms<=? AND ${publicBounds}))`).bind(id,proof.accountId,proof.nowMs,proof.tokenHash,proof.nowMs,proof.nowMs,proof.nowMs-SESSION_IDLE_MS,proof.nowMs,proof.nowMs).first<PublicRow&{receipt_id:string|null;source_version:number}>();
   if(!row)return null;if(row.receipt_id===null)return {publication:null};
   if(!draftId(row.receipt_id)||!Number.isSafeInteger(row.source_version)||row.source_version<1)return null;
   const projected=publicDto(row);return projected?{publication:{contentId:row.receipt_id,sourceVersion:row.source_version,...projected}}:null;
  }catch{return null}
 }
}
