import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without type declarations
import { classify } from '../scripts/loop/guard.mjs';

const id = (c: string) => classify(c)?.id ?? null;

describe('loop guard (PreToolUse hook)', () => {
  it.each([
    ['git push --force origin main', 'force-push'],
    ['git push -f', 'force-push'],
    ['git push --force-with-lease origin HEAD:main', 'force-push'],
    ['git push origin +HEAD:main', 'force-push'],
    ['git push origin abc123:release', 'push-release'],
    ['git push origin HEAD:refs/heads/release', 'push-release'],
    ['git push origin release', 'push-release'],
    ['git push origin --delete main', 'delete-branch'],
    ['npx wrangler deploy --config x.json', 'wrangler-deploy'],
    ['wrangler rollback --yes', 'wrangler-deploy'],
    ['npx wrangler secret put FOO', 'wrangler-deploy'],
    ['npx wrangler d1 execute db --remote --command "select 1"', 'remote-d1'],
    ['npx wrangler d1 migrations apply db --remote', 'remote-d1'],
    ['git stash', 'bare-stash'],
    ['git stash pop', 'bare-stash'],
    ['git stash && git pull', 'bare-stash'],
    ['gh api -X PUT repos/o/r/rulesets/1', 'ruleset-edit'],
  ])('blocks %s', (cmd, rule) => expect(id(cmd)).toBe(rule));

  it.each([
    'git push origin HEAD:main',
    'git pull --rebase origin main && git push',
    'git push origin feat/release-notes',
    'npm run release -- --deploy',
    'npx wrangler deploy --dry-run',
    'npm run deploy:check',
    'npx wrangler d1 migrations apply kobe-student-hub-preview --local',
    'git stash push -u -m loop-wip-1',
    'git stash apply 3f2a1b',
    'gh api repos/o/r/rulesets',
    'git log --oneline release..main',
    "git commit -m 'add release train' && git push origin HEAD:main",
    'git commit -m "feat: release notes -f flag" && git push',
    'KSH_LOOP_INFRA=1 gh api -X PUT repos/o/r/rulesets/1',
  ])('allows %s', (cmd) => expect(id(cmd)).toBeNull());
});
