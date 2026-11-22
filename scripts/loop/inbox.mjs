#!/usr/bin/env node
// オーナーの動画の受け口（Google Drive の「hub動画ポスト」フォルダ）。
// スマホの画面収録などをこのフォルダに入れるだけで、inbox ループが受け取り、Issue にし、
// 動画へのコメントで返事をして「受け取り済み」へ移す。設計は docs/loop/INBOX.md、指示書は docs/loop/prompts/inbox.md。
// スクショと一言は従来どおり Muse へ直接か Discord で渡す（この仕組みは動画だけ）。
//
//   node scripts/loop/inbox.mjs count            … 受け取り待ちの動画と、直ったことを知らせる待ちの件数（precheck 用）
//   node scripts/loop/inbox.mjs pull             … 受け取り待ちを非公開の置き場へ落とし、静止画を切り出し、一覧を JSON で出す
//   node scripts/loop/inbox.mjs reply <fileId> --body-file <f> [--issue N ...]
//                                                … 動画にコメントで返事をし、「受け取り済み」へ移す。Issue を控える
//   node scripts/loop/inbox.mjs followups        … 控えた Issue がすべて閉じた動画（直ったと知らせる相手）
//   node scripts/loop/inbox.mjs notify <fileId> --body-file <f>
//                                                … 直ったことを同じ動画へのコメントで知らせ、控えを済みにする
//
// アカウント・フォルダ ID はリポジトリに置かない（公開リポジトリのため）。
// ~/.config/kobe-student-hub/inbox.json に {"account": "..."} を置く。フォルダは名前で探す。
// 受け取るのは「このアカウントが持ち主」の動画だけ（ownedByMe）。フォルダが誰かと共有され、
// 他人がファイルを入れても読まない。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(homedir(), '.config/kobe-student-hub');
const BOX = join(ROOT, 'inbox');
const INDEX = join(BOX, 'index.json');
const REPO = process.env.KSH_REPO || 'junhat6/kobe-student-hub';
const FOLDER = 'hub動画ポスト';
const DONE = '受け取り済み'; // 返事をした動画の移し先（FOLDER の中）。オーナーは FOLDER の直下＝未処理と読める
const MAX = 3; // 1周で受け取る本数（動画は重いので少なめ）
const MAX_BYTES = 2 * 1024 ** 3;
const FRAMES = 24;

const config = (() => {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'inbox.json'), 'utf8'));
  } catch {
    return null;
  }
})();
if (!config?.account) {
  console.error('skip: ~/.config/kobe-student-hub/inbox.json（account）がありません');
  process.exit(1);
}

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
    ...opts,
  }).trim();
const has = (cmd) => {
  try {
    run('which', [cmd]);
    return true;
  } catch {
    return false;
  }
};
const drive = (...args) => run('gog', ['-a', config.account, '--no-input', 'drive', ...args]);
const driveJson = (...args) => JSON.parse(drive(...args, '-j'));
const q = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const findFolder = (name, parent) => {
  const query = [
    `name = '${q(name)}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "'me' in owners",
    'trashed = false',
    ...(parent ? [`'${parent}' in parents`] : []),
  ].join(' and ');
  return (driveJson('search', query, '--raw-query', '--no-all-drives').files || [])[0]?.id;
};
const folderId = () => {
  const id = findFolder(FOLDER);
  if (!id) {
    console.error(`skip: Drive に自分が持ち主の「${FOLDER}」フォルダがありません`);
    process.exit(1);
  }
  return id;
};
const doneFolderId = (parent) =>
  findFolder(DONE, parent) || driveJson('mkdir', DONE, '--parent', parent).file?.id;

const FIELDS = 'files(id,name,mimeType,size,createdTime,description,ownedByMe,videoMediaMetadata)';
const pending = (parent) =>
  (
    driveJson(
      'ls',
      '--parent',
      parent,
      '--no-all-drives',
      '--query',
      "mimeType contains 'video/' and trashed = false",
      '--sort',
      'createdTime',
      '--order',
      'asc',
      '--max',
      '50',
      '--fields',
      FIELDS,
    ).files || []
  ).filter((f) => f.ownedByMe === true);

const loadIndex = () => {
  try {
    return JSON.parse(readFileSync(INDEX, 'utf8'));
  } catch {
    return { videos: {} };
  }
};
const saveIndex = (index) => {
  mkdirSync(BOX, { recursive: true, mode: 0o700 });
  writeFileSync(INDEX, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
};

const issueClosed = (n) => {
  try {
    return (
      run('gh', ['issue', 'view', String(n), '-R', REPO, '--json', 'state', '-q', '.state']) ===
      'CLOSED'
    );
  } catch {
    return false;
  }
};
const followups = () =>
  Object.entries(loadIndex().videos)
    .filter(([, v]) => !v.notified && v.issues?.length && v.issues.every(issueClosed))
    .map(([fileId, v]) => ({ fileId, ...v }));

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const args = (name) =>
  process.argv.flatMap((a, i, all) => (a === name && all[i + 1] ? [all[i + 1]] : []));

// 返事は動画そのものへのコメント。スマホの Drive で動画を開くと横に読める。
const comment = (fileId, bodyFile) => {
  const body = `${readFileSync(bodyFile, 'utf8').trimEnd()}\n\n— ksh inbox`;
  drive('comments', 'create', fileId, body);
};

// 端末に iPhone の既定名（IMG_1234.MOV・画面収録 2026-…）が付いているなら、それは一言ではない
const defaultName = (name) =>
  /^(IMG_|RPReplay|ScreenRecording|Screen Recording|画面収録|VID_|PXL_)/i.test(name || '');

const probe = (path) => {
  try {
    const j = JSON.parse(
      run('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_type',
        '-of',
        'json',
        path,
      ]),
    );
    return {
      duration: Number(j.format?.duration) || 0,
      audio: (j.streams || []).some((s) => s.codec_type === 'audio'),
    };
  } catch {
    return { duration: 0, audio: false };
  }
};

// 話した言葉が入っていれば、手元に文字起こしの道具があるときだけ文字にする（無ければ null）
const transcribe = (dir, path) => {
  const wav = join(dir, 'audio.wav');
  try {
    if (!existsSync(wav))
      run('ffmpeg', ['-loglevel', 'error', '-i', path, '-vn', '-ac', '1', '-ar', '16000', wav], {
        timeout: 300_000,
      });
    if (has('mlx_whisper')) {
      run('mlx_whisper', [wav, '--language', 'ja', '--output-format', 'txt', '--output-dir', dir], {
        timeout: 600_000,
      });
      return readFileSync(join(dir, 'audio.txt'), 'utf8').trim() || null;
    }
    if (has('whisper-cli') && process.env.KSH_WHISPER_MODEL) {
      return (
        run('whisper-cli', ['-m', process.env.KSH_WHISPER_MODEL, '-l', 'ja', '-nt', '-f', wav], {
          timeout: 600_000,
        }) || null
      );
    }
  } catch {}
  return null;
};

const mode = process.argv[2];

if (mode === 'count') {
  const p = pending(folderId()).length;
  const f = followups().length;
  console.log(`受け取り待ちの動画 ${p} 本・直った知らせ待ち ${f} 件`);
  process.exit(p + f > 0 ? 0 : 1);
}

if (mode === 'pull') {
  const out = [];
  for (const f of pending(folderId()).slice(0, MAX)) {
    const dir = join(BOX, f.id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const base = {
      fileId: f.id,
      createdTime: f.createdTime,
      // 一言は Drive の「説明」欄か、端末の既定でないファイル名に書かれる
      note: [f.description, defaultName(f.name) ? '' : f.name].filter(Boolean).join('\n') || null,
    };
    if (Number(f.size) > MAX_BYTES) {
      out.push({
        ...base,
        error: `大きすぎて落としていない（${Math.round(Number(f.size) / 1024 ** 2)}MB）`,
      });
      continue;
    }
    const ext = (f.name || '').match(/\.\w+$/)?.[0] || '.mp4';
    const path = join(dir, `video${ext.toLowerCase()}`);
    try {
      if (!existsSync(path)) drive('download', f.id, '--out', path);
    } catch {
      out.push({ ...base, error: '落とせなかった' });
      continue;
    }
    // 長さに合わせて間隔を決め、最大 24 枚の静止画にして agent が Read で見られるようにする
    const { duration, audio } = probe(path);
    const every = Math.max(1, Math.ceil(duration / FRAMES));
    const frames = join(dir, 'frames');
    mkdirSync(frames, { recursive: true });
    if (!readdirSync(frames).length) {
      try {
        run(
          'ffmpeg',
          [
            '-loglevel',
            'error',
            '-i',
            path,
            '-vf',
            `fps=1/${every},scale=720:-2`,
            '-frames:v',
            String(FRAMES),
            join(frames, '%02d.png'),
          ],
          { timeout: 300_000 },
        );
      } catch {}
    }
    const transcript = audio ? transcribe(dir, path) : null;
    writeFileSync(
      join(dir, 'meta.json'),
      `${JSON.stringify({ ...base, duration, audio, transcript }, null, 2)}\n`,
      { mode: 0o600 },
    );
    out.push({
      ...base,
      path,
      duration: Math.round(duration),
      frames,
      framesEverySeconds: every,
      audio,
      transcript,
      earlier: loadIndex().videos[f.id] || null,
    });
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

if (mode === 'reply') {
  const fileId = process.argv[3];
  const bodyFile = arg('--body-file');
  if (!fileId || !bodyFile) {
    console.error('usage: inbox.mjs reply <fileId> --body-file <f> [--issue N ...]');
    process.exit(2);
  }
  const parent = folderId();
  if (!pending(parent).some((f) => f.id === fileId)) {
    console.error('受け取り待ちの動画ではありません（別の持ち主か、もう受け取り済み）');
    process.exit(2);
  }
  comment(fileId, bodyFile);
  drive('move', fileId, '--parent', doneFolderId(parent));
  const index = loadIndex();
  const v = (index.videos[fileId] ||= { issues: [], notified: false });
  v.receivedAt = new Date().toISOString();
  const issues = args('--issue').map(Number).filter(Boolean);
  if (issues.length) {
    v.issues = [...new Set([...v.issues, ...issues])];
    v.notified = false;
  }
  saveIndex(index);
  console.log(
    `返事をして「${DONE}」へ移しました（控えた Issue: ${v.issues.join(', ') || 'なし'}）`,
  );
  process.exit(0);
}

if (mode === 'followups') {
  console.log(JSON.stringify(followups(), null, 2));
  process.exit(0);
}

if (mode === 'notify') {
  const fileId = process.argv[3];
  const bodyFile = arg('--body-file');
  const index = loadIndex();
  if (!fileId || !bodyFile || !index.videos[fileId]) {
    console.error('usage: inbox.mjs notify <fileId> --body-file <f>（followups に出た fileId）');
    process.exit(2);
  }
  comment(fileId, bodyFile);
  index.videos[fileId].notified = true;
  saveIndex(index);
  console.log('直ったことを知らせました');
  process.exit(0);
}

console.error('usage: inbox.mjs count|pull|reply|followups|notify');
process.exit(2);
