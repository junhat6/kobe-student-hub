import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { EDITORIAL_TASTE } from '../src/agent/editorial-taste';
import { buildWritingRequest } from '../src/agent/article-format';
import { writingGuide } from '../worker/agent/guide';

// The editor loop rewrites EDITORIAL_TASTE; every writing path must carry the same lines.
it('carries the editorial taste into every writing path', () => {
  const lines = EDITORIAL_TASTE.split('\n');
  expect(lines.length).toBeGreaterThan(0);
  const skill = readFileSync('public/agent-kit/ksh-article/SKILL.md', 'utf8');
  for (const text of [
    buildWritingRequest({ title: '', body: '' }, 'https://hub.example'),
    writingGuide('https://hub.example'),
    skill,
  ])
    for (const line of lines) expect(text).toContain(line);
});

it('keeps each taste line abstract and sourced', () => {
  for (const line of EDITORIAL_TASTE.split('\n')) {
    expect(line).toMatch(/^- .+（(オーナー指示|レビュー \d+件) \d{4}-\d{2}-\d{2}）$/);
    // No URLs, mentions or quoted review notes.
    expect(line).not.toMatch(/https?:|@|「[^」]{30,}」/);
  }
});
