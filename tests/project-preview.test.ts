import { describe, expect, it } from 'vitest';
import { PROJECT_PREVIEW_CHARS, projectDescriptionPreview } from '../worker/project-preview';

describe('projectDescriptionPreview (#301)', () => {
  it('drops image embeds and keeps only link text', () => {
    expect(
      projectDescriptionPreview(
        '![We部ナレッジベースのトップページ](/api/media/88117e5f-0000-4000-8000-000000000000)\n\n部の知識を集める場所です。',
      ),
    ).toBe('部の知識を集める場所です。');
    expect(
      projectDescriptionPreview(
        '- [Git ハンズオン スライド（Speaker Deck）](https://speakerdeck.com/example/git)\n- 演習 <https://github.com/example>',
      ),
    ).toBe('Git ハンズオン スライド（Speaker Deck）\n演習 https://github.com/example');
  });

  it('strips block and inline markers but keeps the words', () => {
    const md = [
      '# 作品の概要 #',
      '',
      '> **Hono** と *React* で作った、`D1` を使う ~~旧~~ 新しい版。',
      '',
      '1. 検索できる',
      '2) [x] 公開できる',
      '',
      '---',
      '',
      '| 機能 | 状態 |',
      '| :--- | ---: |',
      '| 検索 | 完了 |',
      '',
      '```ts',
      'const secret = 1;',
      '```',
      '[ref]: https://example.com',
      'snake_case と 2 * 3 * 4 と \\*記号\\* はそのまま',
      '<details>開く</details>',
      '<script>window.injected = true',
      'still script</script>',
      '<style>p{}</style>',
      '後ろの文',
    ].join('\n');
    expect(projectDescriptionPreview(md)).toBe(
      [
        '作品の概要',
        '',
        'Hono と React で作った、D1 を使う 旧 新しい版。',
        '',
        '検索できる',
        '公開できる',
        '',
        '機能 状態',
        '検索 完了',
        '',
        'snake_case と 2 * 3 * 4 と *記号* はそのまま',
        '開く',
        '後ろの文',
      ].join('\n'),
    );
  });

  it('cuts after conversion at the public card bound, by code point', () => {
    const body = '😀'.repeat(PROJECT_PREVIEW_CHARS + 20);
    const preview = projectDescriptionPreview(`![x](/api/media/a)\n${body}`);
    expect(Array.from(preview)).toHaveLength(PROJECT_PREVIEW_CHARS);
    expect(preview.startsWith('😀')).toBe(true);
    expect(projectDescriptionPreview('plain text')).toBe('plain text');
  });

  it('stays fast on adversarial 16 KiB lines', () => {
    for (const line of [
      '|-' + ' '.repeat(16000) + 'x',
      '*'.repeat(16000),
      '_a'.repeat(8000),
      '['.repeat(8000) + ']('.repeat(4000),
      '!['.repeat(8000),
      '<https:'.repeat(2500),
      '[a]('.repeat(4000),
      '|' + ' |'.repeat(8000) + 'x',
    ]) {
      const start = performance.now();
      projectDescriptionPreview(line);
      expect(performance.now() - start).toBeLessThan(200);
    }
  });
});
