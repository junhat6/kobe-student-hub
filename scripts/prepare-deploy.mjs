import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

try {
  const env = process.env;
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  const database = env.CLOUDFLARE_D1_DATABASE_ID;
  if (!account || !/^[a-f0-9]{32}$/.test(account) || account !== env.CLOUDFLARE_EXPECTED_ACCOUNT_ID) {
    throw new Error('Selected and expected account settings must match.');
  }
  if (!database || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(database)
      || database === '00000000-0000-0000-0000-000000000000' || database !== env.CLOUDFLARE_EXPECTED_D1_DATABASE_ID) {
    throw new Error('Selected and expected D1 settings must match a real configured resource.');
  }
  if (env.CI && process.argv.includes('--for-deploy') && !env.CLOUDFLARE_API_TOKEN) {
    throw new Error('CI deployment requires an already authorized credential; no login/grant will be started.');
  }
  const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
  if (config.name !== 'kobe-student-hub-preview' || config.main !== 'worker/index.ts'
      || config.d1_databases?.length !== 1 || config.d1_databases[0].binding !== 'DB'
      || config.d1_databases[0].database_name !== 'kobe-student-hub-preview'
      || config.assets?.directory !== './dist' || config.assets.binding !== 'ASSETS'
      || config.d1_databases[0].migrations_dir !== 'migrations') {
    throw new Error('Unexpected preview target or binding configuration.');
  }
  config.account_id = account;
  config.$schema = resolve('node_modules/wrangler/config-schema.json');
  config.main = resolve(config.main);
  config.assets.directory = resolve(config.assets.directory);
  config.workers_dev = true;
  config.preview_urls = false;
  config.d1_databases[0].database_id = database;
  config.d1_databases[0].migrations_dir = resolve(config.d1_databases[0].migrations_dir || 'migrations');
  mkdirSync('.wrangler', { recursive: true });
  writeFileSync('.wrangler/preview.deploy.json', JSON.stringify(config, null, 2)+'\n', { mode: 0o600 });
  console.log('Prepared ignored preview configuration. No resource or credential was created.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Preview configuration failed.');
  process.exitCode = 1;
}
