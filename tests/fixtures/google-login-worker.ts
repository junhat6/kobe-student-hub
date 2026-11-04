import {GoogleLoginBroker} from '../../worker/auth/google-login';
// Private test harness only; never import this fixture into the application.
export default {async fetch(request:Request,env:{DB:D1Database}){
 const i=await request.json() as {action:string;now:number;url:string;method?:string;headers?:Record<string,string>;key:number[];clientSecret?:string|null};
 const broker=new GoogleLoginBroker(env.DB,{origin:'https://app.example.invalid',clientId:'fixture-web-client.apps.googleusercontent.com',cookieKey:new Uint8Array(i.key),clientSecret:i.clientSecret as string},()=>i.now);
 const target=new Request(i.url,{method:i.method??'GET',headers:i.headers});
 return Response.json(i.action==='start'?await broker.start(target):await broker.callback(target));
}};
