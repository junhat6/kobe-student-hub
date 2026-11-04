import {ProjectStore} from '../../worker/projects';
import {createPrivateProjectHandler} from '../../worker/projects-http';
import {createPrivateLikeHandler} from '../../worker/likes-http';
import {ArticleLikeStore} from '../../worker/likes';
import {createPrivateSessionHandler} from '../../worker/session-http';
import {createModerationHandler} from '../../worker/moderation-http';
import {createPrivatePublicationHandler} from '../../worker/publication-http';
import {ArticlePublicationStore} from '../../worker/publication';
import {createPrivateProfileHandler} from '../../worker/profile-http';
import {SessionStore} from '../../worker/auth/sessions';
import {createPrivateDraftHandler} from '../../worker/draft-http';
const ORIGIN='https://127.0.0.1:8788';
const privateHeaders={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff','Vary':'Cookie'};
async function localDraftResponse(result:Response,request:Request,path:string){
  // Explicit local browser fault only: send headers/first bytes now, EOF later. Never deploy this fixture.
  if(result.status===200&&request.method==='GET'&&/^\/api\/private\/(?:drafts|project-drafts)\/[0-9a-f-]{36}$/.test(path)&&request.headers.get('X-Lab-Body-Delay')==='5000'){
   const bytes=new Uint8Array(await result.arrayBuffer());const headers=new Headers(result.headers);headers.delete('Content-Length');
   let timer:ReturnType<typeof setTimeout>|undefined;
   const body=new ReadableStream<Uint8Array>({start(controller){const cut=Math.min(bytes.length,32);controller.enqueue(bytes.subarray(0,cut));timer=setTimeout(()=>{try{controller.enqueue(bytes.subarray(cut));controller.close()}catch{}},5000)},cancel(){clearTimeout(timer)}});
   return new Response(body,{status:result.status,headers});
  }
 return result;
}
export default {async fetch(request:Request,env:{DB:D1Database;ASSETS:Fetcher;LOCAL_EDITOR_FIXTURE:string}){
 if(env.LOCAL_EDITOR_FIXTURE!=='local-only-fictional'||new URL(request.url).origin!==ORIGIN)return new Response('Local fixture only',{status:404,headers:privateHeaders});
 const path=new URL(request.url).pathname;
 // Each profile browser test starts a fresh fictional local account; never reset existing lab data.
 if(path==='/__fixture/profile-session'){
  if(request.method!=='POST'||request.headers.get('Origin')!==ORIGIN)return Response.json({error:'unavailable'},{status:403,headers:privateHeaders});
  try{const id=crypto.randomUUID();const subject='profile-lab-fictional-'+id;
   await env.DB.prepare("INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)").bind('profile-lab-'+id,subject,'profile-lab-fictional@st.kobedenshi.ac.jp',Date.now()).run();
   const session=await new SessionStore(env.DB,ORIGIN).create({provider:'google',subject,email:'profile-lab-fictional@st.kobedenshi.ac.jp'});
   if(!session)return Response.json({error:'unavailable'},{status:503,headers:privateHeaders});
   return Response.json({csrfToken:session.csrfToken},{headers:{...privateHeaders,'Set-Cookie':session.setCookie}});
  }catch{return Response.json({error:'unavailable'},{status:503,headers:privateHeaders})}
 }
 // Explicit tests-only operator bootstrap. The trusted allowlist below is fictional and localhost-only.
 if(path==='/__fixture/operator-session'){
  if(request.method!=='POST'||request.headers.get('Origin')!==ORIGIN)return Response.json({error:'unavailable'},{status:403,headers:privateHeaders});
  const session=await new SessionStore(env.DB,ORIGIN).create({provider:'google',subject:'editor-fictional-operator',email:'editor-operator@st.kobedenshi.ac.jp'});
  if(!session)return Response.json({error:'unavailable'},{status:503,headers:privateHeaders});
  return Response.json({csrfToken:session.csrfToken},{headers:{...privateHeaders,'Set-Cookie':session.setCookie}});
 }
 if(path==='/__fixture/session'){
  if(request.method!=='POST'||request.headers.get('Origin')!==ORIGIN)return Response.json({error:'unavailable'},{status:403,headers:privateHeaders});
  try{const text=await request.text();if(text.length>100)return Response.json({error:'unavailable'},{status:400,headers:privateHeaders});const input=JSON.parse(text) as {account?:unknown};if(input.account!=='a'&&input.account!=='b')return Response.json({error:'unavailable'},{status:400,headers:privateHeaders});
   const session=await new SessionStore(env.DB,ORIGIN).create({provider:'google',subject:'editor-fictional-'+input.account,email:'editor-fictional@st.kobedenshi.ac.jp'});if(!session)return Response.json({error:'unavailable'},{status:503,headers:privateHeaders});
   return Response.json({csrfToken:session.csrfToken},{headers:{...privateHeaders,'Set-Cookie':session.setCookie}});
  }catch{return Response.json({error:'unavailable'},{status:400,headers:privateHeaders})}
 }
 // Standalone project lab: private drafts never enter anonymous projections.
 if(path.startsWith('/__lab/projects')||path.startsWith('/__lab/project-authors')){
  const url=new URL(request.url),authors=path.startsWith('/__lab/project-authors'),prefix=authors?'/__lab/project-authors/':'/__lab/projects/',id=path.slice(prefix.length);const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff','Content-Type':'application/json; charset=utf-8'};
  const unavailable=()=>new Response(JSON.stringify({error:'project_unavailable'}),{status:404,headers});if(!path.startsWith(prefix)||url.search||url.hash||!(authors?/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/:/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/).test(id))return unavailable();if(request.method!=='GET')return new Response(JSON.stringify({error:'method_not_allowed'}),{status:405,headers:{...headers,Allow:'GET'}});
  const store=new ProjectStore(env.DB,ORIGIN),value=authors?await store.readAuthor(id):await store.readPublished(id);if(!value)return unavailable();const body=JSON.stringify(value);if(new TextEncoder().encode(body).length>(authors?262144:65536))return unavailable();return new Response(body,{headers});
 }
 // Anonymous local public likes. No identity bootstrap, private IDs or timestamps.
 if(path.startsWith('/__lab/likes')){
  const url=new URL(request.url),id=path.slice('/__lab/likes/'.length);const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff','Content-Type':'application/json; charset=utf-8'};
  const unavailable=()=>new Response(JSON.stringify({error:'likes_unavailable'}),{status:404,headers});
  if(!path.startsWith('/__lab/likes/')||url.search||url.hash||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id))return unavailable();
  if(request.method!=='GET')return new Response(JSON.stringify({error:'method_not_allowed'}),{status:405,headers:{...headers,Allow:'GET'}});
  const result=await new ArticleLikeStore(env.DB,ORIGIN).readPublic(id);if(!result)return unavailable();const body=JSON.stringify(result);if(new TextEncoder().encode(body).byteLength>262144)return unavailable();return new Response(body,{headers});
 }
 // Fictional local recent discovery: empty is distinct from a failed public lookup.
 if(path.startsWith('/__lab/discovery')){
  const url=new URL(request.url);const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff','Content-Type':'application/json; charset=utf-8'};
  const error=(status:number,code:string)=>new Response(JSON.stringify({error:code}),{status,headers});
  if(path!=='/__lab/discovery'||url.search||url.hash)return error(404,'discovery_unavailable');
  if(request.method!=='GET')return new Response(JSON.stringify({error:'method_not_allowed'}),{status:405,headers:{...headers,Allow:'GET'}});
  const result=await new ArticlePublicationStore(env.DB,ORIGIN).readRecentPublished();if(!result)return error(503,'discovery_unavailable');
  const body=JSON.stringify(result);if(new TextEncoder().encode(body).byteLength>262144)return error(503,'discovery_unavailable');
  return new Response(body,{headers});
 }
 // Fictional local author discovery. Never deploy this fixture or expose orphan/private profiles.
 if(path.startsWith('/__lab/authors')){
  const url=new URL(request.url);const id=path.slice('/__lab/authors/'.length);
  const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff','Content-Type':'application/json; charset=utf-8'};
  const unavailable=()=>new Response(JSON.stringify({error:'author_unavailable'}),{status:404,headers});
  if(!path.startsWith('/__lab/authors/')||url.search||url.hash||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id))return unavailable();
  if(request.method!=='GET')return new Response(JSON.stringify({error:'method_not_allowed'}),{status:405,headers:{...headers,Allow:'GET'}});
  const result=await new ArticlePublicationStore(env.DB,ORIGIN).readPublishedAuthor(id);if(!result)return unavailable();
  const body=JSON.stringify(result);if(new TextEncoder().encode(body).byteLength>262144)return unavailable();
  return new Response(body,{headers});
 }
 // Fictional local anonymous article delivery: no session bootstrap, cookies or private projection.
 if(path.startsWith('/__lab/articles/')){
  const url=new URL(request.url);const id=path.slice('/__lab/articles/'.length);
  const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'};
  if(request.method!=='GET'||url.search||url.hash||!(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)))return Response.json({error:'article_unavailable'},{status:404,headers});
  const result=await new ArticlePublicationStore(env.DB,ORIGIN).readPublished(id);
  return Response.json(result??{error:'article_unavailable'},{status:result?200:404,headers});
 }
 const project=await createPrivateProjectHandler(env.DB,ORIGIN)(request);if(project)return localDraftResponse(project,request,path);
 const like=await createPrivateLikeHandler(env.DB,ORIGIN)(request);if(like)return like;
 const session=await createPrivateSessionHandler(env.DB,ORIGIN)(request);if(session)return session;
 const moderation=await createModerationHandler(env.DB,ORIGIN,['editor-operator'])(request);if(moderation)return moderation;
 const publication=await createPrivatePublicationHandler(env.DB,ORIGIN)(request);if(publication)return publication;
 const profile=await createPrivateProfileHandler(env.DB,ORIGIN)(request);if(profile)return profile;
 const result=await createPrivateDraftHandler(env.DB,ORIGIN)(request);
 if(result){
  return localDraftResponse(result,request,path);
 }
 if(path.startsWith('/api/')||path.startsWith('/__fixture/'))return Response.json({error:'unavailable'},{status:404,headers:privateHeaders});
 const asset=await env.ASSETS.fetch(request);const response=new Response(asset.body,asset);for(const [name,value] of Object.entries(privateHeaders))response.headers.set(name,value);return response;
}};
