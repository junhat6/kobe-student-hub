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
    expect(html).not.toMatch(/embed-placeholder|<iframe|javascript:/);
  }
});

it('offers consent-gated Google マップ and Instagram embeds and keeps other links as links', () => {
  const pb =
    '!1m18!1m12!1m3!1d3280.6!2d135.19!3d34.69!3m3!1m2!1s0x0%3A0x0!2z5Y+N5oi4=!5e0!3m2!1sja!2sjp';
  const map = renderToStaticMarkup(
    <MarkdownRenderer body={'https://www.google.com/maps/embed?pb=' + pb} />,
  );
  expect(map).toContain('地図を読み込む');
  expect(map).toContain('読み込むとGoogleに接続します。');
  expect(map).not.toMatch(/<iframe|<img/);
  const insta = renderToStaticMarkup(
    <MarkdownRenderer body={'https://www.instagram.com/p/AbC_12-x/?igsh=tracking'} />,
  );
  expect(insta).toContain('Instagramの投稿を読み込む');
  expect(insta).toContain('href="https://www.instagram.com/p/AbC_12-x/"');
  expect(insta).not.toMatch(/<iframe|<img|igsh/);
  for (const body of [
    'https://x.com/someone/status/1',
    'お店の地図は https://www.google.com/maps/embed?pb=' + pb + ' です',
    '<iframe src="https://www.google.com/maps/embed?pb=' + pb + '"></iframe>',
  ]) {
    const html = renderToStaticMarkup(<MarkdownRenderer body={body} />);
    expect(html, body).not.toMatch(/embed-placeholder|<iframe/);
  }
});
