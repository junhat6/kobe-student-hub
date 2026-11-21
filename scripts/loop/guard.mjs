#!/usr/bin/env node
// PreToolUse hook (Claude Code) for Bash.
// 自律ループで、並行するセッションの作業や release の関所を壊す git 操作だけを止める。
// 普段の commit / push / test は止めない。止めた操作には理由と正しい入口を返し、agent が自分で進路を直せるようにする。
//
// 本番の運用（Cloudflare への deploy・rollback・secret、リモート D1 の SQL・migration）は止めない。
// 2026-11-21 のオーナー決定で、agent が自分で判断して本番を進める方針になったため。
// 本番の安全は hook ではなく release の手順（CI 必須・migration 前の Time Travel ブックマーク・smoke と自動 rollback）で担う。

// git push の引数部分だけを取り出す（commit message などに出てくる語で誤検知しないため）
const pushes = (c) => [...c.matchAll(/\bgit\s+push\b([^;&|\n]*)/g)].map((m) => ` ${m[1]} `);
const anyPush = (c, re) => pushes(c).some((p) => re.test(p));

const RULES = [
  {
    id: 'force-push',
    test: (c) => anyPush(c, /\s(--force|--force-with-lease|-f)(\s|=)|\s\+[^\s]+/),
    reason:
      'force push は禁止です。main は全セッションで共有しているので、git pull --rebase してから通常の push をしてください。',
  },
  {
    id: 'push-release',
    test: (c) => anyPush(c, /(:|\s)(refs\/heads\/)?release\s/),
    reason:
      'release ブランチへは直接 push しません。npm run release で rc/* の CI を通してから昇格させてください（docs/RELEASE.md）。',
  },
  {
    id: 'delete-branch',
    test: (c) =>
      anyPush(c, /\s(--delete|-d)\s+.*\b(main|release)\b|\s:(refs\/heads\/)?(main|release)\s/),
    reason: 'main / release ブランチの削除は禁止です。',
  },
  {
    id: 'bare-stash',
    test: (c) => /\bgit\s+stash(\s+(pop|drop|clear))?\s*($|;|&&|\|)/.test(c),
    reason:
      'stash は全 worktree で共有されるため、素の git stash / pop / drop / clear は禁止です。WIP commit を使うか、git stash push -u -m <tag> で積んで SHA を指定して apply してください。',
  },
  {
    id: 'ruleset-edit',
    test: (c) =>
      // 担当（loop-infra）が意図して変えるときは、コマンド先頭に KSH_LOOP_INFRA=1 を付けて明示する
      !/^\s*KSH_LOOP_INFRA=1\s/.test(c) &&
      /\bgh\s+api\b/.test(c) &&
      /(rulesets|branches\/[^/\s]+\/protection)/.test(c) &&
      /(-X|--method)\s*(PUT|PATCH|DELETE|POST)/i.test(c),
    reason:
      'ruleset / branch protection の変更は loop-infra の担当です。変更が必要なら docs/RELEASE.md の担当者に依頼してください。',
  },
];

export function classify(command) {
  const c = ` ${String(command ?? '')} `;
  for (const rule of RULES) if (rule.test(c)) return { id: rule.id, reason: rule.reason };
  return null;
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try {
    input = JSON.parse(raw || '{}');
  } catch {
    return; // 入力が読めないときは止めない（hook の不具合で作業全体を止めない）
  }
  if (input.tool_name !== 'Bash') return;
  if (process.env.KSH_LOOP_GUARD === 'off') return;
  const hit = classify(input.tool_input?.command);
  if (!hit) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `[loop-guard:${hit.id}] ${hit.reason}`,
      },
    }),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
