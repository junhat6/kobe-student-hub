import {createLimitedDraftHandler} from './limited-draft-http';
import {createTrialAssetHandler} from './limited-draft-trial-entry';
import type {SessionRestriction} from './auth/session-guard';
import {pendingPilotPage} from './auth/pending-pilot-ui';
import {createOAuthHttpHandler,type OAuthBindings} from './auth/oauth-http';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { Catalog, Entry, Profile } from '../src/types';
// General login stays closed; separate opt-in routes below allow a pending receipt or restricted private drafts.
const OAUTH_HTTP_RELEASE_ENABLED=false;
const app = new Hono<{ Bindings: Env }>();
app.use('*', secureHeaders({ contentSecurityPolicy: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] }, referrerPolicy:'no-referrer' }));
app.use('/api/*', async (c,next) => { c.header('Cache-Control','no-store'); c.header('X-Robots-Tag','noindex, nofollow'); await next(); });
// Explicit private server setting; invalid or absent settings never activate the trial.
type TrialEnv=Env&OAuthBindings&{OAUTH_DRAFT_TRIAL?:string};
function trialRestriction(env:TrialEnv):SessionRestriction|null{try{if(typeof env.OAUTH_DRAFT_TRIAL!=='string'||env.OAUTH_DRAFT_TRIAL.length>1024)return null;return JSON.parse(env.OAUTH_DRAFT_TRIAL) as SessionRestriction}catch{return null}}
const trialPaths=new Set(['/api/auth/bootstrap','/api/auth/command','/api/auth/start','/api/auth/callback','/api/private/session','/api/private/logout','/api/private/logout-command']);
app.use('*',async(c,next)=>{
 const env=c.env as TrialEnv,path=new URL(c.req.url).pathname,reader=()=>trialRestriction(env);
 const assets={fetch:(r:Request)=>{const u=new URL(r.url);u.pathname='/trial-assets'+u.pathname;return env.ASSETS.fetch(new Request(u,r))}} as Fetcher;
 const page=await createTrialAssetHandler(assets,env,reader)(c.req.raw);if(page)return page;
 if(typeof env.OAUTH_DRAFT_TRIAL==='string'&&(trialPaths.has(path)||path==='/api/private/drafts'||path.startsWith('/api/private/drafts/'))){return createLimitedDraftHandler(env.DB,env,reader)(c.req.raw)}
 await next();
});
app.get('/api/auth/pilot',c=>pendingPilotPage(c.req.raw,c.env as Env&OAuthBindings)??c.notFound());
app.get('/api/auth/pilot.js',c=>pendingPilotPage(c.req.raw,c.env as Env&OAuthBindings)??c.notFound());
app.use('/api/*',async(c,next)=>{{const response=await createOAuthHttpHandler(c.env.DB,c.env as Env&OAuthBindings,{enabled:OAUTH_HTTP_RELEASE_ENABLED,pendingPilot:!OAUTH_HTTP_RELEASE_ENABLED})(c.req.raw);if(response)return response}await next()});
app.get('/api/health', c => c.json({status:'ok',stage:'development-preview',writesEnabled:false}));
app.get('/api/catalog', async c => {
  // Explicit public projection: no identity, emails, drafts, history, or report data.
  const rows = await c.env.DB.prepare("SELECT id, kind, title, summary, body, tags_json, author_id, audience, prerequisite, outcome, updated_at, minutes, related_ids_json FROM content WHERE status = 'published' AND is_sample = 1 ORDER BY updated_at DESC LIMIT 100").all<ContentRow>();
  const authors = await c.env.DB.prepare("SELECT id, display_name, department, year_label, bio, initials FROM public_profiles WHERE is_sample = 1 AND id IN (SELECT author_id FROM content WHERE status = 'published' AND is_sample = 1)").all<ProfileRow>();
  const entries:Entry[] = rows.results.map(r => ({id:r.id,kind:r.kind,title:r.title,summary:r.summary,body:r.body,tags:JSON.parse(r.tags_json),authorId:r.author_id,audience:r.audience,prerequisite:r.prerequisite,outcome:r.outcome,updatedAt:r.updated_at,minutes:r.minutes,relatedIds:JSON.parse(r.related_ids_json)}));
  const profiles:Profile[] = authors.results.map(r => ({id:r.id,name:r.display_name,department:r.department,year:r.year_label,bio:r.bio,initials:r.initials}));
  return c.json({mode:'sample',entries,profiles} satisfies Catalog);
});
// Other user writes and publication stay closed; restricted private drafts are handled above.
app.all('/api/*', c => c.json({error:'この開発プレビューではログイン・投稿機能をまだ提供していません。'},405));
app.onError((_err,c) => c.json({error:'読み込みに失敗しました。時間をおいて再度お試しください。'},503));
interface ContentRow {id:string;kind:'article'|'project';title:string;summary:string;body:string;tags_json:string;author_id:string;audience:string;prerequisite:string;outcome:string;updated_at:string;minutes:number;related_ids_json:string;}
interface ProfileRow {id:string;display_name:string;department:string;year_label:string;bio:string;initials:string;}
export default app;
