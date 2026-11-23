/**
 * Fixed-rule, best-effort notice for secret-looking text in a draft (owner decision 2026-11-22).
 * Not exhaustive and not AI. It never blocks a save: the draft stays private and only the
 * student publishes after reading it. Findings carry a kind and a line number, never the text.
 * Shared by the MCP write tools (server) and the publication preparation screen (browser).
 */
export type SecretKind =
  'private_key' | 'api_key' | 'access_token' | 'email' | 'home_path' | 'env_secret';

export interface SecretFinding {
  kind: SecretKind;
  line: number;
}

export const SECRET_KIND_LABELS: Record<SecretKind, string> = {
  private_key: '秘密鍵',
  api_key: 'API キー',
  access_token: 'アクセストークン',
  email: 'メールアドレス',
  home_path: 'ユーザー名入りのパス',
  env_secret: '.env などの秘密の値',
};

// Every pattern is linear: no nested quantifiers, bounded repetition only.
const RULES: { kind: SecretKind; pattern: RegExp }[] = [
  {
    kind: 'private_key',
    pattern: /PRIVATE[\s_+-]{0,3}KEY|BEGIN[\s_+-]{0,3}OPENSSH|PuTTY-User-Key-File/i,
  },
  { kind: 'private_key', pattern: /BEGIN%20[A-Z%0-9]{0,40}PRIVATE/i },
  { kind: 'api_key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: 'api_key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: 'api_key', pattern: /\bsk-(?:ant-|proj-|live_|test_)?[A-Za-z0-9_-]{20,}/ },
  { kind: 'api_key', pattern: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/ },
  { kind: 'access_token', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { kind: 'access_token', pattern: /\bgithub_pat_[A-Za-z0-9_]{30,}/ },
  { kind: 'access_token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { kind: 'access_token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}/ },
  { kind: 'access_token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { kind: 'access_token', pattern: /\bya29\.[A-Za-z0-9_-]{20,}/ },
  { kind: 'access_token', pattern: /\bksh_(?:at|rt)_[A-Za-z0-9_-]{20,}/ },
  {
    kind: 'access_token',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
  {
    kind: 'email',
    pattern: /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8}/,
  },
  {
    kind: 'home_path',
    pattern:
      /(?:^|[^A-Za-z0-9_])\/(?:Users|home)\/(?!<|\$|\{|you\b|user\b|username\b|name\b|me\b|example\b)[A-Za-z0-9._-]{1,64}/,
  },
  {
    kind: 'home_path',
    pattern:
      /[A-Za-z]:\\Users\\(?!<|%|you\b|user\b|username\b|name\b|example\b)[A-Za-z0-9._-]{1,64}/i,
  },
  {
    kind: 'env_secret',
    pattern:
      /\b[A-Z0-9_]{0,40}(?:SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|APIKEY|PRIVATE_KEY|CLIENT_SECRET)[A-Z0-9_]{0,20}\s{0,3}[=:]\s{0,3}["']?[A-Za-z0-9/+_.=-]{8,}/,
  },
];

const MAX_FINDINGS = 20;

/** Lines are scanned one by one, so each rule sees at most one line of bounded length. */
export function scanForSecrets(...texts: string[]): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (const text of texts) {
    const lines = text.split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
      // Very long lines are scanned in overlapping windows to keep each match bounded.
      const line = lines[i];
      for (let start = 0; start < Math.max(line.length, 1); start += 3500) {
        const window = line.slice(Math.max(0, start - 200), start + 3500);
        for (const rule of RULES) {
          if (!rule.pattern.test(window)) continue;
          const key = rule.kind + ':' + (offset + i + 1);
          if (seen.has(key)) continue;
          seen.add(key);
          findings.push({ kind: rule.kind, line: offset + i + 1 });
          if (findings.length >= MAX_FINDINGS) return findings;
        }
      }
    }
    offset += lines.length;
  }
  return findings;
}

export interface FieldFinding extends SecretFinding {
  field: 'title' | 'body';
}
/** Scans title and body separately so line numbers match what the student sees. */
export function scanDraft(title: string, body: string): FieldFinding[] {
  return [
    ...scanForSecrets(title).map((f) => ({ ...f, field: 'title' as const })),
    ...scanForSecrets(body).map((f) => ({ ...f, field: 'body' as const })),
  ];
}
export function describeFindings(findings: FieldFinding[]): string {
  return findings
    .map((f) =>
      f.field === 'title'
        ? `タイトル：${SECRET_KIND_LABELS[f.kind]}`
        : `本文 ${f.line} 行目：${SECRET_KIND_LABELS[f.kind]}`,
    )
    .join('\n');
}
