#!/usr/bin/env node
// リリース列車の「便」と「記録」。scripts/release.mjs と release-report が使う。
//
// 便（オーナー方針 2026-11-22）
//   本番リリースは毎日 08:00 と 20:00（JST）の定時便に寄せる。発車時刻から 2 時間を便の窓とし、
//   窓の外で昇格・deploy するのは、理由を書いた臨時便（--hotfix "<理由>"）だけにする。
//
// 記録
//   1 回の列車ごとに、GitHub Issue（label `release-log`）へコメントを 1 件残す。人が読む表と、集計用の
//   1 行 JSON（```json の中）を同じコメントに入れる。見送り・失敗も同じ形で残す。
//   リポジトリのファイルにしない理由: 記録の commit が main に増えると、main が常に「未リリース」になり、
//   次の便が記録だけを出荷しに行くことになる。Issue なら worktree が消えても残り、gh で読み戻せる。
//   このリポジトリは公開なので、記録に書くのは commit の件名・短い SHA・CI と deploy の結果・
//   自前スクリプトの 1 行メッセージだけ（wrangler の生の出力・ID・メールは書かない）。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { formatMediaAudit } from './media-audit.mjs';

export const REPO = process.env.KSH_REPO || 'junhat6/kobe-student-hub';
export const LOG_LABEL = 'release-log';
export const LOG_TITLE = 'Release log（リリース列車の記録）';
export const MARKER = '<!-- ksh-release-record v1 -->';
export const TZ = 'Asia/Tokyo';

// 定時便。window は発車からの分数。Orca の missed-run grace（100 分）と CI の待ち時間より長くとる。
export const TRAINS = [
  { id: 'morning', label: '朝便', hour: 8 },
  { id: 'evening', label: '夜便', hour: 20 },
];
export const WINDOW_MIN = 120;

const jstParts = (date) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
};

export const jstDay = (date) => jstParts(date).day;
export const jstTime = (date) => {
  const p = jstParts(date);
  return `${p.day} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
};

// その時刻が定時便の窓の中なら、その便（id・日付・発車時刻）を返す。外なら undefined。
export function trainAt(date = new Date()) {
  const { day, hour, minute } = jstParts(date);
  const sinceMidnight = hour * 60 + minute;
  for (const t of TRAINS) {
    const elapsed = sinceMidnight - t.hour * 60;
    if (elapsed >= 0 && elapsed < WINDOW_MIN) return { ...t, day, slot: `${day} ${t.id}` };
  }
  return undefined;
}

// 直近に発車した定時便（窓の中かどうかを問わない）。07:00 なら前日の夜便。
export function lastDeparted(date = new Date()) {
  const { day, hour } = jstParts(date);
  const today = [...TRAINS].reverse().find((t) => t.hour <= hour);
  if (today) return { ...today, day, slot: `${day} ${today.id}` };
  const y = jstDay(new Date(date.getTime() - 86_400_000));
  const t = TRAINS[TRAINS.length - 1];
  return { ...t, day: y, slot: `${y} ${t.id}` };
}

// 見送りのうち、原因が片付けば同じ便で出し直すもの（main-health 赤は mend が直し、rc 実行中は待てば空く）
export const RETRYABLE_BLOCKERS = ['main_health', 'rc_running'];

// 出しきれていない便（オーナー方針 2026-11-24: 便は始めたら本番に出るまで回す）。
// 直近に発車した便に記録があり、最後の記録が失敗か「待てば出せる見送り」なら、その便と最後の記録を返す。
// 次の便が発車したら、前の便は次の便に引き継がれる（ここでは返さない）。
export function openTrain(records, date = new Date()) {
  const t = lastDeparted(date);
  const mine = records
    .filter((r) => r.train?.slot === t.slot)
    // 終わった順に並べる。長い便の途中で別の agent が短い見送り（rc_running）を残しても、
    // 後で終わった released が最後になるように（開始順だと見送りが最後に見えて、出た便を続けようとする）
    .sort(
      (a, b) => Date.parse(a.finishedAt ?? a.startedAt) - Date.parse(b.finishedAt ?? b.startedAt),
    );
  const last = mine.at(-1);
  if (!last) return undefined;
  const ok = OUTCOMES[last.outcome]?.ok;
  if (ok && !(last.outcome === 'skipped' && RETRYABLE_BLOCKERS.includes(last.blocker)))
    return undefined;
  return { train: t, last };
}

// 次の定時便の発車時刻（表示用）
export function nextTrain(date = new Date()) {
  const { hour, minute } = jstParts(date);
  const now = hour * 60 + minute;
  const t = TRAINS.find((x) => x.hour * 60 > now) ?? TRAINS[0];
  return `${t.label} ${String(t.hour).padStart(2, '0')}:00`;
}

// 結果の種類。集計と見出しの記号に使う。
export const OUTCOMES = {
  released: { ok: true, icon: '✅', text: '本番に出た' },
  promoted: { ok: true, icon: '🟦', text: 'release へ昇格（deploy なし）' },
  redeployed: { ok: true, icon: '✅', text: '出し直し（昇格なし）' },
  skipped: { ok: true, icon: '⏸️', text: '見送り' },
  ci_failed: {
    ok: false,
    icon: '❌',
    text: 'full CI が赤',
    next: 'mend が次の1時間以内に起きて main で直す（または Issue に残す）→ release が --continue で同じ便を出す',
  },
  promote_failed: {
    ok: false,
    icon: '❌',
    text: 'release への push が拒否',
    next: 'ruleset・fast-forward を確かめ、--continue で出し直す',
  },
  config_missing: { ok: false, icon: '❌', text: '本番設定の入力が無い' },
  d1_unreachable: { ok: false, icon: '❌', text: '本番 D1 に届かない' },
  deploy_failed: {
    ok: false,
    icon: '❌',
    text: 'deploy が失敗',
    next: 'deploy のログで原因を直し、--continue で出し直す',
  },
  smoke_failed: {
    ok: false,
    icon: '↩️',
    text: 'smoke 失敗で rollback 済み',
    next: 'smoke の失敗を main で直し、--continue で出し直す',
  },
  rollback_failed: {
    ok: false,
    icon: '🚨',
    text: 'smoke 失敗・rollback も失敗',
    next: '最優先で本番を確かめ、手で rollback する',
  },
  github_unreachable: { ok: false, icon: '📡', text: 'GitHub API に繋がらない' },
  error: { ok: false, icon: '❌', text: 'その他の失敗' },
};

const cell = (s) =>
  String(s ?? '—')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');
const link = (text, url) => (url ? `[${text}](${url})` : text);

// 記録 1 件をコメント本文にする
export function formatRecord(r) {
  const o = OUTCOMES[r.outcome] ?? OUTCOMES.error;
  const kind = r.train
    ? `${r.train.label}${r.continued ? '（続き）' : ''}`
    : r.hotfix
      ? '臨時便'
      : '手動';
  const version = r.tag ? `${r.tag}（\`${r.short}\`）` : r.short ? `\`${r.short}\`` : '—';
  const rows = [
    ['結果', `${o.icon} ${r.outcome} — ${o.text}`],
    ['理由', r.reason],
    // 出しきれなかった便は、本番がどこに留まっているかと次の動きを見出しのすぐ下に出す（#336）
    o.ok === false && [
      '本番',
      r.outcome === 'rollback_failed'
        ? '要確認（rollback が失敗）'
        : `未出荷（${r.from ? `\`${r.from.slice(0, 7)}\` のまま` : '前の release のまま'}）`,
    ],
    o.ok === false && ['次の動き', o.next ?? '原因を直し、--continue で同じ便を出しきる'],
    ['便', `${kind}${r.hotfix ? `（臨時便の理由: ${r.hotfix}）` : ''}`],
    ['開始 → 終了 (JST)', `${jstTime(new Date(r.startedAt))} → ${jstTime(new Date(r.finishedAt))}`],
    ['バージョン', version],
    ['前の release', r.from ? `\`${r.from.slice(0, 7)}\`` : '—'],
    [
      '含むもの',
      r.commits
        ? `${r.commits.total} commits${r.migrations?.length ? `・migration ${r.migrations.join(', ')}` : ''}`
        : '—',
    ],
    [
      'CI verify',
      r.ci
        ? link(
            `${r.ci.conclusion ?? r.ci.status}${r.ci.reused ? '（成功済みを再利用）' : ''}`,
            r.ci.url,
          )
        : '—',
    ],
    ['deploy', r.deploy ? link(`${r.deploy.via}: ${r.deploy.result}`, r.deploy.url) : '—'],
    ['smoke', r.smoke ? (r.smoke.ok ? 'OK' : `失敗: ${r.smoke.failures.join(', ')}`) : '—'],
    ['D1 ブックマーク', r.bookmark ? `\`${r.bookmark}\`` : '—'],
    ['media 照合', formatMediaAudit(r.mediaAudit)],
  ]
    .filter(Boolean)
    .filter(([k, v]) => v !== undefined && !(k === '理由' && !v));
  const commits = r.commits?.list?.length
    ? [
        '<details><summary>含む commit</summary>',
        '',
        ...r.commits.list.map((c) => `- ${c}`),
        ...(r.commits.total > r.commits.list.length
          ? [`- …ほか ${r.commits.total - r.commits.list.length} 件`]
          : []),
        '',
        '</details>',
        '',
      ]
    : [];
  return [
    MARKER,
    `### ${o.icon} ${kind} ${jstTime(new Date(r.startedAt))} — ${version}`,
    '',
    '| | |',
    '| --- | --- |',
    ...rows.map(([k, v]) => `| ${k} | ${cell(v)} |`),
    '',
    ...commits,
    '<details><summary>集計用の記録</summary>',
    '',
    '```json',
    JSON.stringify(r),
    '```',
    '',
    '</details>',
  ].join('\n');
}

// コメント本文から記録を取り出す（形の違うコメントは無視する）
export function parseRecord(body) {
  if (!body?.startsWith(MARKER)) return undefined;
  const m = body.match(/```json\n(\{.*\})\n```/);
  if (!m) return undefined;
  try {
    return JSON.parse(m[1]);
  } catch {
    return undefined;
  }
}

const gh = (args, input) =>
  execFileSync('gh', args, {
    encoding: 'utf8',
    input,
    stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  }).trim();

export function logIssue({ create = false } = {}) {
  const n = gh([
    'issue',
    'list',
    '-R',
    REPO,
    '--label',
    LOG_LABEL,
    '--state',
    'all',
    '-L',
    '1',
    '--json',
    'number',
    '-q',
    '.[0].number // empty',
  ]);
  if (n || !create) return n;
  try {
    gh([
      'label',
      'create',
      LOG_LABEL,
      '-R',
      REPO,
      '--color',
      '0E8A16',
      '--description',
      'リリース列車の記録（1 便 1 コメント）',
    ]);
  } catch {
    // 既にある
  }
  const url = gh(
    ['issue', 'create', '-R', REPO, '--title', LOG_TITLE, '--label', LOG_LABEL, '--body-file', '-'],
    [
      'リリース列車（`npm run release`）が 1 回ごとに結果をコメントで残す場所です。',
      '',
      '- 定時便: 毎日 08:00 / 20:00 JST。窓の外は、出しきれていない便の続き（`--continue`）と `--hotfix "<理由>"` の臨時便だけ。',
      '- 集計: `npm run release:report -- --days 7`',
      '- 手順と判断: `.claude/skills/release/SKILL.md`、`docs/RELEASE.md`',
      '',
      'このコメント欄は scripts が書きます。手で消さないでください。',
    ].join('\n'),
  );
  return url.split('/').pop();
}

// 記録を残す。失敗しても列車は止めず、手元のファイルに残して再送の手順を出す。
export function recordRelease(r) {
  const body = formatRecord(r);
  try {
    const n = logIssue({ create: true });
    const url = gh(['issue', 'comment', n, '-R', REPO, '--body-file', '-'], body);
    console.log(`[release] 記録を残しました: ${url}`);
    return url;
  } catch (e) {
    const dir = mkdtempSync(join(tmpdir(), 'ksh-release-record-'));
    const file = join(dir, 'record.json');
    writeFileSync(file, JSON.stringify(r));
    console.error(
      `[release] 記録を Issue に残せませんでした（${String(e.message).split('\n')[0]}）。` +
        `npm run release:log -- --retry ${file} で送り直してください。`,
    );
    return undefined;
  }
}

export function readRecords() {
  const n = logIssue();
  if (!n) return [];
  const out = gh([
    'api',
    '--paginate',
    `repos/${REPO}/issues/${n}/comments?per_page=100`,
    '-q',
    '.[] | {body, url: .html_url} | @json',
  ]);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const c = JSON.parse(line);
      const r = parseRecord(c.body);
      return r && { ...r, commentUrl: c.url };
    })
    .filter(Boolean);
}

// 期間内の定時便の一覧（まだ窓が開いていない便は含めない）
export function expectedSlots(from, to) {
  const slots = [];
  const start = new Date(`${jstDay(from)}T00:00:00+09:00`);
  for (let d = start; d <= to; d = new Date(d.getTime() + 86_400_000)) {
    const day = jstDay(d);
    for (const t of TRAINS) {
      const at = new Date(`${day}T${String(t.hour).padStart(2, '0')}:00:00+09:00`);
      if (at >= from && at.getTime() + WINDOW_MIN * 60_000 <= to.getTime())
        slots.push({ slot: `${day} ${t.id}`, label: `${day} ${t.label}` });
    }
  }
  return slots;
}

// 集計: 結果の内訳、便ごとの有無（記録の無い定時便＝未実施）、失敗の理由
export function summarize(records, { from, to }) {
  const inRange = records.filter((r) => {
    const t = Date.parse(r.startedAt);
    return t >= from.getTime() && t <= to.getTime();
  });
  const byOutcome = {};
  for (const r of inRange) byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + 1;
  const slots = expectedSlots(from, to).map((s) => ({
    ...s,
    records: inRange.filter((r) => r.train?.slot === s.slot),
  }));
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    total: inRange.length,
    released: inRange.filter((r) => r.outcome === 'released').length,
    failed: inRange.filter((r) => OUTCOMES[r.outcome]?.ok === false).length,
    hotfix: inRange.filter((r) => r.hotfix).length,
    byOutcome,
    missedSlots: slots.filter((s) => !s.records.length).map((s) => s.label),
    slots,
    records: inRange,
  };
}

export function formatReport(s) {
  const lines = [
    `## リリース集計 ${jstTime(new Date(s.from))} 〜 ${jstTime(new Date(s.to))} (JST)`,
    '',
    `- 列車 ${s.total} 回（本番に出た ${s.released}・失敗 ${s.failed}・臨時便 ${s.hotfix}）`,
    `- 定時便 ${s.slots.length} 便のうち記録なし ${s.missedSlots.length} 便${s.missedSlots.length ? `: ${s.missedSlots.join('、')}` : ''}`,
    `- 内訳: ${
      Object.entries(s.byOutcome)
        .map(([k, v]) => `${k} ${v}`)
        .join('・') || 'なし'
    }`,
    '',
    '| 開始 (JST) | 便 | バージョン | 含む | CI | smoke | 結果 | 理由 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...s.records.map((r) =>
      [
        jstTime(new Date(r.startedAt)),
        r.train?.label ?? (r.hotfix ? '臨時便' : '手動'),
        r.tag ?? r.short ?? '—',
        r.commits ? `${r.commits.total}` : '—',
        r.ci?.conclusion ?? r.ci?.status ?? '—',
        r.smoke ? (r.smoke.ok ? 'OK' : 'NG') : '—',
        link(r.outcome, r.commentUrl),
        r.reason ?? (r.hotfix ? `臨時便: ${r.hotfix}` : ''),
      ]
        .map(cell)
        .join(' | ')
        .replace(/^/, '| ')
        .replace(/$/, ' |'),
    ),
  ];
  return lines.join('\n');
}

// CLI
//   npm run release:report -- [--days 7 | --since 2026-11-22] [--json]
//   npm run release:log -- --retry <record.json>
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (opt('--retry')) {
    const url = recordRelease(JSON.parse(readFileSync(opt('--retry'), 'utf8')));
    process.exit(url ? 0 : 1);
  }
  const to = new Date();
  const from = opt('--since')
    ? new Date(`${opt('--since')}T00:00:00+09:00`)
    : new Date(to.getTime() - Number(opt('--days') || 7) * 86_400_000);
  const s = summarize(readRecords(), { from, to });
  console.log(args.includes('--json') ? JSON.stringify(s, null, 2) : formatReport(s));
}
