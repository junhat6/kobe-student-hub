import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MarkdownRenderer from '../src/MarkdownRenderer';

it('offers an explicit YouTube load action without an iframe or external image request', () => {
  const html = renderToStaticMarkup(
    <MarkdownRenderer body={'[制作動画](https://youtu.be/M7lc1UVf-VE?autoplay=1)'} />,
  );
  expect(html).toContain('YouTube動画を読み込む');
  expect(html).toContain('読み込むとYouTubeに接続します。');
  expect(html).not.toMatch(/<iframe|<img|autoplay/);
  expect(html).toContain('https://www.youtube.com/watch?v=M7lc1UVf-VE');
});

it('preserves inline links and refuses spoofed YouTube hosts as embeds', () => {
  for (const body of [
    '説明と [動画](https://youtu.be/M7lc1UVf-VE) を参照。',
    '[動画](https://www.youtube.com.evil.invalid/watch?v=M7lc1UVf-VE)',
    '[動画](javascript:alert%281%29)',
  ]) {
    const html = renderToStaticMarkup(<MarkdownRenderer body={body} />);
    expect(html).not.toMatch(/youtube-placeholder|<iframe|javascript:/);
  }
});
