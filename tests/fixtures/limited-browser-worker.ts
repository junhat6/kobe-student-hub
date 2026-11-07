import app from '../../worker/index';
import type {OAuthBindings} from '../../worker/auth/oauth-http';
import type {SessionRestriction} from '../../worker/auth/session-guard';
export default {async fetch(r:Request,env:OAuthBindings&{DB:D1Database;ASSETS:Fetcher;LOCAL_RESTRICTION:SessionRestriction}){
 if(!(await fetch('https://limited-readiness.invalid/')).ok)return new Response('',{status:503});
 if(new URL(r.url).pathname==='/api/__fixture/grant'&&r.method==='POST'){const action=new URL(r.url).searchParams.get('action');if(action==='revoke')await env.DB.prepare('UPDATE limited_draft_grants SET revoked_at_ms=? WHERE account_id=?').bind(Date.now(),env.LOCAL_RESTRICTION.accountId).run();else if(action==='expire')await env.DB.prepare('UPDATE limited_draft_grants SET expires_at_ms=? WHERE account_id=?').bind(Date.now()-1,env.LOCAL_RESTRICTION.accountId).run();else if(action==='restore')await env.DB.prepare('UPDATE limited_draft_grants SET revoked_at_ms=NULL,expires_at_ms=? WHERE account_id=?').bind(env.LOCAL_RESTRICTION.expiresAtMs,env.LOCAL_RESTRICTION.accountId).run();else return new Response('',{status:400});return new Response('',{status:204})}
 return app.fetch(r,{...env,OAUTH_DRAFT_TRIAL:JSON.stringify(env.LOCAL_RESTRICTION)} as Env);
}};
