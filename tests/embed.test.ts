import { describe, expect, it } from 'vitest';
import {
  embedFrameUrl,
  embedLineFromPaste,
  instagramCode,
  mapEmbedPb,
  parseEmbed,
} from '../src/shared/embed';
import { insertOwnLine } from '../src/editor/markdown-format';

// Synthetic values in the shape Google マップ「地図を埋め込む」 emits (base64 `+`/`=` included).
const PB =
  '!1m18!1m12!1m3!1d3280.6!2d135.19!3d34.69!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2z5Y+N5oi4=!5e0!3m2!1sja!2sjp!4v1700000000000!5m2!1sja!2sjp';
const MAP = 'https://www.google.com/maps/embed?pb=' + PB;

describe('mapEmbedPb', () => {
  it('keeps the raw pb of the official share-embed URL, including base64 + and =', () => {
    expect(mapEmbedPb(MAP)).toBe(PB);
    expect(embedFrameUrl({ kind: 'map', pb: PB })).toBe(MAP);
    expect(mapEmbedPb(MAP + '#fragment-is-dropped')).toBe(PB);
  });
  it('refuses other hosts, paths, extra parameters, API-key embeds and attribute breakouts', () => {
    for (const url of [
      'http://www.google.com/maps/embed?pb=' + PB,
      'https://google.com/maps/embed?pb=' + PB,
      'https://www.google.com.evil.invalid/maps/embed?pb=' + PB,
      'https://www.google.com@evil.invalid/maps/embed?pb=' + PB,
      'https://www.google.com:444/maps/embed?pb=' + PB,
      'https://www.google.com/maps/embed/v1/place?key=K&q=Kobe',
      'https://www.google.com/maps/embed?pb=' + PB + '&output=embed',
      'https://www.google.com/maps/embed?q=Kobe&pb=' + PB,
      'https://www.google.com/maps/embed?pb=1m18',
      'https://www.google.com/maps/embed?pb=!1m"onload="x',
      'https://www.google.com/maps/embed?pb=!1m%22%3E%3Cscript',
      'https://www.google.com/maps/place/Kobe',
      'https://maps.app.goo.gl/abcdef',
      'https://www.google.com/maps/embed?pb=!' + 'a'.repeat(2100),
    ])
      expect(mapEmbedPb(url), url).toBeNull();
  });
});

describe('instagramCode', () => {
  it('extracts the shortcode from post, reel, username and embed URLs and drops tracking', () => {
    for (const url of [
      'https://www.instagram.com/p/AbC_12-x/',
      'https://www.instagram.com/p/AbC_12-x/?utm_source=ig_web_copy_link&igsh=xyz',
      'https://instagram.com/p/AbC_12-x',
      'https://www.instagram.com/reel/AbC_12-x/',
      'https://www.instagram.com/some.shop/p/AbC_12-x/',
      'https://www.instagram.com/p/AbC_12-x/embed/captioned/',
    ])
      expect(instagramCode(url), url).toBe('AbC_12-x');
    expect(embedFrameUrl({ kind: 'instagram', code: 'AbC_12-x' })).toBe(
      'https://www.instagram.com/p/AbC_12-x/embed/',
    );
  });
  it('refuses profiles, stories, other hosts and odd codes', () => {
    for (const url of [
      'https://www.instagram.com/some.shop/',
      'https://www.instagram.com/stories/some.shop/123/',
      'https://www.instagram.com.evil.invalid/p/AbC_12-x/',
      'http://www.instagram.com/p/AbC_12-x/',
      'https://www.instagram.com/p/a%22b/',
      'https://www.instagram.com/p/ab/',
      'https://www.instagram.com/p/AbC_12-x/other/',
    ])
      expect(instagramCode(url), url).toBeNull();
  });
});

describe('parseEmbed', () => {
  it('routes each official URL to its provider and leaves the rest as links', () => {
    expect(parseEmbed('https://youtu.be/M7lc1UVf-VE')).toEqual({
      kind: 'youtube',
      id: 'M7lc1UVf-VE',
    });
    expect(parseEmbed(MAP)).toEqual({ kind: 'map', pb: PB });
    expect(parseEmbed('https://www.instagram.com/p/AbC_12-x/')).toEqual({
      kind: 'instagram',
      code: 'AbC_12-x',
    });
    expect(parseEmbed('https://x.com/someone/status/1')).toBeNull();
    expect(parseEmbed('https://tabelog.com/hyogo/')).toBeNull();
  });
});

describe('embedLineFromPaste', () => {
  it('turns the official embed HTML into the one URL line the renderer embeds', () => {
    expect(
      embedLineFromPaste(
        `<iframe src="${MAP}" width="600" height="450" style="border:0;" allowfullscreen="" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`,
      ),
    ).toBe(MAP);
    expect(
      embedLineFromPaste(
        '<blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/p/AbC_12-x/?utm_source=ig_embed&amp;utm_campaign=loading" data-instgrm-version="14"><a href="x">…</a></blockquote> <script async src="//www.instagram.com/embed.js"></script>',
      ),
    ).toBe('https://www.instagram.com/p/AbC_12-x/');
    expect(
      embedLineFromPaste(
        '<iframe width="560" height="315" src="https://www.youtube.com/embed/M7lc1UVf-VE?si=abc" title="YouTube video player"></iframe>',
      ),
    ).toBe('https://www.youtube.com/watch?v=M7lc1UVf-VE');
  });
  it('leaves ordinary text and unknown frames to the normal paste', () => {
    for (const text of [
      MAP,
      'ふつうの文章 <iframe src="' + MAP + '"></iframe>',
      '<iframe src="https://evil.invalid/maps/embed?pb=!1m1"></iframe>',
      '<blockquote class="twitter-tweet"><a href="https://twitter.com/a/status/1">x</a></blockquote>',
      '<script src="https://www.google.com/maps/embed?pb=!1m1"></script>',
    ])
      expect(embedLineFromPaste(text), text).toBeNull();
  });
});

describe('insertOwnLine', () => {
  it('puts the URL in its own paragraph without doubling blank lines', () => {
    expect(insertOwnLine('前の文', 3, 3, 'U')).toEqual({ body: '前の文\n\nU', start: 6, end: 6 });
    expect(insertOwnLine('前\n\n後', 2, 2, 'U').body).toBe('前\n\nU\n\n後');
    expect(insertOwnLine('', 0, 0, 'U').body).toBe('U');
    expect(insertOwnLine('前の文選択後', 3, 5, 'U').body).toBe('前の文\n\nU\n\n後');
  });
});
