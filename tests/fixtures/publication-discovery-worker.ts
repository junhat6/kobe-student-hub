import {createFixtureSession} from '../helpers/coordinated-fixture';
import {SessionStore} from '../../worker/auth/sessions';
import {PublicProfileStore} from '../../worker/public-profile';
import {PrivateDraftStore} from '../../worker/drafts';
import {ArticlePublicationStore} from '../../worker/publication';
// Test-only fictional sessions and query failure/race controls; never production routes.
export default {async fetch(request:Request,env:{DB:D1Database}){
 const i=await request.json() as {action:string;who?:string;headers?:Record<string,string>;input?:unknown;target?:unknown;draft?:string;fault?:boolean;hideAfterSelection?:boolean};const origin='https://app.example.invalid';const now=1800000000000;
 if(i.action==='session')return Response.json(await createFixtureSession(env.DB,origin,()=>now,{provider:'google',subject:'subject-'+i.who,email:'fictional@st.kobedenshi.ac.jp'}));
 const db=i.fault||i.hideAfterSelection?new Proxy(env.DB,{get(target,key){if(key!=='prepare'){const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}return (sql:string)=>{const wrap=(stmt:D1PreparedStatement):D1PreparedStatement=>new Proxy(stmt,{get(statement,property){if(property==='bind')return(...values:unknown[])=>wrap(statement.bind(...values));if(property==='all')return async()=>{if(i.fault)throw new Error('synthetic storage failure');const result=await statement.all();if(i.hideAfterSelection&&sql.includes('public_valid')&&result.results.length){const id=(result.results[0] as {id:string}).id;await env.DB.prepare("UPDATE content SET status='hidden' WHERE id=?").bind(id).run()}return result};const value=Reflect.get(statement,property);return typeof value==='function'?value.bind(statement):value}});return wrap(target.prepare(sql))}}}):env.DB;
 const target=new Request(origin+'/fixture',{method:'POST',headers:i.headers});const store=new ArticlePublicationStore(db,origin,()=>now);
 return Response.json(i.action==='recent'?await store.readRecentPublished():i.action==='author'?await store.readPublishedAuthor(i.target):i.action==='read'?await store.readPublished(i.target):i.action==='profile'?await new PublicProfileStore(db,origin,()=>now).create(target,i.input):i.action==='draft'?await new PrivateDraftStore(db,origin,()=>now).create(target,i.input):await store.publish(target,i.draft,i.input));
}};
