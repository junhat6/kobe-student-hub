// Regenerates the PNG/ICO site icons from public/favicon.svg (the single source).
// Run: node scripts/generate-icons.mjs   (uses the Playwright Chromium already used by e2e)
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const svg = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
async function render(size, { padded = false } = {}) {
  // Maskable/apple icons get a full-bleed square so platform masks never show a transparent edge.
  const background = padded ? '#1659c7' : 'transparent';
  const inner = padded ? Math.round(size * 0.8) : size;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:${background}">` +
      `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${inner}" height="${inner}"></body></html>`,
  );
  return page.screenshot({ omitBackground: !padded, type: 'png' });
}
const out = (name) => new URL('../public/' + name, import.meta.url);
await writeFile(out('apple-touch-icon.png'), await render(180, { padded: true }));
await writeFile(out('icon-192.png'), await render(192));
await writeFile(out('icon-512.png'), await render(512));
await writeFile(out('icon-maskable-512.png'), await render(512, { padded: true }));
// favicon.ico with embedded PNG frames (supported by every current browser).
const frames = [];
for (const s of [16, 32, 48]) frames.push(await render(s)); // one page: render sequentially
const header = Buffer.alloc(6 + 16 * frames.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
frames.forEach((png, i) => {
  const size = [16, 32, 48][i];
  const at = 6 + 16 * i;
  header.writeUInt8(size, at);
  header.writeUInt8(size, at + 1);
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(png.length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += png.length;
});
await writeFile(out('favicon.ico'), Buffer.concat([header, ...frames]));
await browser.close();
