import type {SessionRestrictionReader} from './auth/session-guard';
import {liveRestrictedSessionSql as live,liveSessionBindings as bindings} from './auth/session-guard';
import {SessionStore} from './auth/sessions';
export interface PrivateDraft {id:string;title:string;body:string;version:number;updatedAt:number}
export type PrivateDraftSummary=Omit<PrivateDraft,'body'>;
type Proof=NonNullable<Awaited<ReturnType<SessionStore['storageAuthorization']>>>;
type Row={id:string;title:string;body:string;version:number;updated_at_ms:number};
const idValid=(id:unknown):id is string=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
const versionValid=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=1&&v<=Number.MAX_SAFE_INTEGER;
const dto=(r:Row):PrivateDraft=>({id:r.id,title:r.title,body:r.body,version:r.version,updatedAt:r.updated_at_ms});
function fields(value:unknown,keys:string[]):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)&&Reflect.ownKeys(value).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(value,k))}
function content(value:Record<string,unknown>){return typeof value.title==='string'&&value.title.length<=400&&Array.from(value.title).length<=200&&typeof value.body==='string'&&value.body.length<=262144&&new TextEncoder().encode(value.body).byteLength<=262144}
// Each final statement checks ownership and current stored session/account state atomically.
/** Private server repository only. No route or account/publication admission policy. */
export class PrivateDraftStore {
 private readonly sessions:SessionStore;
 constructor(private readonly db:D1Database,origin:string,clock:()=>number=Date.now,restriction?:SessionRestrictionReader){this.sessions=new SessionStore(db,origin,clock,restriction)}
 private async proof(request:Request,methods:string[]){return methods.includes(request.method)?this.sessions.storageAuthorization(request):null}
 async create(request:Request,input:unknown):Promise<PrivateDraft|null>{
  if(!fields(input,['title','body'])||!content(input))return null;
  try{const p=await this.proof(request,['POST']);if(!p)return null;
   const row=await this.db.prepare(`INSERT INTO private_article_drafts(id,owner_account_id,title,body,version,updated_at_ms)
    SELECT ?,?,?,?,1,? WHERE ${live(p)} RETURNING id,title,body,version,updated_at_ms`).bind(crypto.randomUUID(),p.accountId,input.title,input.body,p.nowMs,...bindings(p)).first<Row>();return row?dto(row):null;
  }catch{return null}
 }
 async read(request:Request,id:unknown):Promise<PrivateDraft|null>{
  if(!idValid(id))return null;
  try{const p=await this.proof(request,['GET']);if(!p)return null;const row=await this.db.prepare(`SELECT id,title,body,version,updated_at_ms FROM private_article_drafts WHERE id=? AND owner_account_id=? AND ${live(p)}`).bind(id,p.accountId,...bindings(p)).first<Row>();return row?dto(row):null}catch{return null}
 }
 async list(request:Request):Promise<PrivateDraftSummary[]|null>{
  try{const p=await this.proof(request,['GET']);if(!p)return null;
   const result=await this.db.prepare(`SELECT d.id,d.title,d.version,d.updated_at_ms FROM (SELECT 1 WHERE ${live(p)}) authorized LEFT JOIN private_article_drafts d ON d.owner_account_id=? ORDER BY d.updated_at_ms DESC,d.id ASC LIMIT 20`).bind(...bindings(p),p.accountId).all<Omit<Row,'body'>>();
   return result.results.length?result.results.filter(r=>r.id!==null).map(r=>({id:r.id,title:r.title,version:r.version,updatedAt:r.updated_at_ms})):null;
  }catch{return null}
 }
 async update(request:Request,id:unknown,input:unknown):Promise<PrivateDraft|null>{
  if(!idValid(id)||!fields(input,['title','body','expectedVersion'])||!content(input)||(!versionValid(input.expectedVersion)||input.expectedVersion>=Number.MAX_SAFE_INTEGER))return null;
  try{const p=await this.proof(request,['PUT','PATCH']);if(!p)return null;
   const row=await this.db.prepare(`UPDATE private_article_drafts SET title=?,body=?,version=version+1,updated_at_ms=? WHERE id=? AND owner_account_id=? AND version=? AND updated_at_ms<=? AND ${live(p)} RETURNING id,title,body,version,updated_at_ms`).bind(input.title,input.body,p.nowMs,id,p.accountId,input.expectedVersion,p.nowMs,...bindings(p)).first<Row>();return row?dto(row):null;
  }catch{return null}
 }
 async delete(request:Request,id:unknown,input:unknown):Promise<{deleted:true}|null>{
  if(!idValid(id)||!fields(input,['expectedVersion'])||!versionValid(input.expectedVersion))return null;
  try{const p=await this.proof(request,['DELETE']);if(!p)return null;
   const row=await this.db.prepare(`DELETE FROM private_article_drafts WHERE id=? AND owner_account_id=? AND version=? AND updated_at_ms<=? AND ${live(p)} RETURNING id`).bind(id,p.accountId,input.expectedVersion,p.nowMs,...bindings(p)).first();return row?{deleted:true}:null;
  }catch{return null}
 }
}
