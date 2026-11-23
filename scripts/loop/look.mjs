#!/usr/bin/env node
// エージェントが hub の画面・挙動を自分で撮る。PC(1280×800) とモバイル(390×844) の
// スクリーンショット（全体）と、--video なら操作の録画（webm）を .look/<時刻>/ に置く。
// 撮ったものは自分で見る（画像は Read で読める）か、npm run look:review で Antigravity に見せる。
// 流れと使い分けは docs/loop/LOOK.md。
//
// 使い方:
//   npm run look -- / /works                     # ローカル preview（npm run preview, :8787）
//   npm run look -- --base editor /drafts        # 架空アカウントの editor:preview（:8788）
//   npm run look -- --base prod /                # 本番を未ログインで見るだけ
//   npm run look -- --video --steps tmp/steps.mjs /works
//     steps.mjs は `export default async (page, { path, viewport }) => { ... }`。
//     撮影前に呼ばれ、クリック・入力などの操作が録画に残る。
//   --only pc|mobile で片方だけ、--out <dir> で置き場所を変える。
import { chromium } from 'playwright';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// 撮ってよい相手はこの4つだけ。本番はログインしない（Cookie を持たない新しい context で開く）。
// 巡回は本番でオーナーのアカウントにログインしてよいが（2026-11-23 DECISIONS）、その確認は
// Claude in Chrome で行い、この道具には載せない。ここで撮ったものは look:review で外部へ送られ、
// 公開 Issue に貼られる前提だから。
// 任意の URL を許さないのは、利用者のログイン状態や他人のサイトを撮って外部（Antigravity）へ
// 送る経路を作らないため。参考アプリは人が撮って渡す（LOOK.md の「人が渡す」）。
const BASES = {
  local: 'http://127.0.0.1:8787',
  editor: 'https://127.0.0.1:8788',
  session: 'https://127.0.0.1:8790',
  prod: 'https://hub.junhat6.com',
};
const VIEWPORTS = {
  pc: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};

const args = process.argv.slice(2);
const opt = { base: 'local', video: false, steps: null, out: null, only: null };
const paths = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--video') opt.video = true;
  else if (a === '--base') opt.base = args[++i];
  else if (a === '--steps') opt.steps = args[++i];
  else if (a === '--out') opt.out = args[++i];
  else if (a === '--only') opt.only = args[++i];
  else if (a.startsWith('--')) fail(`知らないオプション: ${a}`);
  else paths.push(a);
}
if (!BASES[opt.base]) fail(`--base は ${Object.keys(BASES).join(' / ')} のどれか`);
if (opt.only && !VIEWPORTS[opt.only]) fail('--only は pc か mobile');
if (paths.length === 0) paths.push('/');
for (const p of paths) if (!p.startsWith('/')) fail(`パスは / で始める（URL は渡さない）: ${p}`);

const origin = BASES[opt.base];
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = resolve(opt.out ?? join('.look', stamp));
mkdirSync(out, { recursive: true });
const steps = opt.steps ? (await import(pathToFileURL(resolve(opt.steps)).href)).default : null;

const browser = await chromium.launch();
const manifest = { origin: opt.base, capturedAt: new Date().toISOString(), shots: [] };
try {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    if (opt.only && opt.only !== name) continue;
    for (const path of paths) {
      const slug = `${path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'}-${name}`;
      const context = await browser.newContext({
        viewport,
        isMobile: name === 'mobile',
        hasTouch: name === 'mobile',
        deviceScaleFactor: name === 'mobile' ? 2 : 1,
        ignoreHTTPSErrors: opt.base !== 'prod',
        locale: 'ja-JP',
        ...(opt.video ? { recordVideo: { dir: out, size: viewport } } : {}),
      });
      const page = await context.newPage();
      const problems = [];
      page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      page.on('response', (r) => r.status() >= 500 && problems.push(`${r.status()} ${r.url()}`));
      const response = await page.goto(new URL(path, origin).href, { waitUntil: 'networkidle' });
      if (steps) await steps(page, { path, viewport: name });
      await page.waitForTimeout(300);
      const png = join(out, `${slug}.png`);
      await page.screenshot({ path: png, fullPage: true });
      const overflowX = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      const video = page.video();
      await context.close();
      let webm = null;
      if (video) {
        webm = join(out, `${slug}.webm`);
        renameSync(await video.path(), webm);
      }
      manifest.shots.push({
        path,
        viewport: name,
        status: response?.status() ?? null,
        png,
        webm,
        overflowX,
        problems: problems.slice(0, 20),
      });
      const flags = [overflowX && '横はみ出し', problems.length && `問題${problems.length}件`]
        .filter(Boolean)
        .join(' ');
      console.log(
        `${name.padEnd(6)} ${path}  ${response?.status() ?? '-'}  ${png}${webm ? `  ${webm}` : ''}${flags ? `  ⚠ ${flags}` : ''}`,
      );
    }
  }
} finally {
  await browser.close();
}
writeFileSync(join(out, 'look.json'), JSON.stringify(manifest, null, 2));
console.log(`\n${out}`);
console.log(`次: 画像は Read で見る / 動画・独立した目は npm run look:review -- ${out}`);

function fail(message) {
  console.error(message);
  process.exit(2);
}
