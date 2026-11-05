import {it,expect} from 'vitest';
import {SessionOrderModel,ModelJar,type Headers} from './fixtures/session-order-model';
function setup(){const m=new SessionOrderModel(),j=new ModelJar();j.apply(m.bootstrap());return {m,j}}
const start=(m:SessionOrderModel,j:ModelJar)=>m.start(j.context,m.proof(j.context)??undefined)!;
const login=(m:SessionOrderModel,j:ModelJar,actor:string)=>{const a=start(m,j);j.apply(m.complete(a,j.context,actor));return a};
it('rejects late A cookie after B: loses login, never accepts A; fresh verified login recovers',()=>{
 const {m,j}=setup(),a=start(m,j),late=m.complete(a,j.context,'A');login(m,j,'B');expect(m.inspect(j)).toEqual({kind:'authenticated',actor:'B'});
 j.apply(late);expect(m.inspect(j)).toEqual({kind:'signed-out'});expect(m.commit(j)).toBe(false);
 login(m,j,'B');expect(m.inspect(j)).toEqual({kind:'authenticated',actor:'B'});
});
it('rejects provider completion after newer start, and consumes its old claim',()=>{
 const {m,j}=setup(),a=start(m,j);expect(m.claim(a,j.context)).toBe(true);const b=start(m,j);
 expect(m.issue(a,j.context,'A')).toEqual({});expect(m.claim(a,j.context)).toBe(false);j.apply(m.complete(b,j.context,'B'));expect(m.inspect(j)).toEqual({kind:'authenticated',actor:'B'});
});
it('invalidates old login at start, even if the new provider attempt fails',()=>{
 const {m,j}=setup();login(m,j,'A');start(m,j);expect(m.inspect(j)).toEqual({kind:'signed-out'});
});
it('logout with stale session uses context proof and blocks pending/late callback resurrection',()=>{
 const {m,j}=setup(),a=start(m,j),late=m.complete(a,j.context,'A'),b=start(m,j);expect(m.claim(b,j.context)).toBe(true);j.apply(late);
 expect(m.logout(j.context,m.proof(j.context,'logout')!)).toBe(true);expect(m.issue(b,j.context,'B')).toEqual({});j.apply(late);expect(m.inspect(j)).toEqual({kind:'signed-out'});
});
it('does not erase newer login with delayed logout response headers',()=>{
 const {m,j}=setup();login(m,j,'A');expect(m.logout(j.context,m.proof(j.context,'logout')!)).toBe(true);const oldLogout:Headers={};login(m,j,'B');j.apply(oldLogout);expect(m.inspect(j)).toEqual({kind:'authenticated',actor:'B'});
});
it('defines late logout command by server commit order and requires explicit fresh login',()=>{
 const {m,j}=setup(),proof=m.proof(j.context,'logout')!;login(m,j,'B');expect(m.logout(j.context,proof)).toBe(true);expect(m.inspect(j)).toEqual({kind:'signed-out'});
});
it('checks final private read/write authority again after another tab starts',()=>{
 const {m,j}=setup();login(m,j,'A');expect(m.inspect(j).kind).toBe('authenticated');start(m,j);expect(m.commit(j)).toBe(false);expect(m.writes).toEqual([]);
});
it('keeps device generations isolated while preserving account-wide revocation',()=>{
 const {m,j}=setup(),other=new ModelJar();other.apply(m.bootstrap());login(m,j,'A');login(m,other,'A');m.logout(j.context,m.proof(j.context,'logout')!);
 expect(m.inspect(other)).toEqual({kind:'authenticated',actor:'A'});m.accounts.get('A')!.epoch++;expect(m.inspect(other)).toEqual({kind:'signed-out'});
});
it('context possession cannot create/recover a session; wrong action proof is refused',()=>{
 const {m,j}=setup();expect(m.start(j.context,'wrong')).toBeNull();expect(m.logout(j.context,'wrong')).toBe(false);expect(m.logout(j.context,m.proof(j.context)!)).toBe(false);expect(m.start(j.context,m.proof(j.context,'logout')!)).toBeNull();
 const attacker=new ModelJar();attacker.context=j.context;expect(m.inspect(attacker)).toEqual({kind:'signed-out'});expect(m.issue('invented',j.context,'A')).toEqual({});
});
it('refuses consumed replay, expired attempts/session/context and deleted context resurrection',()=>{
 const {m,j}=setup(),a=login(m,j,'A');expect(m.complete(a,j.context,'B')).toEqual({});const b=start(m,j);m.now=11;expect(m.complete(b,j.context,'B')).toEqual({});
 login(m,j,'A');m.now=112;expect(m.inspect(j)).toEqual({kind:'signed-out'});m.now=1001;expect(start(m,j)).toBeNull();
 const old=j.context;m.contexts.delete(old!);expect(m.start(old,'invented')).toBeNull();expect(m.contexts.has(old!)).toBe(false);
});
it('storage failure is unavailable, never a successful logout or identity recovery',()=>{
 const {m,j}=setup();login(m,j,'A');const proof=m.proof(j.context,'logout')!;m.available=false;expect(m.inspect(j)).toEqual({kind:'unavailable'});expect(m.logout(j.context,proof)).toBe(false);expect(m.commit(j)).toBe(false);
});
it('requires bootstrap acknowledgement: missing/unknown context cannot start or issue',()=>{
 const m=new SessionOrderModel();expect(m.start(undefined,'x')).toBeNull();expect(m.start('invented','x')).toBeNull();expect(m.complete('invented',undefined,'A')).toEqual({});expect(Object.keys(m.bootstrap())).toEqual(['context']);expect(m.sessions.size).toBe(0);expect(m.attempts.size).toBe(0);
});
it('a late never-used bootstrap signs out B rather than reviving an older identity',()=>{
 const m=new SessionOrderModel(),held=m.bootstrap(),j=new ModelJar();j.apply(m.bootstrap());login(m,j,'B');j.apply(held);expect(m.inspect(j)).toEqual({kind:'signed-out'});expect(m.contexts.get(j.context!)!.epoch).toBe(0);
});
it('shows why refreshing an established context cookie is forbidden',()=>{
 const {m,j}=setup();login(m,j,'A');const forbiddenRefresh:Headers={context:j.context,session:j.session};j.apply(m.bootstrap());login(m,j,'B');j.apply(forbiddenRefresh);
 expect(m.inspect(j)).toEqual({kind:'authenticated',actor:'A'}); // explicit counterexample, not a safety claim
});
function interleave(a:string[],b:string[]):string[][]{if(!a.length)return[b];if(!b.length)return[a];return [...interleave(a.slice(1),b).map(xs=>[a[0],...xs]),...interleave(a,b.slice(1)).map(xs=>[b[0],...xs])]}
it('enumerates 70 causal bootstrap/start/issue/header orderings without accepting an older issued identity',()=>{
 const schedules=interleave(['bootA','startA','issueA','applyA'],['bootB','startB','issueB','applyB']);expect(schedules).toHaveLength(70);
 for(const schedule of schedules){const m=new SessionOrderModel(),j=new ModelJar(),boots={A:m.bootstrap(),B:m.bootstrap()},attempts:Record<string,string>={},responses:Record<string,Headers>={};let latest:string|undefined;
  for(const event of schedule){const actor=event.at(-1)!;
   if(event.startsWith('boot'))j.apply(boots[actor as 'A'|'B']);
   if(event.startsWith('start'))attempts[actor]=start(m,j);
   if(event.startsWith('issue')){responses[actor]=m.complete(attempts[actor],j.context,actor);if(responses[actor].session)latest=actor}
   if(event.startsWith('apply'))j.apply(responses[actor]);
   const result=m.inspect(j);if(result.kind==='authenticated')expect(result.actor,schedule.join(',')).toBe(latest);
  }
 }
});
