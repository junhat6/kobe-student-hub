import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MarkdownRenderer from '../src/MarkdownRenderer';

const render = (body: string) => renderToStaticMarkup(<MarkdownRenderer body={body} />);
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => decodeURI(m[1]));

it('ends bare URLs at Japanese brackets, punctuation and an unbalanced ")"', () => {
  const cases: [string, string[], string][] = [
    [
      '下書き画面（https://example.com/drafts）にこの下書きが表示されるか',
      ['https://example.com/drafts'],
      '</a>）にこの下書きが表示されるか',
    ],
    ['出典：〇〇（https://example.com/shop）', ['https://example.com/shop'], '</a>）'],
    [
      '下書き画面(https://example.com/drafts)にこの下書きが表示されるか',
      ['https://example.com/drafts'],
      '</a>)にこの下書きが表示されるか',
    ],
    [
      '参考：https://example.com/page、詳しくは次節。',
      ['https://example.com/page'],
      '</a>、詳しくは次節。',
    ],
    ['「https://example.com/page」を開く', ['https://example.com/page'], '</a>」を開く'],
    ['参考 https://example.com/page　次へ', ['https://example.com/page'], '</a>　次へ'],
    [
      'A（https://a.example.com/x）とB（https://b.example.com/y）を比べる',
      ['https://a.example.com/x', 'https://b.example.com/y'],
      '</a>）を比べる',
    ],
    ['詳しくは www.example.com/page、次へ', ['http://www.example.com/page'], '</a>、次へ'],
  ];
  for (const [body, expected, tail] of cases) {
    const html = render(body);
    expect(hrefs(html), body).toEqual(expected);
    expect(html, body).toContain(tail);
  }
});

it('keeps balanced parentheses, Japanese paths, explicit links and code untouched', () => {
  expect(hrefs(render('https://en.wikipedia.org/wiki/Markdown_(markup_language) を参照'))).toEqual([
    'https://en.wikipedia.org/wiki/Markdown_(markup_language)',
  ]);
  const ja = 'https://ja.wikipedia.org/wiki/神戸電子専門学校';
  expect(hrefs(render('（' + ja + '）'))).toEqual([ja]);
  expect(hrefs(render(ja + ' を参照'))).toEqual([ja]);
  expect(hrefs(render('[ラベル](https://example.com/)'))).toEqual(['https://example.com/']);
  expect(hrefs(render('<https://example.com/a）b>'))).toEqual(['https://example.com/a）b']);
  expect(
    hrefs(render('`（https://example.com/x）` と\n\n```\n（https://example.com/y）\n```')),
  ).toEqual([]);
});

it('keeps embeds, raw HTML off and non-http schemes refused', () => {
  expect(render('https://youtu.be/M7lc1UVf-VE')).toContain('YouTube動画を読み込む');
  expect(render('（<b>x</b>https://example.com/）')).not.toContain('<b>');
  expect(render('[x](javascript:alert%281%29)（https://example.com/）')).not.toContain(
    'javascript:',
  );
});
