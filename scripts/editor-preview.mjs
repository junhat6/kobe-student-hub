import { spawnSync, spawn } from 'node:child_process';
const config = 'wrangler.editor.jsonc';
// All commands are local and use an isolated fictitious database. Never deploy this fixture.
const run = (args) => {
  const result = spawnSync('npx', ['wrangler', ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
for (const file of [
  'migrations/0001_discovery.sql',
  'migrations/0004_private_sessions.sql',
  'migrations/0005_private_article_drafts.sql',
  'migrations/0006_article_reports.sql',
  'migrations/0007_article_publications.sql',
  'migrations/0008_article_likes.sql',
  'migrations/0009_standalone_projects.sql',
  'migrations/0010_project_reports.sql',
  'migrations/0011_publication_stops.sql',
  'migrations/0016_self_declared_enrollment.sql',
  'migrations/0018_article_moderation_decisions.sql',
]) {
  // Initialization is idempotent: check the specific local table before applying its schema.
  const table = file.includes('0018')
    ? 'article_moderation_state'
    : file.includes('0011')
      ? 'article_publication_stops'
      : file.includes('0016')
        ? 'private_enrollment_periods'
        : file.includes('0001')
          ? 'public_profiles'
          : file.includes('0004')
            ? 'private_accounts'
            : file.includes('0005')
              ? 'private_article_drafts'
              : file.includes('0006')
                ? 'article_reports'
                : file.includes('0010')
                  ? 'project_reports'
                  : file.includes('0009')
                    ? 'project_drafts'
                    : file.includes('0008')
                      ? 'article_likes'
                      : 'account_public_profiles';
  const check = spawnSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'kobe-editor-fixture',
      '--config',
      config,
      '--local',
      '--persist-to',
      '.wrangler/editor-state',
      '--command',
      `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`,
      '--json',
    ],
    { encoding: 'utf8' },
  );
  if (check.status !== 0) {
    process.stderr.write(check.stderr);
    process.exit(check.status ?? 1);
  }
  if (!JSON.parse(check.stdout).some((x) => x.results?.some((row) => row.name === table)))
    run([
      'd1',
      'execute',
      'kobe-editor-fixture',
      '--config',
      config,
      '--local',
      '--persist-to',
      '.wrangler/editor-state',
      '--file',
      file,
    ]);
}
// Apply every IF NOT EXISTS stop table/guard on each LOCAL startup, including partial initialization.
run([
  'd1',
  'execute',
  'kobe-editor-fixture',
  '--config',
  config,
  '--local',
  '--persist-to',
  '.wrangler/editor-state',
  '--file',
  'migrations/0011_publication_stops.sql',
]);
run([
  'd1',
  'execute',
  'kobe-editor-fixture',
  '--config',
  config,
  '--local',
  '--persist-to',
  '.wrangler/editor-state',
  '--command',
  "INSERT OR IGNORE INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES('editor-a','editor-fictional-a','editor-a@st.kobedenshi.ac.jp','active',0),('editor-b','editor-fictional-b','editor-b@st.kobedenshi.ac.jp','active',0),('editor-operator','editor-fictional-operator','editor-operator@st.kobedenshi.ac.jp','active',0)",
]);
const child = spawn(
  'npx',
  [
    'wrangler',
    'dev',
    '--config',
    config,
    '--local',
    '--local-protocol',
    'https',
    '--ip',
    '127.0.0.1',
    '--port',
    '8788',
    '--persist-to',
    '.wrangler/editor-state',
  ],
  { stdio: 'inherit' },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));
