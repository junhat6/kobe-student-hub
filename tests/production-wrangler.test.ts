import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error plain ESM script without type declarations
import { loadProductionInputs, productionConfig } from '../scripts/production-wrangler.mjs';

// 架空の値。実 ID はリポジトリに置かない（~/.config/kobe-student-hub/production.json か CI の secret）
const env = {
  KSH_PRODUCTION_INPUT: '/nonexistent/ksh-production.json',
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  KSH_PROD_D1_DATABASE_ID: '11111111-2222-3333-4444-555555555555',
  KSH_PROD_GOOGLE_CLIENT_ID: '123-abc.apps.googleusercontent.com',
  KSH_PROD_MODERATION_EMAIL_TO: 'operator@example.com',
};

describe('production wrangler config', () => {
  it('builds the production Worker shape from private inputs', () => {
    const c = productionConfig(loadProductionInputs(env), '/repo');
    expect(c.name).toBe('kobe-student-hub-production');
    expect(c.routes).toEqual([{ pattern: 'hub.junhat6.com', custom_domain: true }]);
    expect(c.triggers.crons).toEqual(['*/15 * * * *']);
    expect(c.limits.cpu_ms).toBe(1000);
    expect(c.d1_databases[0]).toMatchObject({
      binding: 'DB',
      database_name: 'kobe-student-hub-production',
      database_id: env.KSH_PROD_D1_DATABASE_ID,
      migrations_dir: '/repo/migrations',
    });
    expect(c.vars).toEqual({
      AUTH_ORIGIN: 'https://hub.junhat6.com',
      GOOGLE_CLIENT_ID: env.KSH_PROD_GOOGLE_CLIENT_ID,
    });
    expect(c.send_email[0].destination_address).toBe(env.KSH_PROD_MODERATION_EMAIL_TO);
  });

  it('never carries secret values in vars', () => {
    const c = productionConfig(loadProductionInputs(env), '/repo');
    for (const name of [
      'GOOGLE_CLIENT_SECRET',
      'OAUTH_COOKIE_KEY',
      'MODERATION_OPERATOR_ACCOUNT_IDS',
    ])
      expect(Object.keys(c.vars)).not.toContain(name);
  });

  it('keeps the asset routing identical to the local template', () => {
    const template = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
    const c = productionConfig(loadProductionInputs(env), '/repo');
    expect(c.assets.run_worker_first).toEqual(template.assets.run_worker_first);
    expect(c.compatibility_date).toBe(template.compatibility_date);
    expect(c.compatibility_flags).toEqual(template.compatibility_flags);
  });

  it.each([
    ['KSH_PROD_D1_DATABASE_ID', '00000000-0000-0000-0000-000000000000'],
    ['CLOUDFLARE_ACCOUNT_ID', ''],
    ['KSH_PROD_GOOGLE_CLIENT_ID', 'not-a-client'],
    ['KSH_PROD_MODERATION_EMAIL_TO', ''],
  ])('refuses a missing or placeholder %s', (key, value) => {
    expect(() => loadProductionInputs({ ...env, [key]: value })).toThrow(key);
  });
});
