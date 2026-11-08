import {createEnrollmentHandler} from '../../worker/enrollment-http';
import {createPrivateDraftHandler} from '../../worker/draft-http';
import {createPrivateProfileHandler} from '../../worker/profile-http';
import {createPrivateProjectHandler} from '../../worker/projects-http';
import {createPrivateOwnPublicationsHandler} from '../../worker/own-publications-http';
import {createOAuthHttpHandler} from '../../worker/auth/oauth-http';
import {SessionStore} from '../../worker/auth/sessions';
const origin='https://127.0.0.1:8790';
export default {async fetch(request:Request,env:{DB:D1Database}){
 const u=new URL(request.url);
 if(u.pathname.startsWith('/__control/'))return fetch('https://fixture-control.invalid'+u.pathname+u.search,{method:request.method});
 const result=await createOAuthHttpHandler(env.DB,{AUTH_ORIGIN:origin,GOOGLE_CLIENT_ID:'fixture-web-client.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'synthetic-browser-only',OAUTH_COOKIE_KEY:'FxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxc'}, {enabled:true})(request);
 if(result){const hold=u.searchParams.get('hold');if(hold&&result.headers.has('Set-Cookie'))await fetch('https://fixture-control.invalid/pause?tag='+encodeURIComponent(hold));return result}
 if(u.pathname==='/fixture/private'){const s=await new SessionStore(env.DB,origin).inspect(request);return s.kind==='authenticated'?Response.json({actor:s.actor.accountId,privateMarker:'PRIVATE-'+s.actor.accountId}):Response.json({error:'authentication_required'},{status:401})}
 for(const handler of [createEnrollmentHandler,createPrivateDraftHandler,createPrivateProfileHandler,createPrivateProjectHandler,createPrivateOwnPublicationsHandler]){const r=await handler(env.DB,origin)(request);if(r)return r}
 if(u.pathname==='/lab/account'||u.pathname.startsWith('/assets/'))return fetch('https://fixture-assets.invalid'+u.pathname);
 return new Response('<!doctype html><title>Local generation QA</title><p>Bounded local HTTP fixture; production UI is not mounted.</p>',{headers:{'Content-Type':'text/html'}});
}};
