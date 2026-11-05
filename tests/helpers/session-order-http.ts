import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync} from 'node:fs';
export const LAB_ORIGIN='https://session-order.fixture.test',LAB_NOW=1_800_000_000_000;
export class LabJar{
 now=LAB_NOW;values=new Map<string,{value:string;expires:number}>();
 value(name:string){this.header();return this.values.get(name)?.value}
 header(){for(const[k,v]of this.values)if(v.expires<=this.now)this.values.delete(k);return [...this.values].map(([k,v])=>k+'='+v.value).join('; ')}
 apply(r:Response){for(const s of r.headers.getSetCookie()){const pair=s.split(';')[0],at=pair.indexOf('='),name=pair.slice(0,at),value=pair.slice(at+1),age=Number(s.match(/Max-Age=(\d+)/)?.[1]);if(age===0)this.values.delete(name);else this.values.set(name,{value,expires:this.now+age*1000})}}
}
export async function createSessionLab(){
 const pauses=new Map<string,{entered:()=>void;wait:Promise<void>}>(),exchangeCounts=new Map<string,number>();
 const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,modules:true,scriptPath:'.worker/session-order-http-test.js',compatibilityDate:'2026-11-05',d1Databases:['DB'],outboundService:async r=>{
  const u=new URL(r.url);if(u.origin!=='https://closed-provider.invalid')throw Error('fixture refuses external network');
  if(u.pathname.startsWith('/pause/')){const p=pauses.get(decodeURIComponent(u.pathname.slice(7)));if(!p)throw Error('unknown fixture pause');p.entered();await p.wait;return new Response(null,{status:204})}
  if(u.pathname!=='/exchange')throw Error('unknown synthetic provider route');
  const {state,code}=await r.json() as {state:string;code:string};exchangeCounts.set(state,(exchangeCounts.get(state)??0)+1);
  return code==='fail'?new Response(null,{status:400}):new Response(code);
 }}));
 const db=await mf.getD1Database('DB');
 for(const block of readFileSync('tests/fixtures/session-order-lab.sql','utf8').split(/^-- @statement\s*$/m)){
  const sql=block.replace(/^--.*$/gm,'').trim();if(sql)await db.prepare(sql).run();
 }
 const base=(await mf.ready).origin;
 async function call(jar:LabJar,path:string,method='GET',apply=true,extra:Record<string,string>={}){
  const r=await fetch(base+path,{method,redirect:'manual',headers:{Cookie:jar.header(),'X-Lab-Now':String(jar.now),...(method==='POST'?{Origin:LAB_ORIGIN}:{}),...extra}});if(apply)jar.apply(r);return r;
 }
 async function bootstrap(jar=new LabJar()){const r=await call(jar,'/lab/bootstrap','POST');if(r.status!==204)throw Error('fixture bootstrap failed');return jar}
 async function proof(jar:LabJar,action:'start'|'logout'='start'){const r=await call(jar,'/lab/proof?action='+action,'POST');if(r.status!==200)throw Error('fixture proof failed');return (await r.json() as {command:string}).command}
 async function start(jar:LabJar,command?:string,apply=true,extra:Record<string,string>={}){
  const r=await call(jar,'/lab/start','POST',apply,{'X-Lab-Command':command??await proof(jar),...extra});const location=r.headers.get('Location');return {response:r,state:location?new URL(location).searchParams.get('state')!:''};
 }
 const callback=(jar:LabJar,state:string,actor='A',apply=true,extra:Record<string,string>={})=>call(jar,'/lab/callback?state='+state+'&code='+actor,'GET',apply,extra);
 async function login(jar:LabJar,actor='A'){const s=await start(jar);if(s.response.status!==303)throw Error('fixture start failed');const r=await callback(jar,s.state,actor);if(r.headers.getSetCookie().length!==1)throw Error('fixture session failed');return s.state}
 async function inspect(jar:LabJar){const r=await call(jar,'/lab/private');return {status:r.status,body:await r.json() as {actor?:string;csrf?:string;error?:string}}}
 function pause(tag:string){let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);pauses.set(tag,{entered,wait});return {ready,release}}
 return {mf,db,base,call,bootstrap,proof,start,callback,login,inspect,pause,exchangeCounts,dispose:()=>mf.dispose()};
}
