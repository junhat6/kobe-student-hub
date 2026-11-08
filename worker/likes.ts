import {liveStudentSessionSql as writerLive,liveStudentSessionBindings as writerBindings} from './auth/student-participation';
import {liveSessionSql as live,liveSessionBindings as bindings} from './auth/session-guard';
import {SessionStore} from './auth/sessions';
import {PublicProfileStore} from './public-profile';
import {ArticlePublicationStore,publicArticleSqlBounds,publicProfileSqlBounds,decodePublicProfile} from './publication';
import type {PublicLikedArticles,PublishedArticleSummary} from '../src/types';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const slug=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
type Proof=NonNullable<Awaited<ReturnType<SessionStore['storageAuthorization']>>>;
const mappedProfile=`${publicProfileSqlBounds} AND NOT EXISTS(SELECT 1 FROM private_accounts identity WHERE identity.id=p.id OR identity.google_subject=p.id)`;
type ProfileRow={owner_account_id:string;author_id:string;display_name:string;department:string;year_label:string;bio:string;initials:string};
const profileColumns='m.owner_account_id,p.id author_id,p.display_name,p.department,p.year_label,p.bio,p.initials';
function intent(v:unknown):boolean|null{if(v===null||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype)return null;const x=v as Record<string,unknown>;const keys=Reflect.ownKeys(v);return x.liked===false&&keys.length===1&&Object.hasOwn(x,'liked')?false:x.liked===true&&x.confirmPublic===true&&keys.length===2&&Object.hasOwn(x,'liked')&&Object.hasOwn(x,'confirmPublic')?true:null}
/** Local prototype only: active fixture accounts are not proof of real like/graduation eligibility. */
export class ArticleLikeStore {
 private readonly sessions:SessionStore;private readonly publications:ArticlePublicationStore;private readonly profiles:PublicProfileStore;
 constructor(private readonly db:D1Database,private readonly origin:string,clock:()=>number=Date.now){this.sessions=new SessionStore(db,origin,clock);this.publications=new ArticlePublicationStore(db,origin,clock);this.profiles=new PublicProfileStore(db,origin,clock)}
 async getOwn(request:Request,id:unknown):Promise<{liked:boolean}|null>{
  if(request.method!=='GET'||!uuid(id))return null;
  try{const p=await this.sessions.storageAuthorization(request);if(!p)return null;const row=await this.db.prepare(`SELECT EXISTS(SELECT 1 FROM article_likes WHERE owner_account_id=? AND content_id=?) liked FROM (SELECT 1 WHERE ${live}) auth`).bind(p.accountId,id,...bindings(p)).first<{liked:number}>();return row?{liked:row.liked===1}:null}catch{return null}
 }
 async setOwn(request:Request,id:unknown,input:unknown):Promise<{liked:boolean}|null>{
  const liked=intent(input);if(request.method!=='PUT'||!uuid(id)||liked===null)return null;
  try{
   if(!liked){const p=await this.sessions.storageAuthorization(request);if(!p)return null;await this.db.batch([this.db.prepare(`DELETE FROM article_likes WHERE owner_account_id=? AND content_id=? AND ${live}`).bind(p.accountId,id,...bindings(p)),this.db.prepare(`SELECT CASE WHEN ${live} AND NOT EXISTS(SELECT 1 FROM article_likes WHERE owner_account_id=? AND content_id=?) THEN 1 ELSE json('') END guarded`).bind(...bindings(p),p.accountId,id)]);return {liked:false}}
   if(!await this.sessions.authorizeMutation(request))return null;
   const own=await this.profiles.getOwn(new Request(request.url,{method:'GET',headers:request.headers}));if(!own?.profile||!await this.publications.readPublished(id))return null;
   const p=await this.sessions.storageAuthorization(request);if(!p)return null;
   const ownBounds=mappedProfile.replaceAll('p.','liker.');
   const row=await this.db.prepare(`INSERT INTO article_likes(owner_account_id,content_id,liked_at_ms) SELECT ?,c.id,? FROM content c JOIN article_publications publication ON publication.content_id=c.id AND publication.public_profile_id=c.author_id JOIN public_profiles p ON p.id=c.author_id JOIN account_public_profiles m ON m.owner_account_id=? JOIN public_profiles liker ON liker.id=m.public_profile_id WHERE c.id=? AND ${publicArticleSqlBounds} AND m.public_profile_id=? AND ${ownBounds} AND liker.display_name=? AND liker.department=? AND liker.year_label=? AND liker.bio=? AND liker.initials=? AND ${writerLive} AND NOT EXISTS(SELECT 1 FROM article_likes previous WHERE previous.owner_account_id=? AND previous.content_id=c.id AND previous.liked_at_ms>?) ON CONFLICT(owner_account_id,content_id) DO UPDATE SET liked_at_ms=article_likes.liked_at_ms RETURNING content_id`).bind(p.accountId,p.nowMs,p.accountId,id,own.profile.id,own.profile.displayName,own.profile.department,own.profile.yearLabel,own.profile.bio,own.profile.initials,...writerBindings(p),p.accountId,p.nowMs).first();return row?{liked:true}:null;
  }catch{return null}
 }
 async readPublic(profileId:unknown):Promise<PublicLikedArticles|null>{
  if(!slug(profileId))return null;
  try{
   const profile=await this.db.prepare(`SELECT ${profileColumns} FROM account_public_profiles m JOIN private_accounts owner ON owner.id=m.owner_account_id AND owner.status='active' JOIN public_profiles p ON p.id=m.public_profile_id WHERE p.id=? AND ${mappedProfile}`).bind(profileId).first<ProfileRow>();if(!profile)return null;const decoded=decodePublicProfile(profile);if(!decoded)return null;
   const candidates=await this.db.prepare(`SELECT l.content_id,l.liked_at_ms FROM article_likes l JOIN content c ON c.id=l.content_id AND c.kind='article' AND c.status='published' AND c.is_sample=0 JOIN article_publications publication ON publication.content_id=c.id AND publication.public_profile_id=c.author_id WHERE l.owner_account_id=? ORDER BY l.liked_at_ms DESC,l.content_id ASC LIMIT 20`).bind(profile.owner_account_id).all<{content_id:string;liked_at_ms:number}>();
   const ids=candidates.results.map(r=>r.content_id);if(candidates.results.some(r=>!uuid(r.content_id)||!Number.isSafeInteger(r.liked_at_ms)||r.liked_at_ms<0))return null;
   const selected=await this.publications.readPublishedSelection(ids);if(!selected)return null;
   // Verify membership and the still-confirmed active profile after the bounded public reads.
   // Materialized CTEs keep the independent full validators below D1's expression-depth limit.
   const memberSource=ids.length?`JOIN article_publications publication ON publication.content_id=c.id AND publication.public_profile_id=c.author_id JOIN public_profiles p ON p.id=c.author_id WHERE l.owner_account_id=? AND c.id IN (${ids.map(()=>'?').join(',')}) AND ${publicArticleSqlBounds}`:`JOIN article_publications publication ON publication.content_id=c.id AND publication.public_profile_id=c.author_id WHERE l.owner_account_id=? AND c.kind='article' AND c.status='published' AND c.is_sample=0 LIMIT 1`;
   const final=await this.db.prepare(`WITH accepted_profile AS MATERIALIZED(SELECT ${profileColumns} FROM account_public_profiles m JOIN private_accounts owner ON owner.id=m.owner_account_id AND owner.status='active' JOIN public_profiles p ON p.id=m.public_profile_id WHERE p.id=? AND m.owner_account_id=? AND ${mappedProfile} AND p.display_name=? AND p.department=? AND p.year_label=? AND p.bio=? AND p.initials=?), accepted_likes AS MATERIALIZED(SELECT l.content_id,l.liked_at_ms FROM article_likes l JOIN content c ON c.id=l.content_id ${memberSource}) SELECT * FROM accepted_profile WHERE ${ids.length?'(SELECT COUNT(*) FROM accepted_likes l WHERE '+candidates.results.map(()=>'(l.content_id=? AND l.liked_at_ms=?)').join(' OR ')+')=?':'NOT EXISTS(SELECT 1 FROM accepted_likes)'}`).bind(profileId,profile.owner_account_id,profile.display_name,profile.department,profile.year_label,profile.bio,profile.initials,profile.owner_account_id,...ids,...candidates.results.flatMap(r=>[r.content_id,r.liked_at_ms]),...(ids.length?[ids.length]:[])).first<ProfileRow>();if(!final)return null;
   const byId=new Map(selected.map(row=>[row.entry.id,row.entry]));const entries:PublishedArticleSummary[]=ids.map(id=>{const e=byId.get(id)!;return {id:e.id,title:e.title,summary:e.summary,tags:e.tags,audience:e.audience,prerequisite:e.prerequisite,outcome:e.outcome,updatedAt:e.updatedAt,minutes:e.minutes}});
   const result={profile:{id:decoded.id,name:decoded.name,department:decoded.department,year:decoded.year,initials:decoded.initials},entries};return new TextEncoder().encode(JSON.stringify(result)).byteLength<=256*1024?result:null;
  }catch{return null}
 }
}
