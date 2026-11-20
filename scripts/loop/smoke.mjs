#!/usr/bin/env node
// 本番（または任意の origin）に対する最小の smoke。
// 「開ける」「公開 API が動く」「書き込み境界と security header が保たれている」だけを見る。
// 詳しい挙動は CI の E2E が担い、ここは deploy 直後に壊れていないかを数秒で判定する役。
// 使い方: node scripts/loop/smoke.mjs [origin]
const DEFAULT_ORIGIN = 'https://hub.junhat6.com';

const checks = [
  {
    name: 'home',
    path: '/',
    expect: (r) => r.status === 200 && /text\/html/.test(r.headers.get('content-type') || ''),
  },
  {
    name: 'health',
    path: '/api/health',
    expect: async (r) => r.status === 200 && (await r.json()).status === 'ok',
  },
  {
    name: 'catalog',
    path: '/api/catalog',
    expect: async (r) => {
      if (r.status !== 200) return false;
      const body = await r.json();
      return Array.isArray(body)
        ? body.length > 0
        : Object.values(body).some((v) => Array.isArray(v));
    },
  },
  {
    name: 'deep-link',
    path: '/articles/does-not-exist-smoke',
    expect: (r) => r.status === 200 || r.status === 404,
  },
  {
    name: 'write-denied',
    path: '/api/catalog',
    init: { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } },
    expect: (r) => r.status >= 400 && r.status < 500,
  },
  {
    name: 'security-headers',
    path: '/',
    expect: (r) =>
      Boolean(r.headers.get('x-content-type-options') || r.headers.get('content-security-policy')),
  },
];

export async function smoke(origin = DEFAULT_ORIGIN, { timeoutMs = 10_000 } = {}) {
  const failures = [];
  for (const c of checks) {
    try {
      const r = await fetch(new URL(c.path, origin), {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': 'ksh-release-smoke' },
        ...c.init,
      });
      if (!(await c.expect(r))) failures.push(`${c.name}(${r.status})`);
    } catch (e) {
      failures.push(`${c.name}(${e?.name || 'error'})`);
    }
  }
  return { ok: failures.length === 0, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const origin = process.argv[2] || process.env.KSH_PRODUCTION_ORIGIN || DEFAULT_ORIGIN;
  const result = await smoke(origin);
  console.log(
    result.ok ? `smoke OK: ${origin}` : `smoke FAILED: ${origin} ${result.failures.join(', ')}`,
  );
  process.exit(result.ok ? 0 : 1);
}
