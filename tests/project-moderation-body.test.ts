import { it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { markdownLiteral } from '../worker/project-moderation';
// Same Markdown options as MarkdownRenderer, which shows the operator's case body.
const html = (body: string) =>
  renderToStaticMarkup(
    createElement(ReactMarkdown, { children: body, remarkPlugins: [remarkGfm], skipHtml: true }),
  );
const text = (body: string) =>
  html(body)
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');
it('shows technologies on the operator case exactly as typed, as on the public page (#177)', () => {
  for (const technologies of [
    '**React**、_Hono_',
    '<b>x</b>',
    '[x](javascript:alert(1))',
    '`code` ~~del~~ \\back',
    '# heading | table |',
    '&amp; &#60; https://example.com',
    '1. 2) - + > !',
    'React、TypeScript、Cloudflare Workers',
    '`edge`',
    ' spaced ',
    'www.example.com a@example.com',
  ]) {
    const out = html('使った技術: ' + markdownLiteral(technologies));
    expect(out).not.toMatch(/<(strong|em|a|b|del|h1|table|img|ol|ul|blockquote)\b/);
    expect(text('使った技術: ' + markdownLiteral(technologies))).toBe(
      '使った技術: ' + technologies,
    );
  }
});
