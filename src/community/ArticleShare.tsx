import CopyButton from '../shared/CopyButton';
import Icon from '../shared/Icon';

/** The article's own address, built from this site's origin so a share never points elsewhere. */
export function articleShareUrl(origin: string, id: string): string {
  return `${origin}/articles/${encodeURIComponent(id)}`;
}

/** X's post intent with the title and address filled in; the reader still confirms on X. */
export function xShareHref(title: string, url: string): string {
  return `https://x.com/intent/post?${new URLSearchParams({ text: title, url })}`;
}

/**
 * Share row after the article body (#227): post to X and copy the link, as icon buttons like
 * note and Zenn. No share counts are kept or shown.
 */
export default function ArticleShare({ id, title }: { id: string; title: string }) {
  const url = () => articleShareUrl(window.location.origin, id);
  return (
    <div className="article-share" role="group" aria-label="この記事を共有">
      <a
        className="share-link"
        href={xShareHref(title, url())}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Xで共有（新しいタブ）"
        title="Xで共有"
      >
        <Icon name="xMark" size={18} />
      </a>
      <CopyButton text={url} label="記事のリンクをコピー" />
    </div>
  );
}
