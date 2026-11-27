#!/usr/bin/env node
// 本番 Worker（kobe-student-hub-production）の wrangler 設定を組み立てる。
//
// 公開してよい形（Worker 名・独自ドメイン・cron・assets・observability・送信元アドレス）はここに書く。
// リポジトリに置かない値（account / D1 の ID、Google client ID、通報メールの宛先）だけを外から受け取る。
//   1. 環境変数（GitHub Actions は environment `production` の secrets から渡す）
//   2. 無ければ手元の非公開ファイル ~/.config/kobe-student-hub/production.json（mode 0600。KSH_PRODUCTION_INPUT で変更可）
// worktree の中（.wrangler/ や /tmp）に正本を置かないのは、以前それで設定が消えたため（#166）。
//
// secret（GOOGLE_CLIENT_SECRET など）は Cloudflare 側に保存済みで、wrangler deploy は既存の secret を引き継ぐ。
// ここでは secret の値を扱わない。
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const WORKER_NAME = 'kobe-student-hub-production';
export const DATABASE_NAME = 'kobe-student-hub-production';
// 画像の保存先（#12）。private bucket（r2.dev・独自ドメインなし）。読み出しの可否は毎回 D1 で判定する。
export const MEDIA_BUCKET_NAME = 'kobe-student-hub-media';
export const ORIGIN = 'https://hub.junhat6.com';
export const USAGE_DATASET = 'ksh_usage';
export const DEFAULT_INPUT_PATH = join(homedir(), '.config/kobe-student-hub/production.json');

// 環境変数名 ↔ 非公開ファイルのキー
const INPUTS = {
  accountId: 'CLOUDFLARE_ACCOUNT_ID',
  databaseId: 'KSH_PROD_D1_DATABASE_ID',
  googleClientId: 'KSH_PROD_GOOGLE_CLIENT_ID',
  moderationEmailTo: 'KSH_PROD_MODERATION_EMAIL_TO',
};
const VALID = {
  accountId: (v) => /^[a-f0-9]{32}$/.test(v),
  databaseId: (v) =>
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v) &&
    v !== '00000000-0000-0000-0000-000000000000',
  googleClientId: (v) => /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(v),
  moderationEmailTo: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
};

export function loadProductionInputs(env = process.env) {
  const path = env.KSH_PRODUCTION_INPUT || DEFAULT_INPUT_PATH;
  let file = {};
  if (existsSync(path)) {
    if ((statSync(path).mode & 0o077) !== 0)
      throw Error(`${path} は他人が読めます。chmod 600 にしてください。`);
    file = JSON.parse(readFileSync(path, 'utf8'));
  }
  const out = {};
  const missing = [];
  for (const [key, envName] of Object.entries(INPUTS)) {
    const v = String(env[envName] || file[key] || '').trim();
    if (!VALID[key](v)) missing.push(`${envName}（${key}）`);
    out[key] = v;
  }
  if (missing.length)
    throw Error(
      `本番設定の入力が足りないか形式が違います: ${missing.join(', ')}。環境変数か ${path} に置いてください（docs/RELEASE.md「本番の設定」）。`,
    );
  return out;
}

/** 本番の wrangler 設定（JSON）。root はリポジトリ（build 済みの worktree）のパス。 */
export function productionConfig(inputs, root = process.cwd()) {
  const r = (p) => resolve(root, p);
  return {
    $schema: r('node_modules/wrangler/config-schema.json'),
    name: WORKER_NAME,
    account_id: inputs.accountId,
    main: r('worker/index.ts'),
    compatibility_date: '2026-11-03',
    compatibility_flags: ['nodejs_compat'],
    // workers.dev は現状どおり有効（障害時に独自ドメインを切り分けるため）。preview URL は出さない。
    workers_dev: true,
    preview_urls: false,
    routes: [{ pattern: 'hub.junhat6.com', custom_domain: true }],
    triggers: { crons: ['*/15 * * * *'] },
    // 画像の正規化は Free の 10ms を超える（PR #119）。Paid で 1 リクエスト 1 秒に制限する。
    // Free のままだとこの設定で deploy が拒否されるので、Paid 加入前に誤って通常投稿を開くことがない。
    limits: { cpu_ms: 1000 },
    assets: {
      directory: r('dist'),
      binding: 'ASSETS',
      not_found_handling: 'single-page-application',
      run_worker_first: [
        '/api/*',
        '/mcp',
        '/trial-assets',
        '/trial-assets/*',
        '/.well-known/oauth-protected-resource',
        '/.well-known/oauth-protected-resource/*',
        '/.well-known/oauth-authorization-server',
        // G03：検索エンジンに載せてよいページだけ worker が判定する（worker/indexable-pages.ts）。
        '/',
        '/works',
        '/articles/*',
        '/projects/*',
      ],
    },
    d1_databases: [
      {
        binding: 'DB',
        database_name: DATABASE_NAME,
        database_id: inputs.databaseId,
        migrations_dir: r('migrations'),
      },
    ],
    // R2 の権限が無い deploy 用 token でも binding 付きで deploy できることを確かめてある（2026-11-22）。
    r2_buckets: [{ binding: 'MEDIA_BUCKET', bucket_name: MEDIA_BUCKET_NAME }],
    // 使われ方の計測（docs/loop/GROWTH.md「計測」）。dataset は最初の書き込みで作られる。
    analytics_engine_datasets: [{ binding: 'USAGE', dataset: USAGE_DATASET }],
    vars: {
      AUTH_ORIGIN: ORIGIN,
      GOOGLE_CLIENT_ID: inputs.googleClientId,
    },
    send_email: [
      {
        name: 'MODERATION_EMAIL',
        destination_address: inputs.moderationEmailTo,
        allowed_sender_addresses: ['notifications@notify.hub.junhat6.com'],
      },
    ],
    observability: {
      enabled: true,
      head_sampling_rate: 0.1,
      redact_query_string: true,
      logs: { enabled: true, head_sampling_rate: 0.1, persist: true, invocation_logs: true },
    },
    // GOOGLE_CLIENT_SECRET / OAUTH_COOKIE_KEY / MODERATION_EMAIL_FROM / MODERATION_EMAIL_TO /
    // MODERATION_OPERATOR_ACCOUNT_IDS / PUBLIC_CONTACT_URL は Cloudflare 上の secret（deploy で引き継がれる）。
  };
}

/** .wrangler/production.deploy.json（gitignore 済み・0600）に書き出してパスを返す。 */
export function writeProductionConfig(root = process.cwd(), env = process.env) {
  const config = productionConfig(loadProductionInputs(env), root);
  const dir = resolve(root, '.wrangler');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, 'production.deploy.json');
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    console.log(writeProductionConfig(process.argv[2] || process.cwd()));
  } catch (e) {
    console.error(`[production-wrangler] ${e.message}`);
    process.exit(3);
  }
}
