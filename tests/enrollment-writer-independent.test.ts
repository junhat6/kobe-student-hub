import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import {enrollmentWindow} from '../src/shared/enrollment';

const ORIGIN='https://enrollment-writer.example.invalid';
const END=Date.UTC(2027,2,31,15),NOW=END-1;
type Session={setCookie:string;contextCookie:string;csrfToken:string};
type Draft={id:string;version:number};
type Call={op:string;n?:number;id?:string;input?:unknown;kind?:'article'|'project';race?:string};
const profile={displayName:'Explicit independent profile',department:'Manual department',yearLabel:'Manual public label',bio:'Explicit public bio',confirmPublic:true};
const articleFields={title:'Independent article',body:'# Explicit saved body'};
const projectFields={title:'Independent project',description:'Explicit description',githubUrl:'',demoUrl:''};
const articlePublish={expectedVersion:1,confirmPublic:true,summary:'Explicit summary',tags:['学び'],minutes:3};
const projectPublish={expectedVersion:1,confirmPublic:true};
let mf:Miniflare,users:Session[],articleDraft:Draft,projectDraft:Draft,publicArticle:string,publicProject:string,ownArticle:string,ownProject:string,profileId:string;
const headers=(n:number)=>({Cookie:[users[n].setCookie,users[n].contextCookie].map(cookie=>cookie.split(';')[0]).join('; '),Origin:ORIGIN,Authorization:'Bearer csrf.'+users[n].csrfToken});
async function call<T=unknown>(i:Call):Promise<T>{return await(await mf.dispatchFetch(ORIGIN+'/fixture',{method:'POST',body:JSON.stringify({...i,now:NOW,headers:headers(i.n??0)})})).json() as T}
async function session(n:number){return await(await mf.dispatchFetch(ORIGIN+'/fixture',{method:'POST',body:JSON.stringify({op:'session',who:n,now:NOW})})).json() as Session}
async function period(n:number,mode='current'){
 const db=await mf.getD1Database('DB'),owner='independent-account-'+n;
 await db.prepare('DELETE FROM private_enrollment_periods WHERE owner_account_id=?').bind(owner).run();
 if(mode==='missing')return;
 const years=mode==='upcoming'?{admissionYear:2027,graduationYear:2027}:mode==='ended'?{admissionYear:2025,graduationYear:2025}:{admissionYear:2026,graduationYear:2026};
 const w=enrollmentWindow(years)!;
 await db.prepare('INSERT INTO private_enrollment_periods VALUES(?,?,?,?,?,1,1,?)').bind(owner,years.admissionYear,years.graduationYear,w.startsAtMs,w.endsAtMs,mode==='future-record'?NOW+1:NOW).run();
}
const writeTables=['public_profiles','account_public_profiles','private_article_drafts','article_publications','content','project_drafts','project_publications','article_likes','article_reports','article_report_outbox','project_reports'];
async function snapshot(){const db=await mf.getD1Database('DB');return await Promise.all(writeTables.map(async table=>[table,(await db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()).results]))}
function writers():Call[]{return [
 {op:'draft-create',input:articleFields},
 {op:'draft-update',id:articleDraft.id,input:{...articleFields,title:'Updated independent article',expectedVersion:1}},
 {op:'profile-create',n:1,input:profile},
 {op:'profile-create',input:profile},
 {op:'article-publish',id:articleDraft.id,input:articlePublish},
 {op:'project-create',input:projectFields},
 {op:'project-save',id:projectDraft.id,input:{...projectFields,title:'Updated independent project',expectedVersion:1}},
 {op:'project-publish',id:projectDraft.id,input:projectPublish},
 {op:'like',id:publicArticle,input:{liked:true,confirmPublic:true}},
 {op:'article-report',id:publicArticle,input:{reason:'Independent article reason'}},
 {op:'project-report',id:publicProject,input:{reason:'Independent project reason'}},
]}
beforeAll(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.worker/enrollment-writer-independent-test.js',compatibilityDate:'2026-11-03',d1Databases:['DB']}));
 const db=await mf.getD1Database('DB');
 for(const file of readdirSync('migrations').filter(file=>/^\d{4}_.*\.sql$/.test(file)&&file<'0017_').sort()){
  const sql=readFileSync('migrations/'+file,'utf8');
  for(const statement of sql.split(sql.includes('-- @statement')?/^-- @statement\s*$/m:/;\s*(?:\n|$)/).map(part=>part.replace(/^--.*$/gm,'').trim()).filter(Boolean))await db.prepare(statement).run();
 }
 users=[];
 for(let n=0;n<4;n++){
  await db.prepare("INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES(?,?,?,'active',?)").bind('independent-account-'+n,'independent-subject-'+n,n+'@st.kobedenshi.ac.jp',NOW).run();
  users.push(await session(n));
 }
 expect((await db.prepare('SELECT COUNT(*) n FROM private_enrollment_periods').first<{n:number}>())!.n).toBe(0);
 for(let n=0;n<4;n++)await period(n);
 profileId=(await call<{profile:{id:string}}>({op:'profile-create',input:profile})).profile.id;
 expect(await call({op:'profile-create',n:3,input:{...profile,displayName:'Separate public author'}})).not.toBeNull();
 const publishedDraft=await call<Draft>({op:'draft-create',n:3,input:articleFields});
 publicArticle=(await call<{contentId:string}>({op:'article-publish',n:3,id:publishedDraft.id,input:articlePublish})).contentId;
 const publishedProjectDraft=await call<Draft>({op:'project-create',n:3,input:projectFields});
 publicProject=(await call<{projectId:string}>({op:'project-publish',n:3,id:publishedProjectDraft.id,input:projectPublish})).projectId;
 articleDraft=await call<Draft>({op:'draft-create',input:articleFields});
 projectDraft=await call<Draft>({op:'project-create',input:projectFields});
},30000);
afterAll(async()=>{await mf?.dispose()});

describe('independent enrollment participation integration',()=>{
 for(const mode of ['missing','upcoming','ended','future-record'])it(`blocks all eleven participant mutations for ${mode} periods without touching content`,async()=>{
  await period(0,mode);await period(1,mode);const before=await snapshot();
  if(mode==='future-record')expect(await call({op:'enrollment-read'})).toBeNull();
  for(const write of writers())expect(await call(write),write.op).toBeNull();
  expect(await snapshot()).toEqual(before);
 });
 for(const race of ['period-delete','period-end','clock-end'])it(`rechecks final stored eligibility after ${race} races in each writer`,async()=>{
  for(const write of writers()){
   await period(0);await period(1);const before=await snapshot();
   expect(await call({...write,race}),write.op).toBeNull();
   expect(await snapshot(),write.op).toEqual(before);
  }
 });
 it('keeps final account epoch checks in each participant writer',async()=>{
  for(const write of writers()){
   const n=write.n??0;await period(n);users[n]=await session(n);const before=await snapshot();
   expect(await call({...write,race:'epoch'}),write.op).toBeNull();expect(await snapshot(),write.op).toEqual(before);
  }
  users[0]=await session(0);users[1]=await session(1);
 });
 it('accepts the same operations immediately before the exclusive period end',async()=>{
  await period(0);await period(1);
  // Publishing uses the saved version before update, then updates remain separately eligible.
  const writes=writers();const publishIndices=[4,7];
  for(const index of publishIndices){const result=await call<{contentId?:string;projectId?:string}>(writes[index]);expect(result).not.toBeNull();if(index===4)ownArticle=result.contentId!;else ownProject=result.projectId!}
  for(let index=0;index<writes.length;index++)if(!publishIndices.includes(index))expect(await call(writes[index]),writes[index].op).not.toBeNull();
 });
 it('does not expose declaration years in public readers, authors, discovery or public likes',async()=>{
  for(const [op,id] of [['public-article',publicArticle],['public-project',publicProject],['public-article-author',profileId],['public-project-author',profileId],['public-discovery',undefined],['public-likes',profileId]] as const){
   const value=await call({op,id});expect(value,op).not.toBeNull();
   for(const marker of ['admissionYear','graduationYear','startsAtMs','endsAtMs','policyVersion','private_enrollment','independent-account','independent-subject','st.kobedenshi'])expect(JSON.stringify(value),op).not.toContain(marker);
  }
 });
 it('preserves owner reads, declaration correction, delete, unlike, stop, operator access and logout after ending',async()=>{
  for(let n=0;n<3;n++)await period(n,'ended');
  for(const i of [
   {op:'draft-read',id:articleDraft.id},{op:'draft-list'},{op:'profile-read'},
   {op:'article-receipt',id:articleDraft.id},{op:'project-read',id:projectDraft.id},{op:'project-list'},{op:'project-receipt',id:projectDraft.id},
   {op:'like-read',id:publicArticle},{op:'article-report-read',id:publicArticle},{op:'project-report-read',id:publicProject},{op:'own-publications'},
   {op:'enrollment-read'},{op:'article-queue',n:2},{op:'article-case',n:2,id:publicArticle},{op:'project-queue',n:2},{op:'project-case',n:2,id:publicProject},
  ])expect(await call(i),i.op).not.toBeNull();
  expect(await call({op:'article-queue'})).toBeNull();expect(await call({op:'project-queue'})).toBeNull();
  expect(await call({op:'like',id:publicArticle,input:{liked:false}})).toEqual({liked:false});
  expect(await call({op:'draft-delete',id:articleDraft.id,input:{expectedVersion:2}})).toEqual({deleted:true});
  for(const [kind,id] of [['article',ownArticle],['project',ownProject]] as const)expect(await call({op:'stop',kind,id,input:{expectedSourceVersion:1,confirmStop:true}})).toMatchObject({status:'hidden',stopped:true});
  expect(await call({op:'enrollment-save',input:{admissionYear:2026,graduationYear:2026,expectedVersion:1}})).toMatchObject({participation:'current'});
  await period(0,'ended');expect(await call({op:'logout'})).toEqual({loggedOut:true});expect(await call({op:'enrollment-read'})).toBeNull();
 });
 it('does not revive suspended or deleted accounts through declaration correction',async()=>{
  const db=await mf.getD1Database('DB');
  for(const status of ['suspended','deleted']){
   await db.prepare("UPDATE private_accounts SET status='active' WHERE id='independent-account-1'").run();users[1]=await session(1);
   await db.prepare('UPDATE private_accounts SET status=? WHERE id=?').bind(status,'independent-account-1').run();
   const before=await db.prepare("SELECT * FROM private_enrollment_periods WHERE owner_account_id='independent-account-1'").first();
   expect(await call({op:'enrollment-save',n:1,input:{admissionYear:2026,graduationYear:2027,expectedVersion:1}})).toBeNull();
   expect(await db.prepare("SELECT * FROM private_enrollment_periods WHERE owner_account_id='independent-account-1'").first()).toEqual(before);
  }
 });
});
