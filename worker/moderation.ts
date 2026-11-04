import {SessionStore,SESSION_IDLE_MS} from './auth/sessions';
type Proof=NonNullable<Awaited<ReturnType<SessionStore['storageAuthorization']>>>;
export interface ModerationSummary {contentId:string;title:string;status:'published'|'hidden';reportCount:number;latestReportAt:number}
export interface ModerationCase extends ModerationSummary {body:string;reports:{reason:string;detail:string;createdAt:number}[]}
const idValid=(id:unknown):id is string=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id);
const live=`EXISTS(SELECT 1 FROM auth_sessions s JOIN private_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.account_id=? AND a.status='active' AND a.session_epoch=s.account_epoch AND s.revoked_at_ms IS NULL AND s.created_at_ms<=? AND s.last_seen_ms<=? AND s.last_seen_ms>? AND s.expires_at_ms>?)`;
const bindings=(p:Proof)=>[p.tokenHash,p.accountId,p.nowMs,p.nowMs,p.nowMs-SESSION_IDLE_MS,p.nowMs];
function reportInput(v:unknown):v is {reason:string;detail?:string}{
 if(v===null||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype)return false;
 const keys=Reflect.ownKeys(v);if(!keys.includes('reason')||keys.some(k=>k!=='reason'&&k!=='detail'))return false;
 const x=v as Record<string,unknown>;
 return typeof x.reason==='string'&&x.reason.length<=400&&x.reason.trim().length>0&&Array.from(x.reason).length<=200&&(x.detail===undefined&&!keys.includes('detail')||typeof x.detail==='string'&&x.detail.length<=4000&&Array.from(x.detail).length<=2000&&new TextEncoder().encode(x.detail).byteLength<=8000);
}
/** Server-private only. No notification sender, route, restore, deletion or admission policy. */
export class ArticleModerationStore {
 private readonly sessions:SessionStore;private readonly operators:readonly string[];
 constructor(private readonly db:D1Database,origin:string,operatorIds:readonly string[]=[],clock:()=>number=Date.now){
  this.sessions=new SessionStore(db,origin,clock);this.operators=Array.isArray(operatorIds)&&operatorIds.length<=10&&operatorIds.every(idValid)?Object.freeze([...operatorIds]):[];
 }
 async report(request:Request,targetId:unknown,input:unknown):Promise<{received:true}|null>{
  if(request.method!=='POST'||!idValid(targetId)||!reportInput(input))return null;
  try{const p=await this.sessions.storageAuthorization(request);if(!p)return null;
   const row=await this.db.prepare(`INSERT INTO article_reports(id,content_id,reporter_account_id,reason,detail,created_at_ms)
    SELECT ?,id,?,?,?,? FROM content WHERE id=? AND kind='article' AND status='published' AND ${live}
    AND NOT EXISTS(SELECT 1 FROM article_reports WHERE content_id=content.id AND created_at_ms>?)
    ON CONFLICT(content_id,reporter_account_id) DO UPDATE SET id=article_reports.id RETURNING id`).bind(crypto.randomUUID(),p.accountId,input.reason,input.detail??'',p.nowMs,targetId,...bindings(p),p.nowMs).first();
   return row?{received:true}:null;
  }catch{return null}
 }
 private async operator(request:Request){if(request.method!=='GET'||!this.operators.length)return null;const p=await this.sessions.storageAuthorization(request);return p&&this.operators.includes(p.accountId)?p:null}
 async queue(request:Request):Promise<ModerationSummary[]|null>{
  try{const p=await this.operator(request);if(!p)return null;
   const result=await this.db.prepare(`SELECT c.id,SUBSTR(c.title,1,200) title,c.status,r.report_count,r.latest FROM (SELECT 1 WHERE ${live}) auth
    LEFT JOIN (SELECT r.content_id,COUNT(*) report_count,MAX(r.created_at_ms) latest FROM article_reports r JOIN content eligible ON eligible.id=r.content_id AND eligible.kind='article' AND eligible.status IN ('published','hidden') GROUP BY r.content_id) r ON 1=1
    LEFT JOIN content c ON c.id=r.content_id AND c.kind='article' AND c.status IN ('published','hidden')
    ORDER BY r.latest DESC,c.id ASC LIMIT 20`).bind(...bindings(p)).all<{id:string|null;title:string;status:'published'|'hidden';report_count:number;latest:number}>();
   if(!result.results.length)return null;return result.results.filter(r=>r.id!==null).map(r=>({contentId:r.id!,title:r.title,status:r.status,reportCount:r.report_count,latestReportAt:r.latest}));
  }catch{return null}
 }
 async readCase(request:Request,targetId:unknown):Promise<ModerationCase|null>{
  if(!idValid(targetId))return null;
  try{const p=await this.operator(request);if(!p)return null;
   const result=await this.db.prepare(`SELECT c.id,SUBSTR(c.title,1,200) title,c.body,c.status,r.reason,r.detail,r.created_at_ms FROM content c JOIN article_reports r ON r.content_id=c.id WHERE c.id=? AND c.kind='article' AND c.status IN ('published','hidden') AND length(CAST(c.body AS BLOB))<=262144 AND ${live} ORDER BY r.created_at_ms ASC,r.id ASC LIMIT 3`).bind(targetId,...bindings(p)).all<{id:string;title:string;body:string;status:'published'|'hidden';reason:string;detail:string;created_at_ms:number}>();
   const rows=result.results;if(!rows.length)return null;const first=rows[0];return {contentId:first.id,title:first.title,body:first.body,status:first.status,reportCount:rows.length,latestReportAt:Math.max(...rows.map(r=>r.created_at_ms)),reports:rows.map(r=>({reason:r.reason,detail:r.detail,createdAt:r.created_at_ms}))};
  }catch{return null}
 }
}
