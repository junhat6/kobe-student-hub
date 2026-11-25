#!/usr/bin/env node
// MCP 育成ループ（LOOPS.md「MCP 育成ループ」）の記録と同期。
//
// 公式 MCP（/api/mcp）以外の経路で本番の hub を操作した出来事を「MCP の穴」として記録し、
// docs/loop/mcp-coverage.json（MCP 対応表）の class に従って GitHub Issue の待ち行列に乗せる。
//
//   hook        Claude Code の hook から呼ぶ。PostToolUse で Claude in Chrome・ブラウザ CLI・curl・
//               リモート D1 が本番 hub に触れたら記録し、Stop で「何をしたか」の分類を 1 回だけ頼む
//   ops         記録に使う操作 ID の一覧
//   record      エージェントの作業報告・オーナーの申告を記録する
//   classify    hook が拾ったこのセッションの出来事を、操作 ID で分類する
//   report      記録の集計（同期前の確認）
//   sync        集計を GitHub Issue（label mcp-gap）と log Issue に送る
//
// 記録に残すのは列挙した項目だけ（DESIGN-PRINCIPLES 原則1）：時刻・経路・画面や API の型・表の名前・
// 操作 ID・出どころ・ループ名・セッションの先頭 12 文字。URL のクエリ・ID・SQL・本文・画面の文字は残さない。
// 置き場所はリポジトリの外（~/ksh-private/mcp-gaps/、LOOPS「実利用者のデータ」）。公開 Issue に出るのは
// 操作 ID ごとの件数だけ。
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const COVERAGE_PATH = resolve(here, '../../docs/loop/mcp-coverage.json');
export const REPO = process.env.KSH_REPO || 'junhat6/kobe-student-hub';
export const HUB_HOST = new URL(process.env.KSH_PRODUCTION_ORIGIN || 'https://hub.junhat6.com')
  .host;
export const LABEL = 'mcp-gap';
export const LOG_LABEL = 'mcp-gap-log';
export const LOG_TITLE = 'loop: mcp-gap log（公式 MCP 以外の経路での hub の操作）';
export const VIAS = ['chrome', 'browser-cli', 'ui', 'http', 'd1'];
export const SOURCES = ['hook', 'report', 'owner', 'taste'];
// 分類用の擬似操作：inspect＝画面の確認が目的（patrol・polish・look）で、MCP の穴ではない
export const PSEUDO_OPS = ['inspect', 'unknown'];
export const P1_TOTAL = 3;
export const P1_DAYS = 2;
// 実利用者（taste）由来の件数は、少ないと個人に近づくので丸める（LOOPS「実利用者のデータ」）
export const SMALL_COUNT = 5;

export const dataDir = () =>
  process.env.KSH_MCP_GAP_DIR || join(homedir(), 'ksh-private', 'mcp-gaps');
const eventsFile = () => join(dataDir(), 'events.jsonl');
const stateFile = () => join(dataDir(), 'state.json');

export function loadCoverage(path = COVERAGE_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ---- 経路の型 ----

const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f-]{27}|[0-9a-f]{16,}|\d+|[A-Za-z0-9_-]{20,})$/i;

/** 本番 hub の URL を、対応表の pages / api に合わせた型にする。ID・クエリ・断片は落とす。 */
export function pathTemplate(pathname, coverage) {
  const segs = pathname.split('/').filter(Boolean);
  const pages = coverage.ops.flatMap((o) => o.pages || []);
  const hit = pages.find((p) => {
    const ps = p.split('/').filter(Boolean);
    return ps.length === segs.length && ps.every((s, i) => s === ':id' || s === segs[i]);
  });
  if (hit) return hit;
  if (segs[0] === 'api') {
    // API は 3 段目まで（/api/private/drafts）と、続きが ID なら :id
    const head = segs.slice(0, 3).map((s) => (ID_SEGMENT.test(s) ? ':id' : s));
    return '/' + head.join('/') + (segs.length > 3 ? '/:id' : '');
  }
  if (!segs.length) return '/';
  const first = /^[a-z][a-z-]{0,30}$/.test(segs[0]) ? segs[0] : ':id';
  return '/' + first + (segs.length > 1 ? '/*' : '');
}

const apiEntries = (coverage) =>
  coverage.ops.flatMap((o) =>
    (o.api || []).map((spec) => {
      const [method, path] = spec.includes(' ') ? spec.split(' ') : [null, spec];
      return { op: o.id, method, path };
    }),
  );

/** surface（"GET /api/…" "page /drafts" "d1 editorial_reviews"）から操作 ID を引く。決まらなければ unknown。 */
export function opForSurface(surface, coverage) {
  const [kind, ...rest] = surface.split(' ');
  if (kind === 'page') {
    const ops = coverage.ops.filter((o) => (o.pages || []).includes(rest[0]));
    return ops.length === 1 ? ops[0].id : 'unknown';
  }
  if (kind === 'd1') {
    const ops = new Set(
      rest.map((t) => coverage.ops.find((o) => (o.d1 || []).includes(t))?.id || 'unknown'),
    );
    return ops.size === 1 ? [...ops][0] : 'unknown';
  }
  const method = kind;
  const path = rest[0] || '';
  let best = [];
  let bestLen = -1;
  for (const e of apiEntries(coverage)) {
    if (e.method && e.method !== method) continue;
    if (!path.startsWith(e.path.replace(/\/$/, '')) && path !== e.path) continue;
    const len = e.path.length + (e.method ? 0.5 : 0);
    if (len > bestLen) {
      best = [e.op];
      bestLen = len;
    } else if (len === bestLen && !best.includes(e.op)) best.push(e.op);
  }
  return best.length === 1 ? best[0] : 'unknown';
}

// ---- hook が拾う出来事 ----

const HUB_URL = () =>
  new RegExp(`https?://${HUB_HOST.replace(/\./g, '\\.')}(/[^\\s'"\`<>)\\]]*)?`, 'g');
// URL を書いただけ（git commit・gh issue・echo）は数えない。実際に hub へ出ていく道具のときだけ
const NETWORK_TOOL = /(?:^|[\s;&|(])(curl|wget|xh|orca\s+browser|agent-browser|playwright)\b/;
const D1_REMOTE = /\bwrangler\b[^\n]*\bd1\s+execute\b[^\n]*--remote\b/;

function hubPaths(text) {
  return [...text.matchAll(HUB_URL())].map((m) => {
    try {
      return new URL(m[0]).pathname;
    } catch {
      return '/';
    }
  });
}

function curlMethod(command) {
  const m = command.match(/(?:-X|--request)\s+['"]?([A-Z]+)/);
  if (m) return m[1];
  return /\s(-d|--data[\w-]*|-F|--form|--json)\s/.test(command) ? 'POST' : 'GET';
}

/** PostToolUse の入力から、記録する出来事（列挙した項目だけ）を作る。触れていなければ []。 */
export function eventsFromHook(input, coverage, now = new Date()) {
  const tool = String(input.tool_name || '');
  const ti = input.tool_input || {};
  const base = {
    at: now.toISOString().slice(0, 16) + 'Z',
    source: 'hook',
    session: String(input.session_id || '').slice(0, 12),
    loop: loopName(),
  };
  const out = [];
  if (/^mcp__claude-in-chrome__|^mcp__Claude_Browser__/.test(tool)) {
    for (const p of hubPaths(JSON.stringify(ti))) {
      const t = pathTemplate(p, coverage);
      const surface = t.startsWith('/api/') ? `GET ${t}` : `page ${t}`;
      out.push({ ...base, via: 'chrome', surface, op: opForSurface(surface, coverage) });
    }
  } else if (tool === 'Bash') {
    const command = String(ti.command || '');
    if (D1_REMOTE.test(command)) {
      const known = coverage.ops.flatMap((o) => o.d1 || []);
      const tables = [...new Set(known.filter((t) => new RegExp(`\\b${t}\\b`).test(command)))];
      const surface = `d1 ${tables.length ? tables.sort().join(' ') : '?'}`;
      out.push({ ...base, via: 'd1', surface, op: opForSurface(surface, coverage) });
    } else if (NETWORK_TOOL.test(command)) {
      const http = /(?:^|[\s;&|(])(curl|wget|xh)\b/.test(command);
      for (const p of hubPaths(command)) {
        const t = pathTemplate(p, coverage);
        if (t.startsWith('/api/mcp')) continue; // 公式 MCP そのもの
        const surface = t.startsWith('/api/') ? `${curlMethod(command)} ${t}` : `page ${t}`;
        out.push({
          ...base,
          via: t.startsWith('/api/') && http ? 'http' : 'browser-cli',
          surface,
          op: opForSurface(surface, coverage),
        });
      }
    }
  }
  // 同じ呼び出しの中の重複は 1 件に
  const seen = new Set();
  return out.filter((e) => !seen.has(e.surface) && seen.add(e.surface));
}

function loopName() {
  const v = process.env.KSH_LOOP || process.env.ORCA_AUTOMATION_NAME || '';
  const m = v.match(/(finish|patrol|polish|garden|replan|release|editor|mend|video-review)/);
  return m ? m[1] : 'interactive';
}

// ---- 記録の読み書き ----

export function readEvents(file = eventsFile()) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

const ALLOWED_KEYS = [
  'at',
  'via',
  'surface',
  'op',
  'source',
  'session',
  'loop',
  'count',
  'type',
  'ops',
];

export function appendEvents(events, file = eventsFile()) {
  if (!events.length) return;
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const lines = events.map((e) =>
    JSON.stringify(Object.fromEntries(ALLOWED_KEYS.filter((k) => k in e).map((k) => [k, e[k]]))),
  );
  appendFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
}

// ---- 集計と Issue の計画（純粋関数。tests/mcp-coverage.test.ts が確かめる） ----

/**
 * 出来事を操作 ID ごとに数える。分類（type: classify）があるセッションは、hook の生の出来事を
 * 数えず分類だけを数える（同じ操作の二重計上を防ぐ）。inspect は数えるが穴ではない。
 */
export function tally(events) {
  const classified = new Set(events.filter((e) => e.type === 'classify').map((e) => e.session));
  const rows = new Map();
  const add = (op, via, source, day, n) => {
    const r = rows.get(op) || { op, total: 0, days: new Set(), via: {}, source: {} };
    r.total += n;
    r.days.add(day);
    r.via[via] = (r.via[via] || 0) + n;
    r.source[source] = (r.source[source] || 0) + n;
    rows.set(op, r);
  };
  for (const e of events) {
    const day = String(e.at || '').slice(0, 10);
    if (e.type === 'classify') {
      const vias = [
        ...new Set(
          events.filter((x) => x.session === e.session && x.source === 'hook').map((x) => x.via),
        ),
      ];
      for (const op of e.ops || []) add(op, vias[0] || 'chrome', 'report', day, 1);
      continue;
    }
    if (e.source === 'hook' && classified.has(e.session)) continue;
    add(e.op || 'unknown', e.via || 'ui', e.source || 'report', day, Number(e.count) || 1);
  }
  return [...rows.values()].map((r) => ({ ...r, days: [...r.days].sort() }));
}

/** hook が拾ったが分類されていないセッションの出来事。 */
export function pendingFor(session, events) {
  if (events.some((e) => e.type === 'classify' && e.session === session)) return [];
  return events.filter((e) => e.source === 'hook' && e.session === session);
}

export const fmtCount = (n, source) =>
  source === 'taste' && n < SMALL_COUNT ? `${SMALL_COUNT}件未満` : `${n}件`;

/**
 * 操作ごとの集計（今回分の delta と、これまでの累計 prior）から、Issue に対する行動を決める。
 * human-only・inspect は Issue を作らない。gap は loop:finish＋R2、mcp は loop:garden、
 * excluded・operator・unknown は mcp-gap だけ（replan の判断待ち）。
 */
export function planIssue(row, prior, coverage) {
  const op = coverage.ops.find((o) => o.id === row.op);
  const cls = op ? op.class : row.op === 'inspect' ? 'inspect' : 'unknown';
  if (cls === 'human-only' || cls === 'inspect') return { op: row.op, cls, action: 'log-only' };
  const total = (prior?.total || 0) + row.total;
  const days = new Set([...(prior?.days || []), ...row.days]).size;
  const labels = [LABEL];
  if (cls === 'gap') labels.push('loop:finish', 'R2');
  if (cls === 'mcp') labels.push('loop:garden');
  const queued = cls === 'gap' || cls === 'mcp';
  const priority = queued ? (total >= P1_TOTAL || days >= P1_DAYS ? 'P1' : 'P2') : null;
  if (priority) labels.push(priority);
  return { op: row.op, cls, action: 'issue', labels, priority, total, days, label: op?.label };
}

export function issueTitle(plan) {
  const name = plan.label ? `${plan.label}（${plan.op}）` : plan.op;
  if (plan.cls === 'gap') return `MCP: ${name}を公式 MCP でできるようにする`;
  if (plan.cls === 'mcp') return `MCP: ${name}が MCP 以外の経路で行われている`;
  if (plan.cls === 'unknown') return 'MCP: 対応表に無い経路での hub の操作を分類する';
  return `MCP: ${name}を MCP に置くか判断する（${plan.cls}）`;
}

export const marker = (op) => `<!-- ksh-mcp-gap op=${op} -->`;

export function issueBody(plan, coverage) {
  const op = coverage.ops.find((o) => o.id === plan.op);
  const what = {
    gap: [
      '対応表で `gap`（MCP に足してよい）の操作が、公式 MCP 以外の経路で行われました。finish がこの操作を MCP のツールとして足します。',
      '',
      '- R2（MCP は認証・権限の境界）。別 context の独立検証を経てから release に乗せる。',
      '- 守ること：本人の接続・在籍期間・所有者の確認、公開 DTO だけを返す、入力は決めた型と上限だけ（DESIGN-PRINCIPLES 原則1）。初めての公開・削除の手段は置かない（恒久条件）。',
      '- 終わったら：`docs/loop/mcp-coverage.json` のこの操作を `class: "mcp"`・`tool: "<名前>"` にし、`npm test`（tests/mcp-coverage.test.ts）を通す。C21 acceptance 4 のツール一覧への追記は replan に頼む（builder は acceptance を変えない）。',
    ],
    mcp: [
      'この操作は公式 MCP にあるのに、別の経路で行われました。ツールの不足ではなく、接続（その場で MCP がつながっていない）・説明（ツールが見つからない・使い方が分からない）・使い勝手のどれかを直します。',
      '',
      '- まず記録の loop 名と経路を見て、どの場面で MCP を使わなかったかを確かめる（editor の取り込み、オーナーの手作業など）。',
      '- 直す先の例：loop の指示書で MCP を先に使う手順にする、ツールの description・サーバーの instructions・/agents を直す、足りない引数を足す（引数を足すなら R2）。',
    ],
    excluded: [
      '対応表で `excluded`（C21・C23 の受け入れ条件が MCP に置かないと名指し）の操作が、公式 MCP 以外の経路で行われました。',
      '',
      `- 根拠：${op?.basis || '—'}`,
      '- replan が判断する：置かないままにする（理由をコメントして閉じる）か、DECISIONS に理由を書いて対応表を `gap` に移し、loop:finish の Issue を作る。恒久条件を写した部分は変えない。',
    ],
    operator: [
      '運営者だけの操作が、公式 MCP 以外の経路（画面・リモート D1 など）で行われました。学生向けの MCP には置きません。',
      '',
      `- 根拠：${op?.basis || '—'}`,
      '- replan が判断する：今の経路のままにする、運営者だけの別の接続（別スコープ）を設計する、loop の手順を変える。',
    ],
    unknown: [
      '対応表に無い経路（画面・API・表）で hub が操作されました。replan が `docs/loop/mcp-coverage.json` に操作を足して分類します。どの surface かは log Issue の集計を見てください。',
    ],
  }[plan.cls];
  return [
    marker(plan.op),
    ...what,
    '',
    '件数は scripts/loop/mcp-gap.mjs の同期コメントにあります（操作 ID・経路・出どころの数だけ。中身・ID・利用者は書かない）。仕組みは docs/loop/LOOPS.md「MCP 育成ループ」。',
  ].join('\n');
}

export function syncComment(row, plan) {
  const vias = Object.entries(row.via)
    .map(([k, n]) => `${k} ${n}`)
    .join('・');
  const sources = Object.entries(row.source)
    .map(([k, n]) => `${k} ${fmtCount(n, k)}`)
    .join('・');
  const json = { op: row.op, n: row.total, days: row.days };
  return [
    `今回 ${row.total}件（経路：${vias}／出どころ：${sources}）。累計 ${plan.total ?? row.total}件・${plan.days ?? row.days.length}日。`,
    '',
    '```json',
    JSON.stringify(json),
    '```',
  ].join('\n');
}

/** Issue のコメントに残した JSON 行から累計を読み戻す（複数の Mac から同期しても合算できる）。 */
export function priorFromComments(comments, op) {
  let total = 0;
  const days = new Set();
  for (const c of comments) {
    for (const m of String(c.body || '').matchAll(/```json\n(\{[^\n]*\})\n```/g)) {
      try {
        const j = JSON.parse(m[1]);
        if (j.op !== op) continue;
        total += Number(j.n) || 0;
        (j.days || []).forEach((d) => days.add(d));
      } catch {}
    }
  }
  return { total, days: [...days] };
}

// ---- gh ----

const gh = (args, input) =>
  execFileSync('gh', ['-R', REPO, ...args], {
    encoding: 'utf8',
    input,
    stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });

function ensureLabels() {
  const have = new Set(
    JSON.parse(gh(['label', 'list', '--limit', '200', '--json', 'name'])).map((l) => l.name),
  );
  for (const [name, color, desc] of [
    [LABEL, '5319e7', '公式 MCP 以外の経路で行われた hub の操作（MCP 育成ループ）'],
    [LOG_LABEL, 'c5def5', 'MCP 育成ループの同期の記録'],
  ])
    if (!have.has(name)) gh(['label', 'create', name, '--color', color, '--description', desc]);
}

function sync({ dryRun }) {
  const coverage = loadCoverage();
  const events = readEvents();
  const state = existsSync(stateFile()) ? JSON.parse(readFileSync(stateFile(), 'utf8')) : {};
  const from = Number(state.synced || 0);
  // 分類は後から届くので、まだ分類されていないセッションの hook の出来事は 2 時間待つ
  const cutoff = Date.now() - 2 * 3600_000;
  let upto = events.length;
  for (let i = from; i < events.length; i++) {
    const e = events[i];
    if (e.source === 'hook' && pendingFor(e.session, events).length && Date.parse(e.at) > cutoff) {
      upto = i;
      break;
    }
  }
  const fresh = events.slice(from, upto);
  const rows = tally(fresh).filter((r) => r.total > 0);
  if (!rows.length) {
    console.log('[mcp-gap] 同期する出来事はありません');
    if (!dryRun) save(upto);
    return;
  }
  if (!dryRun) ensureLabels();
  const open = dryRun
    ? []
    : JSON.parse(
        gh([
          'issue',
          'list',
          '--label',
          LABEL,
          '--state',
          'all',
          '--limit',
          '200',
          '--json',
          'number,state,body',
        ]),
      );
  const lines = [];
  for (const row of rows) {
    const existing = open.find((i) => String(i.body || '').includes(marker(row.op)));
    const comments =
      existing && !dryRun
        ? JSON.parse(gh(['issue', 'view', String(existing.number), '--json', 'comments'])).comments
        : [];
    const plan = planIssue(row, priorFromComments(comments, row.op), coverage);
    lines.push(
      `| ${row.op} | ${plan.cls} | ${row.total} | ${Object.keys(row.via).join('・')} | ${plan.action === 'issue' ? (existing ? `#${existing.number}` : '新規') : '—'} |`,
    );
    if (dryRun || plan.action !== 'issue') continue;
    let number = existing?.number;
    if (!number) {
      const url = gh(
        [
          'issue',
          'create',
          '--title',
          issueTitle(plan),
          '--body-file',
          '-',
          ...plan.labels.flatMap((l) => ['--label', l]),
        ],
        issueBody(plan, coverage),
      ).trim();
      number = Number(url.split('/').pop());
    } else if (plan.priority === 'P1' && existing.state === 'OPEN') {
      gh(['issue', 'edit', String(number), '--add-label', 'P1', '--remove-label', 'P2']);
    }
    gh(['issue', 'comment', String(number), '--body-file', '-'], syncComment(row, plan));
  }
  const table = [
    `at: ${new Date().toISOString()}`,
    `出来事 ${fresh.length}件を同期（操作 ID ごとの数だけ。中身・ID・利用者は書かない）`,
    '',
    '| 操作 | class | 件数 | 経路 | Issue |',
    '| --- | --- | --- | --- | --- |',
    ...lines,
  ].join('\n');
  if (dryRun) {
    console.log(table);
    return;
  }
  const log = JSON.parse(
    gh(['issue', 'list', '--label', LOG_LABEL, '--state', 'open', '--json', 'number']),
  )[0];
  const logNumber =
    log?.number ??
    Number(
      gh(
        ['issue', 'create', '--title', LOG_TITLE, '--label', LOG_LABEL, '--body-file', '-'],
        'MCP 育成ループの同期の記録（docs/loop/LOOPS.md「MCP 育成ループ」）。操作 ID ごとの件数だけを残す。\n',
      )
        .trim()
        .split('/')
        .pop(),
    );
  gh(['issue', 'comment', String(logNumber), '--body-file', '-'], table);
  save(upto);
  console.log(table);

  function save(n) {
    mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
    writeFileSync(stateFile(), JSON.stringify({ ...state, synced: n }) + '\n', { mode: 0o600 });
  }
}

// ---- CLI ----

function parseFlags(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else {
        flags[key] = next;
        i++;
      }
    } else rest.push(a);
  }
  return { flags, rest };
}

function fail(message) {
  console.error(`[mcp-gap] ${message}`);
  process.exit(2);
}

function validOps(coverage) {
  return new Set([...coverage.ops.map((o) => o.id), ...PSEUDO_OPS]);
}

// Stop のたびに、未同期の出来事があり前回の試行から1時間たっていれば、裏で sync を1本だけ走らせる。
// ループの Mac mini でも、オーナーの MacBook Air でも、記録した Mac から Issue へ届くようにするため。
function backgroundSync(events) {
  const state = existsSync(stateFile()) ? JSON.parse(readFileSync(stateFile(), 'utf8')) : {};
  if (events.length <= Number(state.synced || 0)) return;
  if (Date.now() - Number(state.attempt || 0) < 3600_000) return;
  mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
  writeFileSync(stateFile(), JSON.stringify({ ...state, attempt: Date.now() }) + '\n', {
    mode: 0o600,
  });
  spawn(process.execPath, [fileURLToPath(import.meta.url), 'sync'], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}

async function hook() {
  if (process.env.KSH_MCP_GAP === 'off') return;
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input = {};
  try {
    input = JSON.parse(raw || '{}');
  } catch {
    return;
  }
  try {
    const coverage = loadCoverage();
    if (input.hook_event_name === 'Stop') {
      if (input.stop_hook_active) return;
      const session = String(input.session_id || '').slice(0, 12);
      const events = readEvents();
      const pending = pendingFor(session, events);
      if (!pending.length) return backgroundSync(events);
      const surfaces = [...new Set(pending.map((e) => `${e.via}:${e.surface}`))].slice(0, 8);
      const guesses = [...new Set(pending.map((e) => e.op).filter((o) => o !== 'unknown'))];
      process.stdout.write(
        JSON.stringify({
          decision: 'block',
          reason:
            `[mcp-gap] このセッションは公式 MCP 以外の経路で本番 hub に触れました（${surfaces.join('、')}）。` +
            `何をしたかを操作 ID で 1 回だけ記録してください：\`node scripts/loop/mcp-gap.mjs classify --session ${session} <op> [<op>...]\`` +
            `（候補 ${guesses.length ? guesses.join(' ') : 'なし'}。一覧は \`node scripts/loop/mcp-gap.mjs ops\`。画面の確認が目的なら inspect）。` +
            'MCP にない操作は MCP 育成ループの Issue になります（docs/loop/LOOPS.md）。',
        }),
      );
      return;
    }
    appendEvents(eventsFromHook(input, coverage));
  } catch {
    // hook は作業を止めない
  }
}

async function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  const { flags, rest } = parseFlags(argv);
  if (cmd === 'hook') return hook();
  const coverage = loadCoverage();
  const ops = validOps(coverage);
  const at = new Date().toISOString().slice(0, 16) + 'Z';
  if (cmd === 'ops') {
    for (const o of coverage.ops)
      console.log(`${o.id.padEnd(26)} ${o.class.padEnd(10)} ${o.tool || ''}\t${o.label}`);
    console.log(
      `${'inspect'.padEnd(26)} ${'—'.padEnd(10)} \t画面の確認が目的（patrol・polish・look）`,
    );
    return;
  }
  if (cmd === 'record') {
    const [op] = rest;
    if (!ops.has(op)) fail(`操作 ID が対応表にありません: ${op}（ops で一覧）`);
    const via = flags.via || 'ui';
    const source = flags.source || 'report';
    if (!VIAS.includes(via)) fail(`--via は ${VIAS.join('|')}`);
    if (!SOURCES.includes(source)) fail(`--source は ${SOURCES.join('|')}`);
    const count = flags.count ? Number(flags.count) : 1;
    if (!Number.isInteger(count) || count < 1 || count > 1000) fail('--count は 1〜1000');
    const loop =
      typeof flags.loop === 'string' && /^[a-z-]{1,20}$/.test(flags.loop) ? flags.loop : loopName();
    appendEvents([{ at, via, surface: `op ${op}`, op, source, loop, count }]);
    console.log(`[mcp-gap] 記録しました: ${op}（${via}・${source}・${count}件）`);
    return;
  }
  if (cmd === 'classify') {
    const session = String(flags.session || '').slice(0, 12);
    if (!/^[\w-]{4,12}$/.test(session)) fail('--session <セッションの先頭12文字> が要ります');
    if (!rest.length || rest.some((o) => !ops.has(o)))
      fail(`操作 ID が対応表にありません: ${rest.join(' ')}`);
    appendEvents([{ at, type: 'classify', session, ops: [...new Set(rest)] }]);
    console.log(`[mcp-gap] 分類しました: ${rest.join(' ')}`);
    return;
  }
  if (cmd === 'report') {
    for (const r of tally(readEvents())) {
      const plan = planIssue(r, null, coverage);
      console.log(
        `${r.op.padEnd(26)} ${plan.cls.padEnd(10)} ${String(r.total).padStart(4)}件 ${r.days.length}日 ${Object.keys(r.via).join('・')}`,
      );
    }
    return;
  }
  if (cmd === 'sync') return sync({ dryRun: Boolean(flags['dry-run']) });
  console.log(
    '使い方: node scripts/loop/mcp-gap.mjs <ops|record <op> [--via chrome|browser-cli|ui|http|d1] [--source report|owner|taste] [--count n] [--loop name]|classify --session <id> <op>...|report|sync [--dry-run]|hook>',
  );
  if (cmd) process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
