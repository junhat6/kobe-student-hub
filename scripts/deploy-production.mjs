#!/usr/bin/env node
// 本番 deploy の唯一の手順。手元（npm run release -- --deploy）と GitHub Actions（release.yml）の両方がこれを呼ぶ。
//
//   node scripts/deploy-production.mjs --root <build済みの checkout> --sha <sha> [--skip-migrations]
//
//   1. 本番の wrangler 設定を生成する（scripts/production-wrangler.mjs）
//   2. preflight: `wrangler versions upload` で、トラフィックを切り替えずに設定と bundle を Cloudflare に検証させる
//   3. 未適用の D1 migration があれば、適用前の Time Travel ブックマークを記録してから適用する
//   4. `wrangler deploy` で切り替える（cron・独自ドメインも設定どおりに揃う）
//   5. 本番 smoke。失敗したら Worker を直前の版へ rollback する（D1 は自動では戻さない）
//
// 結果は最後に `[deploy] result {json}` の 1 行で出す（KSH_DEPLOY_RESULT があればそのファイルにも書く）。
// scripts/release.mjs がこれを読んでリリース記録に載せる。json には自前の 1 行メッセージだけを入れ、
// wrangler の生の出力は入れない（公開の記録に ID などが漏れないように）。
//
// 終了コード: 0 成功 / 2 smoke 失敗で rollback 済み / 3 設定の入力が無い / 4 D1 に届かない / 1 その他の失敗
//
// D1 を自動で戻さない理由: Time Travel の restore はブックマーク以降の書き込み（利用者の投稿など）も消す。
// migration は expand → contract で「1つ前の Worker でも動く」形にする決まりなので、Worker の rollback だけで復旧できる。
// D1 の restore が必要かどうかは、ログに残したブックマークを使って agent が個別に判断する（docs/RELEASE.md）。
import { spawnSync } from 'node:child_process';
import { appendFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { smoke } from './loop/smoke.mjs';
import { ORIGIN, writeProductionConfig } from './production-wrangler.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const root = resolve(opt('--root') || process.cwd());
const sha = opt('--sha') || '';
const short = sha.slice(0, 7) || 'local';
const skipMigrations = args.includes('--skip-migrations');
const origin = process.env.KSH_PRODUCTION_ORIGIN || ORIGIN;

const log = (m) => console.log(`[deploy] ${m}`);
const summary = (m) => {
  log(m);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${m}\n`);
};
const result = { migrations: [], bookmark: '', smoke: undefined };
const finish = (code, message) => {
  const line = JSON.stringify({ code, message: message.split('\n')[0].slice(0, 300), ...result });
  console.log(`[deploy] result ${line}`);
  if (process.env.KSH_DEPLOY_RESULT) writeFileSync(process.env.KSH_DEPLOY_RESULT, line);
  process.exit(code);
};
const die = (m, code = 1) => {
  summary(`中止: ${m}`);
  finish(code, m);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let config;
try {
  config = writeProductionConfig(root);
} catch (e) {
  die(e.message, 3);
}

const env = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' };
function wrangler(a, { capture = false } = {}) {
  const r = spawnSync('npx', ['wrangler', ...a, '--config', config], {
    cwd: root,
    env,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? '' };
}
const jsonOut = (s) => {
  const i = s.search(/[[{]/);
  return JSON.parse(s.slice(i));
};

// 2. preflight（本番トラフィックは切り替わらない）
log(`preflight: ${short} を版として upload して検証します（まだ切り替えません）`);
if (!wrangler(['versions', 'upload', '--message', `release ${short} preflight`]).ok)
  die('preflight の versions upload が失敗しました。本番は変わっていません。');

// 3. D1 migration
if (skipMigrations)
  log(
    'D1 migration は確認しません（--skip-migrations。適用済みであることを呼び出し側が確かめた前提）',
  );
else {
  const applied = wrangler(
    ['d1', 'execute', 'DB', '--remote', '--json', '--command', 'SELECT name FROM d1_migrations'],
    { capture: true },
  );
  if (!applied.ok)
    die(
      `本番 D1 に届きません（認証・権限）。本番は変わっていません。CI では token に D1 Edit が要ります。手元の wrangler OAuth は D1 に使えないため、agent は Cloudflare MCP で migration を適用してから --skip-migrations で再実行します。\n${applied.err.slice(-600)}`,
      4,
    );
  const done = new Set(jsonOut(applied.out)[0].results.map((r) => r.name));
  const pending = readdirSync(resolve(root, 'migrations'))
    .filter((f) => f.endsWith('.sql') && !done.has(f))
    .sort();
  if (!pending.length) log('未適用の D1 migration はありません');
  else {
    const tt = wrangler(['d1', 'time-travel', 'info', 'DB', '--json'], { capture: true });
    const bookmark = tt.ok ? jsonOut(tt.out).bookmark : '';
    result.bookmark = bookmark;
    if (!bookmark)
      die(`Time Travel のブックマークを取れないので migration を適用しません。\n${tt.err}`);
    summary(`D1 migration 適用前のブックマーク: \`${bookmark}\`（適用: ${pending.join(', ')}）`);
    if (!wrangler(['d1', 'migrations', 'apply', 'DB', '--remote']).ok)
      die(
        `migration の適用に失敗しました。Worker は切り替えていません。D1 の状態を確かめ、必要ならブックマーク ${bookmark} へ restore するかを判断してください。`,
      );
    result.migrations = pending;
    summary(`D1 migration を適用しました: ${pending.join(', ')}`);
  }
}

// 4. deploy
const before = await smoke(origin);
if (!before.ok) log(`deploy 前の本番 smoke が既に失敗しています: ${before.failures.join(', ')}`);
if (!wrangler(['deploy', '--message', `release ${short}`]).ok)
  die('wrangler deploy が失敗しました。直前の版が動いたままです。');

// 5. smoke → 失敗なら rollback
let after = { ok: false, failures: ['not-run'] };
for (let i = 0; i < 3 && !after.ok; i++) {
  await sleep(5_000 * (i + 1));
  after = await smoke(origin);
}
result.smoke = { ok: after.ok, failures: after.failures };
if (after.ok) {
  summary(`本番 deploy 成功: ${short} → ${origin}（smoke OK）`);
  finish(0, 'deploy 成功（smoke OK）');
}
summary(`本番 smoke 失敗: ${after.failures.join(', ')}。直前の版へ rollback します。`);
const rolledBack = wrangler(['rollback', '--message', `smoke failed for ${short}`, '--yes']).ok;
const back = await smoke(origin);
if (!rolledBack)
  die(
    `wrangler rollback が失敗しました。本番は ${short} のままの可能性があります（smoke: ${back.ok ? '成功' : back.failures.join(', ')}）。wrangler deployments list で確かめ、手で戻してください。`,
  );
die(
  `rollback しました（rollback 後の smoke: ${back.ok ? '成功' : back.failures.join(', ')}）。release ブランチは ${short} のままなので、main で直して次の列車に乗せてください。`,
  2,
);
