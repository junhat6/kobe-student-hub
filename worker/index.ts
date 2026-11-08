import { pendingPilotPage } from './auth/pending-pilot-ui';
import { createOrdinaryDraftHandler } from './ordinary-drafts-http';
import {
  dispatchModerationEmails,
  moderationEmailOptions,
  type ModerationEmailBindings,
} from './moderation-email';
import { warmMediaCodec } from './media';
import { createEnrollmentHandler } from './enrollment-http';
import { parseModerationOperators, type ModerationBindings } from './moderation-http';
import { createOAuthHttpHandler, type OAuthBindings } from './auth/oauth-http';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { Catalog, Entry, Profile } from '../src/types';
import { publicServiceInfo, type ServiceInfoBindings } from './service-info';
// General login remains closed; the explicit private pilot permits pending receipt only.
const OAUTH_HTTP_RELEASE_ENABLED = false;
const ORDINARY_DRAFT_HTTP_RELEASE_ENABLED = false;
// Pure module/codec setup belongs to isolate startup, not the first image request.
if (OAUTH_HTTP_RELEASE_ENABLED && ORDINARY_DRAFT_HTTP_RELEASE_ENABLED) await warmMediaCodec();
const app = new Hono<{ Bindings: Env }>();
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      frameSrc: ['https://www.youtube-nocookie.com'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
    },
    referrerPolicy: 'no-referrer',
  }),
);
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  await next();
});
// Retired paths must reach the Worker before the static SPA fallback, even if stale files remain.
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (
    path === '/api/auth/draft-trial' ||
    path.startsWith('/api/auth/draft-trial/') ||
    path === '/trial-assets' ||
    path.startsWith('/trial-assets/')
  )
    return c.text('Not found', 404, {
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
    });
  await next();
});
app.get(
  '/api/auth/pilot',
  (c) => pendingPilotPage(c.req.raw, c.env as Env & OAuthBindings) ?? c.notFound(),
);
app.get(
  '/api/auth/pilot.js',
  (c) => pendingPilotPage(c.req.raw, c.env as Env & OAuthBindings) ?? c.notFound(),
);
app.use('/api/*', async (c, next) => {
  {
    const response = await createOAuthHttpHandler(c.env.DB, c.env as Env & OAuthBindings, {
      enabled: OAUTH_HTTP_RELEASE_ENABLED,
      pendingPilot: !OAUTH_HTTP_RELEASE_ENABLED,
      authorizationJson: true,
      accountLanding: true,
    })(c.req.raw);
    if (response) return response;
  }
  if (OAUTH_HTTP_RELEASE_ENABLED) {
    const origin = (c.env as Env & OAuthBindings).AUTH_ORIGIN ?? '';
    const response = await createEnrollmentHandler(c.env.DB, origin)(c.req.raw);
    if (response) return response;
    const authoring = await createOrdinaryDraftHandler(c.env.DB, origin, {
      enabled: ORDINARY_DRAFT_HTTP_RELEASE_ENABLED,
      operatorIds: parseModerationOperators(c.env as Env & ModerationBindings),
    })(c.req.raw);
    if (authoring) return authoring;
  }
  await next();
});
app.get('/api/service-info', (c) => c.json(publicServiceInfo(c.env as Env & ServiceInfoBindings)));
app.get('/api/health', (c) =>
  c.json({
    status: 'ok',
    stage: 'development-preview',
    writesEnabled: OAUTH_HTTP_RELEASE_ENABLED && ORDINARY_DRAFT_HTTP_RELEASE_ENABLED,
  }),
);
app.get('/api/catalog', async (c) => {
  // Explicit public projection: no identity, emails, drafts, history, or report data.
  const rows = await c.env.DB.prepare(
    "SELECT id, kind, title, summary, body, tags_json, author_id, audience, prerequisite, outcome, updated_at, minutes, related_ids_json FROM content WHERE status = 'published' AND is_sample = 1 ORDER BY updated_at DESC LIMIT 100",
  ).all<ContentRow>();
  const authors = await c.env.DB.prepare(
    "SELECT id, display_name, department, year_label, bio, initials FROM public_profiles WHERE is_sample = 1 AND id IN (SELECT author_id FROM content WHERE status = 'published' AND is_sample = 1)",
  ).all<ProfileRow>();
  const entries: Entry[] = rows.results.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    summary: r.summary,
    body: r.body,
    tags: JSON.parse(r.tags_json),
    authorId: r.author_id,
    audience: r.audience,
    prerequisite: r.prerequisite,
    outcome: r.outcome,
    updatedAt: r.updated_at,
    minutes: r.minutes,
    relatedIds: JSON.parse(r.related_ids_json),
  }));
  const profiles: Profile[] = authors.results.map((r) => ({
    id: r.id,
    name: r.display_name,
    department: r.department,
    year: r.year_label,
    bio: r.bio,
    initials: r.initials,
  }));
  return c.json({ mode: 'sample', entries, profiles } satisfies Catalog);
});
// No user-generated writes until authentication, privacy and moderation pass their gates.
app.all('/api/*', (c) =>
  c.json({ error: 'この開発プレビューではログイン・投稿機能をまだ提供していません。' }, 405),
);
app.onError((_err, c) =>
  c.json({ error: '読み込みに失敗しました。時間をおいて再度お試しください。' }, 503),
);
interface ContentRow {
  id: string;
  kind: 'article' | 'project';
  title: string;
  summary: string;
  body: string;
  tags_json: string;
  author_id: string;
  audience: string;
  prerequisite: string;
  outcome: string;
  updated_at: string;
  minutes: number;
  related_ids_json: string;
}
interface ProfileRow {
  id: string;
  display_name: string;
  department: string;
  year_label: string;
  bio: string;
  initials: string;
}
// Hono's onError handles Error instances; bindings can reject with any JavaScript value.
// Keep that value opaque, including cross-realm Errors, and never hand it to a logger.
export default {
  async scheduled(_event, env, ctx) {
    if (!OAUTH_HTTP_RELEASE_ENABLED || !ORDINARY_DRAFT_HTTP_RELEASE_ENABLED) return;
    if (!parseModerationOperators(env as Env & ModerationBindings).length) return;
    const options = moderationEmailOptions(
      env as Env & ModerationEmailBindings,
      (env as Env & OAuthBindings).AUTH_ORIGIN ?? '',
    );
    if (options) ctx.waitUntil(dispatchModerationEmails(env.DB, options));
  },
  async fetch(request: Request, env: Env, ctx?: ExecutionContext) {
    try {
      return await app.fetch(request, env, ctx);
    } catch {
      return new Response(
        JSON.stringify({ error: '読み込みに失敗しました。時間をおいて再度お試しください。' }),
        {
          status: 503,
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            'Cache-Control': 'private, no-store',
            Vary: 'Cookie',
            'Content-Security-Policy':
              "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-src https://www.youtube-nocookie.com; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
            'Cross-Origin-Resource-Policy': 'same-origin',
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Origin-Agent-Cluster': '?1',
            'Referrer-Policy': 'no-referrer',
            'Strict-Transport-Security': 'max-age=15552000; includeSubDomains',
            'X-Content-Type-Options': 'nosniff',
            'X-DNS-Prefetch-Control': 'off',
            'X-Download-Options': 'noopen',
            'X-Frame-Options': 'SAMEORIGIN',
            'X-Permitted-Cross-Domain-Policies': 'none',
            'X-XSS-Protection': '0',
            'X-Robots-Tag': 'noindex, nofollow',
          },
        },
      );
    }
  },
} satisfies ExportedHandler<Env>;
