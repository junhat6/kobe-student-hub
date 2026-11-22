import { expect, it } from 'vitest';
import { articleShareUrl, xShareHref } from '../src/community/ArticleShare';

it('builds the article address from this origin and encodes the id', () => {
  expect(articleShareUrl('https://hub.junhat6.com', 'a b/c')).toBe(
    'https://hub.junhat6.com/articles/a%20b%2Fc',
  );
});

it('fills the X post intent with the title and address only', () => {
  const href = new URL(xShareHref('記事 & タイトル #1', 'https://hub.junhat6.com/articles/x'));
  expect(href.origin + href.pathname).toBe('https://x.com/intent/post');
  expect([...href.searchParams.keys()]).toEqual(['text', 'url']);
  expect(href.searchParams.get('text')).toBe('記事 & タイトル #1');
  expect(href.searchParams.get('url')).toBe('https://hub.junhat6.com/articles/x');
});
