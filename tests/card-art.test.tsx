import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import CardArt, { CARD_ART_PATTERNS, cardArtLabel, cardArtPattern } from '../src/shared/CardArt';

// #310 (C26 条件5): the no-image picture is drawn from kind, id and the first tag only.

it('draws the same picture for the same input, with no randomness or clock', () => {
  const realRandom = Math.random;
  const realNow = Date.now;
  Math.random = () => {
    throw Error('Math.random must not be used');
  };
  Date.now = () => {
    throw Error('Date.now must not be used');
  };
  try {
    const first = renderToStaticMarkup(<CardArt kind="article" id="a-1" tag="Git" />);
    expect(renderToStaticMarkup(<CardArt kind="article" id="a-1" tag="Git" />)).toBe(first);
    expect(renderToStaticMarkup(<CardArt kind="article" id="a-2" tag="Git" />)).not.toBe(first);
  } finally {
    Math.random = realRandom;
    Date.now = realNow;
  }
});

it('uses every one of at least three patterns across ids', () => {
  expect(CARD_ART_PATTERNS.length).toBeGreaterThanOrEqual(3);
  const seen = new Set(Array.from({ length: 64 }, (_, i) => cardArtPattern('id-' + String(i))));
  expect([...seen].sort()).toEqual([...CARD_ART_PATTERNS].sort());
  for (const pattern of CARD_ART_PATTERNS) {
    const id = Array.from({ length: 64 }, (_, i) => 'id-' + String(i)).find(
      (candidate) => cardArtPattern(candidate) === pattern,
    )!;
    expect(renderToStaticMarkup(<CardArt kind="project" id={id} />)).toContain(
      `data-pattern="${pattern}"`,
    );
  }
});

it('composes articles and works differently and never repeats the title', () => {
  const article = renderToStaticMarkup(<CardArt kind="article" id="x" tag="React" />);
  const project = renderToStaticMarkup(<CardArt kind="project" id="x" />);
  expect(article).toContain('card-art-sheet');
  expect(article).not.toContain('card-art-cube');
  expect(project).toContain('card-art-cube');
  expect(project).not.toContain('card-art-sheet');
  expect(project).not.toContain('<text');
  expect(article).toContain('aria-hidden="true"');
  expect(project).toContain('aria-hidden="true"');
});

it('places the tag only as escaped text, never as markup', () => {
  const html = renderToStaticMarkup(<CardArt kind="article" id="x" tag={'<b>x</b>'} />);
  expect(html).not.toContain('<b>');
  expect(html).toContain('#&lt;b&gt;x&lt;/b&gt;');
  expect(renderToStaticMarkup(<CardArt kind="article" id="x" />)).not.toContain('<text');
  expect(cardArtLabel('  ')).toBeNull();
  expect(cardArtLabel('Git')).toBe('#Git');
  expect(cardArtLabel('あいうえおかきくけこさしすせそ')).toBe('#あいうえおかき…');
});

it('adds no AI, inference or image-generation route on the server', () => {
  const wrangler = readFileSync('wrangler.jsonc', 'utf8');
  expect(wrangler).not.toMatch(/"ai"\s*:/);
  const source = readFileSync('src/shared/CardArt.tsx', 'utf8');
  expect(source).not.toMatch(/fetch\(|dangerouslySetInnerHTML|Math\.random|Date\.now|new Date/);
});
