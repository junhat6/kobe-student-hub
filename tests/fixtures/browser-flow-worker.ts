import {BrowserOAuthFlow} from '../../worker/auth/browser-flow';
export default {async fetch(request:Request,env:{DB:D1Database}){
 const input=await request.json() as {action:string;now:number;times?:number[];url:string;method?:string;headers?:Record<string,string>;key:number[];origin?:string;clientId?:string};
 const times=input.times?.slice();
 const flow=new BrowserOAuthFlow(env.DB,{origin:input.origin??'https://app.example.invalid',clientId:input.clientId??'fixture.apps.googleusercontent.com',cookieKey:new Uint8Array(input.key)},()=>times?.length?times.shift()!:input.now);
 const target=new Request(input.url,{method:input.method??'GET',headers:input.headers});
 return Response.json(input.action==='start'?await flow.start(target):await flow.claim(target));
}};
