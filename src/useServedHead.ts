import { useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/** index.html の既定の題（worker/page-meta.ts が記事・作品ページだけ書き換える）。 */
export const SITE_TITLE = '学生の知恵と、つくる日々 | Kobe Student Hub';

/**
 * G04：worker が記事・作品ページの head に書いた題と canonical は、そのページにだけ当てはまる。
 * 画面内の遷移で別のページへ移ったら既定の題に戻し canonical を外し、戻ってきたら元に戻す。
 */
export function useServedHead() {
  const { pathname } = useLocation();
  const served = useRef<{ path: string; title: string; canonical: HTMLLinkElement | null }>(null);
  useLayoutEffect(() => {
    served.current ??= {
      path: pathname,
      title: document.title,
      canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]'),
    };
    const { path, title, canonical } = served.current;
    const here = pathname === path;
    document.title = here ? title : SITE_TITLE;
    if (canonical) {
      if (here && !canonical.isConnected) document.head.appendChild(canonical);
      else if (!here) canonical.remove();
    }
  }, [pathname]);
}
