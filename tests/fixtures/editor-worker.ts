import {SessionStore} from '../../worker/auth/sessions';
import {createPrivateDraftHandler} from '../../worker/draft-http';
const ORIGIN='https://127.0.0.1:8788';
const privateHeaders={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff','Vary':'Cookie'};
export default {async fetch(request:Request,env:{DB:D1Database;ASSETS:Fetcher;LOCAL_EDITOR_FIXTURE:string}){
 if(env.LOCAL_EDITOR_FIXTURE!=='local-only-fictional'||new URL(request.url).origin!==ORIGIN)return new Response('Local fixture only',{status:404,headers:privateHeaders});
 const path=new URL(request.url).pathname;
 if(path==='/__fixture/session'){
  if(request.method!=='POST'||request.headers.get('Origin')!==ORIGIN)return Response.json({error:'unavailable'},{status:403,headers:privateHeaders});
  try{const text=await request.text();if(text.length>100)return Response.json({error:'unavailable'},{status:400,headers:privateHeaders});const input=JSON.parse(text) as {account?:unknown};if(input.account!=='a'&&input.account!=='b')return Response.json({error:'unavailable'},{status:400,headers:privateHeaders});
   const session=await new SessionStore(env.DB,ORIGIN).create({provider:'google',subject:'editor-fictional-'+input.account,email:'editor-fictional@st.kobedenshi.ac.jp'});if(!session)return Response.json({error:'unavailable'},{status:503,headers:privateHeaders});
   return Response.json({csrfToken:session.csrfToken},{headers:{...privateHeaders,'Set-Cookie':session.setCookie}});
  }catch{return Response.json({error:'unavailable'},{status:400,headers:privateHeaders})}
 }
 const result=await createPrivateDraftHandler(env.DB,ORIGIN)(request);if(result)return result;
 if(path.startsWith('/api/')||path.startsWith('/__fixture/'))return Response.json({error:'unavailable'},{status:404,headers:privateHeaders});
 const asset=await env.ASSETS.fetch(request);const response=new Response(asset.body,asset);for(const [name,value] of Object.entries(privateHeaders))response.headers.set(name,value);return response;
}};
