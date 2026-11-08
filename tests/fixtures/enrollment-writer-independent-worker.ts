import {createFixtureSession} from '../helpers/coordinated-fixture';
import {PrivateDraftStore} from '../../worker/drafts';
import {PublicProfileStore} from '../../worker/public-profile';
import {ArticlePublicationStore} from '../../worker/publication';
import {ProjectStore} from '../../worker/projects';
import {ArticleLikeStore} from '../../worker/likes';
import {ArticleModerationStore} from '../../worker/moderation';
import {ProjectReportStore} from '../../worker/project-reports';
import {PublicationStopStore} from '../../worker/publication-stops';
import {OwnPublicationStore} from '../../worker/own-publications';
import {EnrollmentStore} from '../../worker/auth/enrollment';
import {SessionStore} from '../../worker/auth/sessions';

// Independent local test entry. The fixture never invents an enrollment declaration.
const origin='https://enrollment-writer.example.invalid';
type Input={op:string;who?:number;now:number;headers?:Record<string,string>;input?:unknown;id?:string;kind?:'article'|'project';race?:string};
export default {async fetch(request:Request,env:{DB:D1Database}) {
 const i=await request.json() as Input;
 const now=i.now;let fired=false,clockSamples=0;
 // The first two samples authenticate and create the proof; final guards see the end.
 const clock=()=>i.race==='clock-end'&&++clockSamples>=3?i.now+1:now;
 if(i.op==='session')return Response.json(await createFixtureSession(env.DB,origin,clock,{provider:'google',subject:'independent-subject-'+i.who,email:'fixture@st.kobedenshi.ac.jp'},{enrollment:false}));
 const db=i.race?new Proxy(env.DB,{get(target,key){
  if(key!=='prepare'){const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}
  return(sql:string)=>{
   const wrap=(statement:D1PreparedStatement):D1PreparedStatement=>new Proxy(statement,{get(st,prop){
    if(prop==='bind')return(...values:unknown[])=>wrap(st.bind(...values));
    if(prop==='first')return async(...args:Parameters<D1PreparedStatement['first']>)=>{
     const result=await st.first(...args);
     if(!fired&&i.race!=='clock-end'&&sql.startsWith('UPDATE auth_sessions SET last_seen_ms=')){
      fired=true;const account=(result as {account_id?:string}|null)?.account_id??'';
      if(i.race==='period-delete')await env.DB.prepare('DELETE FROM private_enrollment_periods WHERE owner_account_id=?').bind(account).run();
      if(i.race==='period-end')await env.DB.prepare("UPDATE private_enrollment_periods SET admission_year=2024,graduation_year=2024,starts_at_ms=1711897200000,ends_at_ms=1743433200000,version=version+1 WHERE owner_account_id=?").bind(account).run();
      if(i.race==='epoch')await env.DB.prepare('UPDATE private_accounts SET session_epoch=session_epoch+1 WHERE id=?').bind(account).run();
     }
     return result;
    };
    const value=Reflect.get(st,prop);return typeof value==='function'?value.bind(st):value;
   }});return wrap(target.prepare(sql));
  };
 }}):env.DB;
 const read=['draft-read','draft-list','profile-read','article-receipt','project-read','project-list','project-receipt','like-read','article-report-read','project-report-read','article-queue','article-case','project-queue','project-case','own-publications','enrollment-read','public-article','public-project','public-article-author','public-project-author','public-likes','public-discovery'].includes(i.op);
 const method=read?'GET':i.op==='draft-delete'?'DELETE':['draft-update','project-save','like','enrollment-save'].includes(i.op)?'PUT':'POST';
 const req=new Request(origin+'/api/private/fixture',{method,headers:i.headers});
 const drafts=new PrivateDraftStore(db,origin,clock),profiles=new PublicProfileStore(db,origin,clock),articles=new ArticlePublicationStore(db,origin,clock),projects=new ProjectStore(db,origin,clock),likes=new ArticleLikeStore(db,origin,clock),moderation=new ArticleModerationStore(db,origin,['independent-account-2'],clock),reports=new ProjectReportStore(db,origin,['independent-account-2'],clock);
 let result:unknown=null;
 switch(i.op){
 case 'draft-create':result=await drafts.create(req,i.input);break;
 case 'draft-update':result=await drafts.update(req,i.id,i.input);break;
 case 'draft-delete':result=await drafts.delete(req,i.id,i.input);break;
 case 'draft-read':result=await drafts.read(req,i.id);break;
 case 'draft-list':result=await drafts.list(req);break;
 case 'profile-create':result=await profiles.create(req,i.input);break;
 case 'profile-read':result=await profiles.getOwn(req);break;
 case 'article-publish':result=await articles.publish(req,i.id,i.input);break;
 case 'article-receipt':result=await articles.getOwnReceipt(req,i.id);break;
 case 'project-create':result=await projects.createDraft(req,i.input);break;
 case 'project-save':result=await projects.saveDraft(req,i.id,i.input);break;
 case 'project-publish':result=await projects.publish(req,i.id,i.input);break;
 case 'project-read':result=await projects.getDraft(req,i.id);break;
 case 'project-list':result=await projects.listDrafts(req);break;
 case 'project-receipt':result=await projects.getOwnReceipt(req,i.id);break;
 case 'like':result=await likes.setOwn(req,i.id,i.input);break;
 case 'like-read':result=await likes.getOwn(req,i.id);break;
 case 'article-report':result=await moderation.report(req,i.id,i.input);break;
 case 'article-report-read':result=await moderation.getOwnReport(req,i.id);break;
 case 'project-report':result=await reports.report(req,i.id,i.input);break;
 case 'project-report-read':result=await reports.getOwnReceipt(req,i.id);break;
 case 'article-queue':result=await moderation.queue(req);break;
 case 'article-case':result=await moderation.readCase(req,i.id);break;
 case 'project-queue':result=await reports.queue(req);break;
 case 'project-case':result=await reports.readCase(req,i.id);break;
 case 'own-publications':result=await new OwnPublicationStore(db,origin,clock).list(req);break;
 case 'stop':result=await new PublicationStopStore(db,origin,clock).stop(req,i.kind,i.id,i.input);break;
 case 'enrollment-read':result=await new EnrollmentStore(db,origin,clock).getOwn(req);break;
 case 'enrollment-save':result=await new EnrollmentStore(db,origin,clock).save(req,i.input);break;
 case 'logout':result=await new SessionStore(db,origin,clock).logout(req);break;
 case 'public-article':result=await articles.readPublished(i.id);break;
 case 'public-project':result=await projects.readPublished(i.id);break;
 case 'public-article-author':result=await articles.readPublishedAuthor(i.id);break;
 case 'public-project-author':result=await projects.readAuthor(i.id);break;
 case 'public-likes':result=await likes.readPublic(i.id);break;
 case 'public-discovery':result=await projects.readRecentPublished();break;
 }
 return Response.json(result);
}};
