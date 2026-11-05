import {createFixtureSession} from '../helpers/coordinated-fixture';
import {SessionStore} from '../../worker/auth/sessions';
import {mayReadPrivateRecord} from '../../worker/auth/private-access';
import type {VerifiedSchoolIdentity} from '../../worker/auth/google-identity';
export default {async fetch(request:Request,env:{DB:D1Database}){
 const input=await request.json() as {action:string;now:number;url:string;method?:string;headers?:Record<string,string>;identity:VerifiedSchoolIdentity;owner:string;origin?:string};
 const store=new SessionStore(env.DB,input.origin??'https://app.example.invalid',()=>input.now);const req=new Request(input.url??'https://app.example.invalid/private',{method:input.method??'GET',headers:input.headers});
 const result=input.action==='create'?await createFixtureSession(env.DB,input.origin??'https://app.example.invalid',()=>input.now,input.identity):input.action==='mutation'?await store.authorizeMutation(req):input.action==='logout'?await store.logout(req):input.action==='cleanup'?await store.cleanupExpired():await store.authenticate(req);
 return Response.json(input.action==='owner'?mayReadPrivateRecord((result as {actor?:any}|null)?.actor,input.owner):result);
}};
