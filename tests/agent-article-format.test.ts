import { describe, expect, it } from 'vitest';
import {
  ARTICLE_FORMAT_EXAMPLE,
  articleForAgent,
  buildWritingRequest,
  parseAgentArticle,
} from '../src/agent/article-format';

describe('parseAgentArticle', () => {
  it('reads the documented example into title, body and publication fields', () => {
    const result = parseAgentArticle(ARTICLE_FORMAT_EXAMPLE);
    expect(result.title).toBe('初めてのチーム制作で、GitHub のプルリクを毎日出してわかったこと');
    expect(result.body.startsWith('## なぜ書くのか')).toBe(true);
    expect(result.metadata.tags).toEqual(['GitHub', 'チーム制作', 'C言語']);
    expect(result.metadata.minutes).toBe(6);
    expect(result.metadata.audience).toContain('1〜2年生');
    expect(result.warnings).toEqual([]);
  });

  it('accepts Japanese keys, YAML lists, block scalars and full-width colons', () => {
    const result = parseAgentArticle(
      [
        '---',
        'タイトル： 型で守る',
        '概要: |',
        '  一行目',
        '  二行目',
        'タグ:',
        '  - TypeScript',
        '  - "#設計"',
        '前提知識: なし',
        'unknown: ignored',
        '---',
        '',
        '本文',
      ].join('\n'),
    );
    expect(result.title).toBe('型で守る');
    expect(result.metadata.summary).toBe('一行目 二行目');
    expect(result.metadata.tags).toEqual(['TypeScript', '設計']);
    expect(result.metadata.prerequisite).toBe('なし');
    expect(result.body).toBe('本文\n');
  });

  it('uses the first heading as the title when there is no front matter, and drops it from the body', () => {
    const result = parseAgentArticle('# 見出しタイトル\n\n本文です。\n');
    expect(result.title).toBe('見出しタイトル');
    expect(result.body).toBe('本文です。\n');
    expect(result.warnings).toContain('概要がありません。公開するときに入力してください。');
  });

  it('keeps a body heading that differs from the front matter title', () => {
    const result = parseAgentArticle('---\ntitle: A\n---\n# B\n\ntext');
    expect(result.title).toBe('A');
    expect(result.body).toBe('# B\n\ntext\n');
  });

  it('clips and drops values the server would reject instead of failing', () => {
    const long = 'あ'.repeat(260);
    const result = parseAgentArticle(
      [
        '---',
        `title: ${long}`,
        `summary: ${'い'.repeat(320)}`,
        'tags: [a, b, a, c, d, e, f, ' + 'x'.repeat(30) + ']',
        'minutes: 999',
        '---',
        'body',
      ].join('\n'),
    );
    expect(Array.from(result.title)).toHaveLength(200);
    expect(Array.from(result.metadata.summary)).toHaveLength(300);
    expect(result.metadata.tags).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(result.metadata.minutes).toBeNull();
    expect(result.warnings.length).toBeGreaterThanOrEqual(4);
  });

  it('removes control characters from one-line fields and NUL from the body', () => {
    const result = parseAgentArticle('---\ntitle: a\u0007b​\nsummary: s\n---\nx\0y');
    expect(result.title).toBe('a b');
    expect(result.body).toBe('xy\n');
  });

  it('reports an empty file without throwing', () => {
    const result = parseAgentArticle('');
    expect(result.title).toBe('');
    expect(result.body).toBe('');
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('buildWritingRequest', () => {
  it('asks questions first when the draft is empty', () => {
    const text = buildWritingRequest({ title: '', body: '' }, 'https://example.test');
    expect(text).toContain('質問してから書いてください');
    expect(text).toContain('```markdown');
    expect(text).not.toContain('## いまの下書き');
  });

  it('includes the current draft so the agent can continue it', () => {
    const text = buildWritingRequest({ title: '題', body: '途中の本文' }, 'https://example.test');
    expect(text).toContain('## いまの下書き');
    expect(text).toContain('途中の本文');
  });

  it('round-trips: the example inside the request parses cleanly', () => {
    const text = buildWritingRequest({ title: '', body: '' }, 'https://example.test');
    const block = /```markdown\n([\s\S]*?)\n```/.exec(text)![1];
    expect(parseAgentArticle(block).warnings).toEqual([]);
  });
});

describe('articleForAgent', () => {
  it('puts source, author and reader notes before the body and skips empty notes', () => {
    const text = articleForAgent({
      title: 'T',
      summary: 'S',
      tags: ['x'],
      audience: '',
      prerequisite: 'P',
      outcome: '',
      body: 'B',
      authorName: 'N',
      url: 'https://example.test/articles/1',
    });
    expect(text).toContain('# T');
    expect(text).toContain('https://example.test/articles/1');
    expect(text).toContain('- 前提知識: P');
    expect(text).not.toContain('想定読者');
    expect(text.trim().endsWith('B')).toBe(true);
  });
});
