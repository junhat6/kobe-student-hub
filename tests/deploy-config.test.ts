import {describe,it,expect} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const script=resolve('scripts/prepare-deploy.mjs');const template=readFileSync('wrangler.jsonc','utf8');
const account='a'.repeat(32),database='11111111-2222-3333-4444-555555555555';
const baseEnv={CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_EXPECTED_ACCOUNT_ID:account,CLOUDFLARE_D1_DATABASE_ID:database,CLOUDFLARE_EXPECTED_D1_DATABASE_ID:database};
function run(patch:Record<string,string|undefined>={},config=template,args:string[]=[]){
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'hub-deploy-config-')));try{
  writeFileSync(join(dir,'wrangler.jsonc'),config);const r=spawnSync(process.execPath,[script,...args],{cwd:dir,env:{...process.env,...baseEnv,CLOUDFLARE_API_TOKEN:'',...patch},encoding:'utf8'});const out=join(dir,'.wrangler/preview.deploy.json');return {status:r.status,stdout:r.stdout,stderr:r.stderr,config:existsSync(out)?JSON.parse(readFileSync(out,'utf8')):null,dir};
 }finally{rmSync(dir,{recursive:true,force:true})}
}
describe('private runtime deploy configuration',()=>{
 it('keeps target and absolute paths explicit, without copying a credential into config',()=>{
  const r=run({CLOUDFLARE_API_TOKEN:'fixture-only-not-a-real-credential'});expect(r.status).toBe(0);expect(r.config.name).toBe('kobe-student-hub-preview');expect(r.config.workers_dev).toBe(true);expect(r.config.preview_urls).toBe(false);expect(r.config.account_id).toBe(account);expect(r.config.d1_databases[0].database_id).toBe(database);expect(r.config.main).toBe(join(r.dir,'worker/index.ts'));expect(r.config.assets.directory).toBe(join(r.dir,'dist'));expect(r.config.observability).toEqual({...JSON.parse(template).observability,enabled:true,head_sampling_rate:0.1,redact_query_string:true});expect(JSON.stringify(r.config)).not.toContain('fixture-only');
 });
 it.each([
  {CLOUDFLARE_ACCOUNT_ID:''},
  {CLOUDFLARE_EXPECTED_ACCOUNT_ID:'b'.repeat(32)},
  {CLOUDFLARE_D1_DATABASE_ID:''},
  {CLOUDFLARE_EXPECTED_D1_DATABASE_ID:'99999999-2222-3333-4444-555555555555'},
  {CLOUDFLARE_D1_DATABASE_ID:'00000000-0000-0000-0000-000000000000',CLOUDFLARE_EXPECTED_D1_DATABASE_ID:'00000000-0000-0000-0000-000000000000'},
 ])('refuses missing, placeholder or mismatched target settings',patch=>{const r=run(patch);expect(r.status).toBe(1);expect(r.config).toBeNull();expect(r.stdout+r.stderr).not.toContain(account)});
 it('refuses an unrelated Worker target',()=>{const config=JSON.parse(template);config.name='unrelated-service';expect(run({},JSON.stringify(config)).status).toBe(1)});
 it.each(['assets','migrations','binding'])('refuses an unexpected %s source path/binding',field=>{const config=JSON.parse(template);if(field==='assets')config.assets.directory='../';else if(field==='migrations')config.d1_databases[0].migrations_dir='../other-sql';else config.assets.binding='OTHER';const r=run({},JSON.stringify(config));expect(r.status).toBe(1);expect(r.config).toBeNull()});
 it('does not initiate an interactive CI grant when the credential is missing',()=>{const r=run({CI:'true'},template,['--for-deploy']);expect(r.status).toBe(1);expect(r.config).toBeNull()});
});

it('keeps remote SQL mutation separate from the deployment command',()=>{const pkg=JSON.parse(readFileSync('package.json','utf8'));expect(pkg.scripts['deploy:production']).not.toMatch(/d1\s+(?:migrations\s+apply|execute)/)});
