// G04（growth.json）：公開記事・公開作品のページの head に、その記事・作品のメタ情報を入れる。
// X などのカードや検索結果は JS を実行せずに head を読むので、SPA の index.html を worker が書き換える。
// 値は公開 DTO（indexable-pages.ts が公開 API と同じ読み取りで得たもの）だけから作り、すべて escape する。

export const SITE_NAME = 'Kobe Student Hub';
/** 検索結果・カードで切られずに読める長さ。DTO の要約はこれより長いことがある。 */
export const DESCRIPTION_CHARS = 120;

export interface PageMeta {
  title: string;
  description: string;
  /** 正規の origin の絶対 URL（クエリなし）。 */
  url: string;
  /** 公開画像の絶対 URL。無ければカードは summary。 */
  image?: string;
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** 1行にまとめ、文字（コードポイント）単位で切る。 */
export function metaText(value: string, chars: number): string {
  const line = value.replace(/\s+/g, ' ').trim();
  const parts = Array.from(line);
  return parts.length <= chars ? line : parts.slice(0, chars - 1).join('') + '…';
}

// index.html の既定のメタ情報（サイト全体の1種類）。ページごとの値に置き換えるものだけを外す。
const REPLACED_META =
  /<meta\s+(?:name|property)="(?:description|og:type|og:title|og:description|og:url|og:image|twitter:card)"\s+content="[^"]*"\s*\/?>\s*/g;
const TITLE = /<title>[^<]*<\/title>\s*/;

/** index.html の head を、その記事・作品のメタ情報に置き換える。 */
export function withPageMeta(html: string, meta: PageMeta): string {
  if (!html.includes('</head>')) return html;
  const name = metaText(meta.title, 100);
  const title = name + ' | ' + SITE_NAME;
  const tag = (attr: 'name' | 'property', key: string, value: string) =>
    `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`;
  const head = [
    `<title>${escapeHtml(title)}</title>`,
    tag('name', 'description', meta.description),
    `<link rel="canonical" href="${escapeHtml(meta.url)}" />`,
    tag('property', 'og:type', 'article'),
    tag('property', 'og:title', name),
    tag('property', 'og:description', meta.description),
    tag('property', 'og:url', meta.url),
    ...(meta.image ? [tag('property', 'og:image', meta.image)] : []),
    tag('name', 'twitter:card', meta.image ? 'summary_large_image' : 'summary'),
  ].join('\n    ');
  return (
    html
      .replace(REPLACED_META, '')
      .replace(TITLE, '')
      // 関数で置き換える（文字列だと題の `$'` などが置換パターンとして解釈される）。
      .replace('</head>', () => `  ${head}\n  </head>`)
  );
}
