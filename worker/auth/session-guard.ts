export const SESSION_ABSOLUTE_MS=28_800_000;
export const SESSION_IDLE_MS=1_800_000;
export interface SessionStorageProof{tokenHash:string;accountId:string;contextHash:string;nowMs:number;clock:()=>number}
/** All final private statements use the same current authority, never a preflight actor alone. */
export const liveSessionSql=`EXISTS(SELECT 1 FROM auth_sessions s JOIN private_accounts a ON a.id=s.account_id JOIN auth_browser_contexts c ON c.context_hash=s.context_hash WHERE s.token_hash=? AND s.account_id=? AND s.context_hash=? AND s.context_generation=c.generation AND c.created_at_ms<=? AND c.expires_at_ms>? AND a.status='active' AND a.session_epoch=s.account_epoch AND s.revoked_at_ms IS NULL AND s.created_at_ms<=? AND s.last_seen_ms<=? AND s.last_seen_ms>? AND s.expires_at_ms>?)`;
export function liveSessionBindings(p:SessionStorageProof){const now=p.clock();if(!Number.isSafeInteger(now)||now<p.nowMs||now>=Number.MAX_SAFE_INTEGER-SESSION_ABSOLUTE_MS)throw Error('unavailable session clock');return [p.tokenHash,p.accountId,p.contextHash,now,now,now,now,now-SESSION_IDLE_MS,now]}
