import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { EDITORIAL_TASTE } from '../src/agent/editorial-taste';
import { buildWritingRequest } from '../src/agent/article-format';
import { writingGuide } from '../worker/agent/guide';

const TASTE_HEADING = '良いと感じられる記事（運営のレビューから更新）';

/** The bullet lines of the taste section: from its heading to the first non-bullet after them. */
function tasteSection(text: string) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^#+ /.test(line) && line.includes(TASTE_HEADING));
  expect(start, 'taste heading').toBeGreaterThanOrEqual(0);
  // Only one taste section per path, so an old copy cannot linger beside the new one.
  expect(lines.filter((line) => line.includes(TASTE_HEADING))).toHaveLength(1);
  const bullets: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#+ /.test(line)) break;
    if (line.startsWith('- ')) bullets.push(line);
    else if (bullets.length) break;
  }
  return bullets.join('\n');
}

// The editor loop rewrites EDITORIAL_TASTE; every writing path must carry exactly the same lines,
// so a line the loop removes does not linger in one path (toContain alone would miss that).
it('carries exactly the editorial taste into every writing path', () => {
  expect(EDITORIAL_TASTE.split('\n').length).toBeGreaterThan(0);
  const paths = {
    'request (empty draft)': buildWritingRequest({ title: '', body: '' }, 'https://hub.example'),
    'request (with draft)': buildWritingRequest(
      { title: '下書き', body: '本文' },
      'https://hub.example',
    ),
    'MCP get_writing_guide': writingGuide('https://hub.example'),
    'SKILL.md': readFileSync('public/agent-kit/ksh-article/SKILL.md', 'utf8'),
  };
  for (const [name, text] of Object.entries(paths))
    expect(tasteSection(text), name).toBe(EDITORIAL_TASTE);
});

it('keeps each taste line abstract and sourced', () => {
  for (const line of EDITORIAL_TASTE.split('\n')) {
    expect(line).toMatch(/^- .+（(オーナー指示|レビュー \d+件) \d{4}-\d{2}-\d{2}）$/);
    // No URLs, mentions or quoted review notes.
    expect(line).not.toMatch(/https?:|@|「[^」]{30,}」/);
  }
});
