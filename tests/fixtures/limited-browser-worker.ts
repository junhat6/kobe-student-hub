import {createLimitedDraftHandler} from '../../worker/limited-draft-http';
import type {OAuthBindings} from '../../worker/auth/oauth-http';
import type {SessionRestriction} from '../../worker/auth/session-guard';
export default {async fetch(r:Request,env:OAuthBindings&{DB:D1Database;ASSETS:Fetcher;LOCAL_RESTRICTION:SessionRestriction}){
 if(!(await fetch('https://limited-readiness.invalid/')).ok)return new Response('',{status:503});
 if(new URL(r.url).pathname.startsWith('/api/'))return createLimitedDraftHandler(env.DB,env,()=>env.LOCAL_RESTRICTION)(r);
 return env.ASSETS.fetch(r);
}};
