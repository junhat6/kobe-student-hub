import {readFileSync,realpathSync,lstatSync,mkdirSync,unlinkSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync,constants} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
const fail=()=>{throw Error('Production configuration validation failed.');};
function keys(v,wanted){if(!v||typeof v!=='object'||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==wanted.length||!wanted.every(k=>Object.hasOwn(v,k)))fail();}
const account=v=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v)&&v!=='0'.repeat(32);
const database=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v)&&v!=='00000000-0000-0000-0000-000000000000';
const name=v=>typeof v==='string'&&/^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(v);
/** Pure consistency checks for a private selection or local fictional fixtures. Agreement is NOT remote ownership/authorization proof. */
export function validateProductionConfig(template,target,preview,root,workerSource){
 keys(target,['workerName','accountId','databaseId','databaseName','origin']);keys(preview,['workerName','accountId','databaseId','databaseName']);
 if(preview.workerName!=='kobe-student-hub-preview'||preview.databaseName!=='kobe-student-hub-preview')fail();
 if(target.workerName!=='kobe-student-hub-production'||target.databaseName!=='kobe-student-hub-production')fail();
 if(!name(target.workerName)||!name(target.databaseName)||!name(preview.workerName)||!name(preview.databaseName)||!account(target.accountId)||!account(preview.accountId)||!database(target.databaseId)||!database(preview.databaseId)||target.accountId!==preview.accountId||target.workerName===preview.workerName||target.databaseName===preview.databaseName||target.databaseId===preview.databaseId)fail();
 try{const u=new URL(target.origin);const labels=u.hostname.split('.');if(u.protocol!=='https:'||u.origin!==target.origin||u.port||labels.length!==4||labels[0]!==target.workerName||labels[2]!=='workers'||labels[3]!=='dev'||!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(labels[1]))fail()}catch{fail()}
 keys(template,['$schema','name','main','compatibility_date','compatibility_flags','workers_dev','preview_urls','assets','d1_databases','observability']);
 if(template.$schema!=='node_modules/wrangler/config-schema.json'||template.name!==preview.workerName||template.main!=='worker/index.ts'||template.compatibility_date!=='2026-11-03'||!Array.isArray(template.compatibility_flags)||template.compatibility_flags.length!==1||template.compatibility_flags[0]!=='nodejs_compat'||template.workers_dev!==false||template.preview_urls!==false)fail();
 keys(template.assets,['directory','binding','not_found_handling','run_worker_first']);if(template.assets.directory!=='./dist'||template.assets.binding!=='ASSETS'||template.assets.not_found_handling!=='single-page-application'||!Array.isArray(template.assets.run_worker_first)||template.assets.run_worker_first.length!==1||template.assets.run_worker_first[0]!=='/api/*')fail();
 if(!Array.isArray(template.d1_databases)||template.d1_databases.length!==1)fail();const d=template.d1_databases[0];keys(d,['binding','database_name','database_id','migrations_dir']);if(d.binding!=='DB'||d.database_name!==preview.databaseName||d.database_id!=='00000000-0000-0000-0000-000000000000'||d.migrations_dir!=='migrations')fail();
 keys(template.observability,['enabled','head_sampling_rate','redact_query_string']);if(template.observability.enabled!==true||template.observability.head_sampling_rate!==0.1||template.observability.redact_query_string!==true||typeof workerSource!=='string'||!/^const OAUTH_HTTP_RELEASE_ENABLED=false;$/m.test(workerSource))fail();
 // Construct only reviewed fields; never forward arbitrary vars/secrets/routes/bindings/build commands.
 return {$schema:resolve(root,'node_modules/wrangler/config-schema.json'),name:target.workerName,account_id:target.accountId,main:resolve(root,'worker/index.ts'),compatibility_date:'2026-11-03',compatibility_flags:['nodejs_compat'],workers_dev:true,preview_urls:false,assets:{directory:resolve(root,'dist'),binding:'ASSETS',not_found_handling:'single-page-application',run_worker_first:['/api/*','/trial-assets/*']},d1_databases:[{binding:'DB',database_name:target.databaseName,database_id:target.databaseId,migrations_dir:resolve(root,'migrations')}],observability:{enabled:true,head_sampling_rate:0.1,redact_query_string:true}};
}
const currentOwner=s=>typeof process.getuid==='function'&&s.uid===process.getuid();
function privateDir(s){if(!s||!s.isDirectory()||!currentOwner(s)||(s.mode&0o022)!==0)fail();return s;}
const stat=path=>{try{return lstatSync(path)}catch(e){if(e.code==='ENOENT')return null;throw e}};
function owned(root,path,kind,optional=false){const rel=relative(root,path);if(rel.startsWith('..')||isAbsolute(rel))fail();let current=root;for(const part of rel.split('/').filter(Boolean)){current=join(current,part);const s=stat(current);if(!s){if(optional&&current===path)return null;fail()}if(s.isSymbolicLink())fail();if(current!==path&&!s.isDirectory())fail()}const s=stat(path);if(s&&(kind==='file'?!s.isFile():!s.isDirectory()))fail();return s;}
/** Private sample-only artifact preparation. This never invokes deployment or SQL.
 * Protects controlled paths, not hostile concurrent mutation by a same-user filesystem administrator. */
export function clearProductionArtifact(workspace){const root=realpathSync(workspace),dir=join(root,'.wrangler');const s=owned(root,dir,'dir',true);if(!s)return;privateDir(s);const out=join(dir,'production.prepare.json'),file=owned(root,out,'file',true);if(file){if(!currentOwner(file))fail();unlinkSync(out)}}
export function prepareProductionArtifact(workspace,target,preview){let root,output,temp;try{
 root=realpathSync(workspace);const dir=join(root,'.wrangler');output=join(dir,'production.prepare.json');
 clearProductionArtifact(root);
 for(const [path,kind] of [['wrangler.jsonc','file'],['worker/index.ts','file'],['dist','dir'],['migrations','dir']])owned(root,join(root,path),kind);
 const template=JSON.parse(readFileSync(join(root,'wrangler.jsonc'),'utf8'));const source=readFileSync(join(root,'worker/index.ts'),'utf8');const config=validateProductionConfig(template,target,preview,root,source);
 if(!stat(dir))mkdirSync(dir,{mode:0o700});privateDir(owned(root,dir,'dir'));owned(root,output,'file',true);
 temp=join(dir,'.production.prepare.'+randomUUID()+'.tmp');const fd=openSync(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,JSON.stringify(config,null,2)+'\n');fsyncSync(fd)}finally{closeSync(fd)}
 if(stat(output))fail();renameSync(temp,output);temp=undefined;return output;
 }catch{if(temp&&root){try{if(owned(root,temp,'file',true))unlinkSync(temp)}catch{}}throw Error('Production artifact preparation failed.');}}
