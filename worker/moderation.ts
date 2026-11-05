import {liveSessionSql as live,liveSessionBindings as bindings} from './auth/session-guard';
import {SessionStore} from './auth/sessions';
type Proof=NonNullable<Awaited<ReturnType<SessionStore['storageAuthorization']>>>;
export interface ModerationSummary {contentId:string;title:string;status:'published'|'hidden';reportCount:number;latestReportAt:number}
export interface ModerationCase extends ModerationSummary {body:string;reports:{reason:string;detail:string;createdAt:number}[]}
const idValid=(id:unknown):id is string=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id);
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max*2&&!v.includes('\0')&&Array.from(v).length<=max&&new TextDecoder().decode(new TextEncoder().encode(v))===v;
function reportInput(v:unknown):v is {reason:string;detail?:string}{
 if(v===null||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype)return false;
 const keys=Reflect.ownKeys(v);if(!keys.includes('reason')||keys.some(k=>k!=='reason'&&k!=='detail'))return false;
 const x=v as Record<string,unknown>;
 return text(x.reason,200)&&x.reason.trim().length>0&&(x.detail===undefined&&!keys.includes('detail')||text(x.detail,2000)&&new TextEncoder().encode(x.detail).byteLength<=8000);
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
 async getOwnReport(request:Request,targetId:unknown):Promise<{received:boolean}|null>{
  if(request.method!=='GET'||!idValid(targetId))return null;
  try{const p=await this.sessions.storageAuthorization(request);if(!p)return null;
   const row=await this.db.prepare(`SELECT r.id receipt FROM content c LEFT JOIN article_reports r ON r.content_id=c.id AND r.reporter_account_id=?
    WHERE c.id=? AND c.kind='article' AND c.status IN ('published','hidden') AND (r.id IS NOT NULL OR c.status='published') AND (r.created_at_ms IS NULL OR r.created_at_ms<=?) AND ${live}`).bind(p.accountId,targetId,p.nowMs,...bindings(p)).first<{receipt:string|null}>();return row?{received:row.receipt!==null}:null;
  }catch{return null}
 }
 private async operator(request:Request){if(request.method!=='GET'||!this.operators.length)return null;const p=await this.sessions.storageAuthorization(request);return p&&this.operators.includes(p.accountId)?p:null}
 async queue(request:Request):Promise<ModerationSummary[]|null>{
  try{const p=await this.operator(request);if(!p)return null;
   const result=await this.db.prepare(`SELECT c.id,SUBSTR(c.title,1,200) title,c.status,r.report_count,r.latest FROM (SELECT 1 WHERE ${live}) auth
    LEFT JOIN (SELECT r.content_id,COUNT(*) report_count,MAX(r.created_at_ms) latest FROM article_reports r JOIN content eligible ON eligible.id=r.content_id AND eligible.kind='article' AND eligible.status IN ('published','hidden') AND instr(eligible.title,char(0))=0 GROUP BY r.content_id) r ON 1=1
    LEFT JOIN content c ON c.id=r.content_id AND c.kind='article' AND c.status IN ('published','hidden')
    ORDER BY r.latest DESC,c.id ASC LIMIT 20`).bind(...bindings(p)).all<{id:string|null;title:string;status:'published'|'hidden';report_count:number;latest:number}>();
   if(!result.results.length)return null;const rows=result.results.filter(r=>r.id!==null);if(rows.some(r=>!idValid(r.id)||!text(r.title,200)||!Number.isSafeInteger(r.report_count)||r.report_count<1||r.report_count>3||!Number.isSafeInteger(r.latest)||r.latest<0))return null;return rows.map(r=>({contentId:r.id!,title:r.title,status:r.status,reportCount:r.report_count,latestReportAt:r.latest}));
  }catch{return null}
 }
 async readCase(request:Request,targetId:unknown):Promise<ModerationCase|null>{
  if(!idValid(targetId))return null;
  try{const p=await this.operator(request);if(!p)return null;
   const result=await this.db.prepare(`SELECT c.id,SUBSTR(c.title,1,200) title,c.body,c.status,r.reason,r.detail,r.created_at_ms FROM content c JOIN article_reports r ON r.content_id=c.id WHERE c.id=? AND c.kind='article' AND c.status IN ('published','hidden') AND instr(c.title,char(0))=0 AND instr(c.body,char(0))=0 AND length(CAST(c.body AS BLOB))<=262144 AND NOT EXISTS(SELECT 1 FROM article_reports invalid WHERE invalid.content_id=c.id AND (length(CAST(invalid.reason AS BLOB))>800 OR length(CAST(invalid.detail AS BLOB))>8000)) AND (SELECT COUNT(*) FROM article_reports total WHERE total.content_id=c.id) BETWEEN 1 AND 3 AND ${live} ORDER BY r.created_at_ms ASC,r.id ASC LIMIT 3`).bind(targetId,...bindings(p)).all<{id:string;title:string;body:string;status:'published'|'hidden';reason:string;detail:string;created_at_ms:number}>();
   const rows=result.results;if(!rows.length||rows.some(r=>!idValid(r.id)||!text(r.title,200)||!text(r.reason,200)||!r.reason.trim()||!text(r.detail,2000)||!Number.isSafeInteger(r.created_at_ms)||r.created_at_ms<0))return null;const first=rows[0];return {contentId:first.id,title:first.title,body:first.body,status:first.status,reportCount:rows.length,latestReportAt:Math.max(...rows.map(r=>r.created_at_ms)),reports:rows.map(r=>({reason:r.reason,detail:r.detail,createdAt:r.created_at_ms}))};
  }catch{return null}
 }
}
