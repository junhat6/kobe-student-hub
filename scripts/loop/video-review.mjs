#!/usr/bin/env node
// オーナーが実機で撮った hub の動作確認動画を、Antigravity CLI（agy）にレビューさせる。
// 流れと理由は docs/loop/prompts/video-review.md と docs/DECISIONS.md（2026-11-22 動画レビュー）。
//
//   ksh-video-review                       … ~/video-inbox のまだ見ていない動画を全部レビューする（Muse が「上げた」を受けて叩く）
//   ksh-video-review <動画> [--note "…"]   … 1本だけ。--note はオーナーが確かめたかったこと
//   ksh-video-review --ask <動画> "質問"   … 同じ Antigravity の会話で追加の質問に答えさせる
//   ksh-video-review --issues <動画>       … レビューの issue_drafts を公開 Issue（loop:ux）にする。オーナーが「Issue にして」と言ったときだけ
//   ksh-video-review --status              … inbox の動画と、レビュー済みかどうかを表示する
//
// ksh-video-review（~/.local/bin、元は scripts/loop/ksh-video-review.sh）は origin/main のこのファイルと
// 指示書・ux-rubric を一時ファイルに書き出して実行する。相対 import をしない。
//
// 結果は動画の隣に <動画>.review.md（人が読む）と <動画>.review.json（機械が読む）として置く。
// 標準出力の最後に、Muse がそのままオーナーへ返せる短い要約を出す。
// 終了コード：0 = 全部レビューできた／見る動画が無い、1 = 失敗があった、2 = 使い方の誤り。
import { spawn, execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  linkSync,
  copyFileSync,
  rmSync,
  openSync,
  closeSync,
  unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = homedir();
const INBOX = resolve(process.env.KSH_VIDEO_INBOX || join(HOME, 'video-inbox'));
const WORK = join(INBOX, '.work');
const REPO = process.env.KSH_REPO || join(HOME, 'ghq/github.com/junhat6/kobe-student-hub');
const MODELS = (process.env.KSH_VIDEO_MODELS || 'gemini-4-argon-high,gemini-3.8-flash-high').split(
  ',',
);
const TIMEOUT_S = Number(process.env.KSH_VIDEO_TIMEOUT_SECONDS || 1200);
// Drive が元なので、手元のコピーは期限で消す（Mac mini の容量を守る）
const KEEP_DAYS = Number(process.env.KSH_VIDEO_KEEP_DAYS || 30);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.3gp', '.mkv', '.avi']);
// これを超える・H.264 でない・長辺 1280px 超の動画は、720px・30fps の H.264 に縮めてから渡す（送る量と待ち時間を減らす。音声は残す）
const PROXY_OVER_BYTES = 40 * 1024 * 1024;
// agy の read_file は 1 ファイル 100MB で拒む（loop-infra-cd が 135MB で確認、50MB は通る）
const AGY_MAX_BYTES = 95 * 1024 * 1024;
// headless の agy はコマンドを自動で拒むが、試して空のまま終わることがあるので、読むことだけを許し、コマンドは明示的に拒む
const AGY_SETTINGS = JSON.stringify({
  permissions: { allow: ['read_file(*)'], deny: ['command(*)'] },
});

const here = dirname(fileURLToPath(import.meta.url));

function usage(msg) {
  if (msg) console.error(msg);
  console.error(
    '使い方: ksh-video-review [<動画>…] [--note "…"] | --ask <動画> "質問" | --issues <動画> | --status',
  );
  process.exit(2);
}

function parseArgs(argv) {
  const o = { videos: [], note: '', mode: 'review' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) usage(`${a} の値がありません`);
      return argv[++i];
    };
    if (a === '--note') o.note = next();
    else if (a === '--prompt-file') o.promptFile = next();
    else if (a === '--rubric-file') o.rubricFile = next();
    else if (a === '--ask') {
      o.mode = 'ask';
      o.videos.push(next());
      o.question = next();
    } else if (a === '--issues') {
      o.mode = 'issues';
      o.videos.push(next());
    } else if (a === '--status') o.mode = 'status';
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '-h' || a === '--help') usage();
    else if (a.startsWith('--')) usage(`知らないオプション: ${a}`);
    else o.videos.push(a);
  }
  return o;
}

// ---- 伏せ字：出力する全部の文字列に1か所で掛ける（AGENTS.md の学び #196） ----
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
function mask(v) {
  if (typeof v === 'string')
    return v
      .replace(EMAIL, '[メール]')
      .split(HOME)
      .join('~')
      .split(basename(HOME))
      .join('[ユーザー]');
  if (Array.isArray(v)) return v.map(mask);
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mask(x)]));
  return v;
}

// inbox の外（Orca チャットの添付など）の動画は inbox に写してから見る。結果を1か所に集めるため
function resolveVideo(p, { copyIn = false } = {}) {
  const abs = existsSync(p) ? resolve(p) : join(INBOX, basename(p));
  if (!existsSync(abs)) usage(`動画が見つかりません: ${basename(p)}`);
  if (!copyIn || dirname(abs) === INBOX) return abs;
  const dest = join(INBOX, basename(abs));
  if (!existsSync(dest)) copyFileSync(abs, dest);
  return dest;
}

const reviewJsonPath = (v) => `${v}.review.json`;
const reviewMdPath = (v) => `${v}.review.md`;
const jobDir = (v) => join(WORK, basename(v));

function readReview(v) {
  try {
    return JSON.parse(readFileSync(reviewJsonPath(v), 'utf8'));
  } catch {
    return null;
  }
}

function listVideos() {
  if (!existsSync(INBOX)) return [];
  return readdirSync(INBOX)
    .filter((f) => !f.startsWith('.') && VIDEO_EXT.has(extname(f).toLowerCase()))
    .map((f) => join(INBOX, f))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
}

function git(args) {
  try {
    return execFileSync('git', ['-C', REPO, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function loadText(explicit, repoPath) {
  if (explicit) return readFileSync(explicit, 'utf8');
  const local = resolve(here, '../..', repoPath);
  if (existsSync(local)) return readFileSync(local, 'utf8');
  const fromMain = git(['show', `origin/main:${repoPath}`]);
  if (fromMain) return fromMain;
  throw new Error(`${repoPath} を読めません`);
}

function probe(file) {
  try {
    const out = execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_type,codec_name,width,height',
        '-of',
        'json',
        file,
      ],
      { encoding: 'utf8' },
    );
    const j = JSON.parse(out);
    const v = (j.streams || []).find((s) => s.codec_type === 'video') || {};
    return {
      duration: Number(j.format?.duration || 0),
      codec: v.codec_name || '',
      width: v.width || 0,
      height: v.height || 0,
      audio: (j.streams || []).some((s) => s.codec_type === 'audio'),
    };
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Muse がまだ書き込み中の動画をつかまないように、3 秒あけて大きさが変わらないことを確かめる
async function isStable(file) {
  const a = statSync(file).size;
  await sleep(3000);
  return a > 0 && statSync(file).size === a;
}

function lock(v) {
  mkdirSync(WORK, { recursive: true });
  const p = join(WORK, `${basename(v)}.lock`);
  try {
    const fd = openSync(p, 'wx');
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
  } catch {
    const pid = Number(readFileSync(p, 'utf8'));
    try {
      process.kill(pid, 0);
      return null; // 別のレビューが動いている
    } catch {
      writeFileSync(p, String(process.pid)); // 止まった実行の残り
    }
  }
  return () => {
    try {
      unlinkSync(p);
    } catch {}
  };
}

// agy に見せるのは、動画1本だけが入った作業フォルダ。ほかのファイルを読ませない・書かせないため
function prepareJob(video, info) {
  const dir = jobDir(video);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const size = statSync(video).size;
  const needsProxy =
    info &&
    (size > PROXY_OVER_BYTES || info.codec !== 'h264' || Math.max(info.width, info.height) > 1280);
  let name = `video${extname(video).toLowerCase()}`;
  if (needsProxy) {
    name = 'video.mp4';
    execFileSync(
      'ffmpeg',
      [
        '-loglevel',
        'error',
        '-y',
        '-i',
        video,
        '-vf',
        "fps=30,scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)'",
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '28',
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        '-movflags',
        '+faststart',
        join(dir, name),
      ],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
  } else {
    try {
      linkSync(video, join(dir, name));
    } catch {
      copyFileSync(video, join(dir, name));
    }
  }
  if (statSync(join(dir, name)).size > AGY_MAX_BYTES)
    throw new Error(
      '縮めても 95MB を超えます（agy は 1 ファイル 100MB で読むのを拒む）。動画を短く分けて置き直してください',
    );
  return { dir, name, proxied: Boolean(needsProxy) };
}

const SCHEMA = {
  type: 'object',
  required: ['verdict', 'summary', 'findings', 'uncertain', 'issue_drafts'],
  properties: {
    verdict: { type: 'string', enum: ['問題なし', '要修正', '止まる'] },
    summary: {
      type: 'string',
      description: 'オーナーへの返事。3行以内。何を確かめた動画か、結論、いちばん大事な所見',
    },
    walkthrough: { type: 'string', description: '動画で操作した流れ。時刻つきで短く' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'time', 'screen', 'observed', 'expected', 'viewpoint'],
        properties: {
          severity: { type: 'string', enum: ['S1', 'S2', 'S3'] },
          time: { type: 'string', description: 'mm:ss または mm:ss-mm:ss' },
          screen: { type: 'string', description: '画面（例: 記事を書く /drafts）' },
          observed: { type: 'string', description: '動画で起きたこと。個人情報の値は書かない' },
          expected: { type: 'string' },
          viewpoint: {
            type: 'string',
            description: '指示書の「見るもの」の番号と名前、または ux-rubric の原則・観点の番号',
          },
          suggestion: { type: 'string', description: '直し方の案（任意・決めつけない）' },
          device_only: { type: 'boolean', description: '実機でしか出ないと考えられるなら true' },
        },
      },
    },
    uncertain: {
      type: 'array',
      items: { type: 'string' },
      description: '動画からは確かに言えないこと・推測',
    },
    issue_drafts: {
      type: 'array',
      description:
        'S1・S2 の所見から作る公開 Issue の下書き。公開リポジトリにそのまま載せられる文だけ',
      items: {
        type: 'object',
        required: ['title', 'body', 'severity'],
        properties: {
          title: { type: 'string', description: '[S2][実機][モバイル] で始める' },
          body: { type: 'string' },
          severity: { type: 'string', enum: ['S1', 'S2', 'S3'] },
        },
      },
    },
  },
};

function runAgy(args, cwd) {
  return new Promise((res) => {
    const child = spawn('agy', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill('SIGTERM'), (TIMEOUT_S + 60) * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      res({ code, out, err });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      res({ code: -1, out, err: String(e) });
    });
  });
}

function parseStructured(text) {
  if (!text) return null;
  const t = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {}
    }
  }
  return null;
}

function buildPrompt({ instructions, rubric, video, job, info, note, mainSha, release }) {
  const facts = [
    `動画ファイル: ${job.name}（このフォルダにある1本だけ。元の名前: ${basename(video)}）`,
    info
      ? `長さ: ${info.duration.toFixed(1)} 秒、${info.width}x${info.height}、音声: ${info.audio ? 'あり（オーナーのナレーションが入っているかもしれない）' : 'なし'}${job.proxied ? '（見やすいように 720px に縮めたもの）' : ''}`
      : '長さ・解像度: 不明',
    `撮影対象: 本番の hub（スマホ実機）。本番の版: ${release || '不明'}、main: ${mainSha || '不明'}`,
    note ? `オーナーのメモ（確かめたかったこと）: ${note}` : 'オーナーのメモ: なし',
  ];
  return [
    instructions.trim(),
    '',
    rubric.trim(),
    '',
    '---',
    '## 今回の動画',
    ...facts.map((f) => `- ${f}`),
    '',
    'コマンドは実行せず、動画を直接見てください。ファイルは作らないでください。',
    '答えは指定された JSON スキーマの形だけで返してください（日本語）。',
  ].join('\n');
}

function renderMarkdown(r) {
  const L = [];
  L.push(`# 動画レビュー: ${r.video}`);
  L.push('');
  L.push(`- 結論: **${r.verdict}**`);
  L.push(`- レビュー: ${r.reviewed_at}（${r.model}、会話 ${r.conversation_id || '不明'}）`);
  L.push(`- 本番の版: ${r.release || '不明'} / main: ${r.main_sha || '不明'}`);
  if (r.note) L.push(`- オーナーのメモ: ${r.note}`);
  L.push('');
  L.push('## 要約');
  L.push('');
  L.push(r.summary || '');
  if (r.walkthrough) {
    L.push('');
    L.push('## 動画の流れ');
    L.push('');
    L.push(r.walkthrough);
  }
  L.push('');
  L.push('## 所見');
  L.push('');
  if (!r.findings?.length) L.push('なし');
  for (const f of r.findings || []) {
    L.push(`### [${f.severity}] ${f.time} ${f.screen}${f.device_only ? '（実機）' : ''}`);
    L.push('');
    L.push(`- 起きたこと: ${f.observed}`);
    L.push(`- 期待: ${f.expected}`);
    L.push(`- 観点: ${f.viewpoint}`);
    if (f.suggestion) L.push(`- 直し方の案: ${f.suggestion}`);
    L.push('');
  }
  if (r.uncertain?.length) {
    L.push('## 動画からは言い切れないこと');
    L.push('');
    for (const u of r.uncertain) L.push(`- ${u}`);
    L.push('');
  }
  if (r.issue_drafts?.length) {
    L.push(
      '## Issue の下書き（オーナーが「Issue にして」と言ったら `ksh-video-review --issues` で作る）',
    );
    L.push('');
    for (const d of r.issue_drafts) L.push(`- [${d.severity}] ${d.title}`);
    L.push('');
  }
  return L.join('\n');
}

function shortReport(r) {
  const counts = ['S1', 'S2', 'S3']
    .map((s) => `${s} ${(r.findings || []).filter((f) => f.severity === s).length}`)
    .join('・');
  return [
    `【${r.video}】${r.verdict}（${counts}）`,
    r.summary,
    `詳細: ${reviewMdPath(join(INBOX, r.video)).split(HOME).join('~')}`,
  ].join('\n');
}

async function review(video, opts, ctx) {
  const name = basename(video);
  if (!(await isStable(video))) {
    console.log(
      `【${name}】まだ書き込み中のようなので飛ばしました。置き終わってからもう一度実行してください。`,
    );
    return 'skipped';
  }
  const unlock = lock(video);
  if (!unlock) {
    console.log(`【${name}】別のレビューが実行中です。`);
    return 'skipped';
  }
  try {
    const info = probe(video);
    let job;
    try {
      job = prepareJob(video, info);
    } catch (e) {
      const msg = mask(String(e.message || e).slice(0, 300));
      writeFileSync(
        reviewJsonPath(video),
        JSON.stringify(
          { video: name, status: 'failed', reviewed_at: new Date().toISOString(), error: msg },
          null,
          2,
        ),
      );
      console.log(`【${name}】動画を準備できませんでした（${msg}）。`);
      return 'failed';
    }
    const noteFile = `${video}.note.txt`;
    const note = opts.note || (existsSync(noteFile) ? readFileSync(noteFile, 'utf8').trim() : '');
    const prompt = buildPrompt({ ...ctx, video, job, info, note });
    writeFileSync(join(job.dir, 'schema.json'), JSON.stringify(SCHEMA));
    if (opts.dryRun) {
      console.log(prompt);
      return 'dry-run';
    }
    let result = null;
    let lastError = '';
    for (const model of MODELS) {
      const t0 = Date.now();
      const { code, out, err } = await runAgy(
        [
          '-p',
          prompt,
          '--model',
          model,
          '--output-format',
          'json',
          '--json-schema',
          JSON.stringify(SCHEMA),
          '--print-timeout',
          `${TIMEOUT_S}s`,
          '--sandbox',
          '--settings',
          AGY_SETTINGS,
        ],
        job.dir,
      );
      let meta = null;
      try {
        meta = JSON.parse(out);
      } catch {}
      const body = parseStructured(
        meta?.structured_output ? JSON.stringify(meta.structured_output) : meta?.response,
      );
      if (code === 0 && meta?.status === 'SUCCESS' && body?.verdict) {
        result = {
          ...body,
          model,
          conversation_id: meta.conversation_id,
          elapsed_s: Math.round((Date.now() - t0) / 1000),
        };
        break;
      }
      lastError = `${model}: rc=${code} ${meta?.status || ''} ${(err || out).slice(0, 400)}`.trim();
      console.error(`【${name}】${model} で失敗。次のモデルを試します。`);
    }
    const base = {
      video: name,
      reviewed_at: new Date().toISOString(),
      note,
      main_sha: ctx.mainSha,
      release: ctx.release,
      duration_s: info?.duration ?? null,
    };
    if (!result) {
      const failed = mask({ ...base, status: 'failed', error: lastError });
      writeFileSync(reviewJsonPath(video), JSON.stringify(failed, null, 2));
      console.log(
        `【${name}】レビューに失敗しました（${failed.error.slice(0, 200)}）。次に実行したときにやり直します。`,
      );
      return 'failed';
    }
    const r = mask({ ...base, status: 'done', ...result });
    writeFileSync(reviewJsonPath(video), JSON.stringify(r, null, 2));
    writeFileSync(reviewMdPath(video), renderMarkdown(r));
    console.log(shortReport(r));
    return 'done';
  } finally {
    unlock();
  }
}

async function ask(video, question) {
  const r = readReview(video);
  if (!r?.conversation_id) usage('先にレビューしてください（会話が見つかりません）');
  const dir = jobDir(video);
  if (!existsSync(dir)) usage('作業フォルダが消えています。もう一度レビューしてください');
  const { code, out, err } = await runAgy(
    [
      '--conversation',
      r.conversation_id,
      '-p',
      `${question}\n\nコマンドは実行せず、ファイルは作らず、動画の時刻を付けて日本語で短く答えてください。個人情報の値は書かないでください。`,
      '--print-timeout',
      `${TIMEOUT_S}s`,
      '--sandbox',
      '--settings',
      AGY_SETTINGS,
    ],
    dir,
  );
  if (code !== 0 || !out.trim()) {
    console.log(`追加の質問に失敗しました: ${mask((err || out).slice(0, 300))}`);
    process.exit(1);
  }
  const answer = mask(out.trim());
  writeFileSync(
    reviewMdPath(video),
    `${readFileSync(reviewMdPath(video), 'utf8')}\n## 追加の質問（${new Date().toISOString()}）\n\n> ${mask(question)}\n\n${answer}\n`,
  );
  console.log(answer);
}

function fileIssues(video) {
  const r = readReview(video);
  if (r?.status !== 'done') usage('レビュー済みの動画ではありません');
  if (r.issues_filed?.length) {
    console.log(`作成済みです: ${r.issues_filed.join(' ')}`);
    return;
  }
  const prio = { S1: 'P0', S2: 'P1', S3: 'P2' };
  const urls = [];
  for (const d of r.issue_drafts || []) {
    const body = mask(
      `${d.body}\n\n---\n出典: オーナーがスマホ実機で撮った動作確認動画のレビュー（動画は非公開。${r.reviewed_at.slice(0, 10)}、本番 ${r.release || '不明'}）。\nAntigravity による動画の読み取りなので、直す前に画面で再現を確かめる。`,
    );
    const url = execFileSync(
      'gh',
      [
        'issue',
        'create',
        '--title',
        mask(d.title),
        '--body',
        body,
        '--label',
        'loop:ux',
        '--label',
        prio[d.severity] || 'P2',
      ],
      { cwd: REPO, encoding: 'utf8' },
    ).trim();
    urls.push(url);
    console.log(url);
  }
  writeFileSync(reviewJsonPath(video), JSON.stringify({ ...r, issues_filed: urls }, null, 2));
  if (!urls.length) console.log('Issue の下書きはありません。');
}

function prune() {
  const limit = Date.now() - KEEP_DAYS * 86400_000;
  for (const v of listVideos()) {
    const r = readReview(v);
    if (r?.status === 'done' && statSync(v).mtimeMs < limit) {
      for (const p of [v, reviewJsonPath(v), reviewMdPath(v), `${v}.note.txt`])
        rmSync(p, { force: true });
      rmSync(jobDir(v), { recursive: true, force: true });
    }
  }
}

function status() {
  const vids = listVideos();
  if (!vids.length) return console.log('video-inbox に動画はありません。');
  for (const v of vids) {
    const r = readReview(v);
    console.log(
      `${r?.status === 'done' ? `済 ${r.verdict}` : r?.status === 'failed' ? '失敗' : '未'}\t${basename(v)}`,
    );
  }
}

const opts = parseArgs(process.argv.slice(2));
mkdirSync(INBOX, { recursive: true });
if (opts.mode === 'status') status();
else if (opts.mode === 'ask') await ask(resolveVideo(opts.videos[0]), opts.question);
else if (opts.mode === 'issues') fileIssues(resolveVideo(opts.videos[0]));
else {
  prune();
  const targets = opts.videos.length
    ? opts.videos.map((v) => resolveVideo(v, { copyIn: true }))
    : listVideos().filter((v) => readReview(v)?.status !== 'done');
  if (!targets.length) {
    console.log('レビューする動画はありません（video-inbox は空か、全部レビュー済みです）。');
    process.exit(0);
  }
  if (opts.note && targets.length > 1) usage('--note は動画を1本指定したときだけ使えます');
  git(['fetch', '-q', 'origin', 'main', 'release']);
  const ctx = {
    instructions: loadText(opts.promptFile, 'docs/loop/prompts/video-review.md'),
    rubric: loadText(opts.rubricFile, 'docs/loop/ux-rubric.md'),
    mainSha: git(['rev-parse', '--short', 'origin/main']),
    release: git(['describe', '--tags', '--always', 'origin/release']),
  };
  let failed = 0;
  for (const v of targets) if ((await review(v, opts, ctx)) === 'failed') failed++;
  process.exit(failed ? 1 : 0);
}
