export const SESSION_ABSOLUTE_MS=28_800_000;
export const SESSION_IDLE_MS=1_800_000;
export const TRIAL_GRANT_MAX_MS=100*3_600_000;
export interface SessionStorageProof{tokenHash:string;accountId:string;contextHash:string;nowMs:number;clock:()=>number;restriction?:SessionRestrictionReader}
/** All final private statements use the same current authority, never a preflight actor alone. */
export const liveSessionSql=`EXISTS(SELECT 1 FROM auth_sessions s JOIN private_accounts a ON a.id=s.account_id JOIN auth_browser_contexts c ON c.context_hash=s.context_hash WHERE s.token_hash=? AND s.account_id=? AND s.context_hash=? AND s.context_generation=c.generation AND c.created_at_ms<=? AND c.expires_at_ms>? AND a.status='active' AND a.session_epoch=s.account_epoch AND s.revoked_at_ms IS NULL AND s.created_at_ms<=? AND s.last_seen_ms<=? AND s.last_seen_ms>? AND s.expires_at_ms>?)`;
export function liveSessionBindings(p:SessionStorageProof){const now=p.clock();if(!Number.isSafeInteger(now)||now<p.nowMs||now>=Number.MAX_SAFE_INTEGER-SESSION_ABSOLUTE_MS)throw Error('unavailable session clock');return [p.tokenHash,p.accountId,p.contextHash,now,now,now,now,now-SESSION_IDLE_MS,now,...(p.restriction?sessionRestrictionBindings(p.restriction,now):[])]}

/** Optional server-only restriction. Never populated from an HTTP body or identity claim. */
export interface SessionRestriction {accountId:string;accountEpoch:number;expiresAtMs:number}
export type SessionRestrictionReader=()=>SessionRestriction|null;
export function readSessionRestriction(read:SessionRestrictionReader|undefined,now:number):SessionRestriction|null|undefined{
 if(!read)return undefined;
 const p=read();
 if(!p||Object.keys(p).sort().join(',')!=='accountEpoch,accountId,expiresAtMs'||!Number.isSafeInteger(now)||now<0||typeof p.accountId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(p.accountId)||!Number.isSafeInteger(p.accountEpoch)||p.accountEpoch<0||!Number.isSafeInteger(p.expiresAtMs)||p.expiresAtMs<=now||p.expiresAtMs>now+TRIAL_GRANT_MAX_MS)throw Error('Restricted session unavailable');
 return p;
}
export function sessionRestrictionSql(alias:string){return `(${alias}.id=? AND ${alias}.session_epoch=? AND ?>? AND EXISTS(SELECT 1 FROM limited_draft_grants g WHERE g.account_id=${alias}.id AND g.account_epoch=${alias}.session_epoch AND g.expires_at_ms=? AND g.revoked_at_ms IS NULL AND g.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)))`}
export function sessionRestrictionBindings(read:SessionRestrictionReader|undefined,now:number){const p=readSessionRestriction(read,now);return [p?.accountId??null,p?.accountEpoch??null,p?.expiresAtMs??null,now,p?.expiresAtMs??null]}

export function liveRestrictedSessionSql(p:SessionStorageProof){return p.restriction?liveSessionSql.replace("a.status='active'","a.status='pending'").slice(0,-1)+` AND ${sessionRestrictionSql('a')})`:liveSessionSql}
