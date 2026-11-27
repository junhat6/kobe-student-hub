// ブラウザ側の計測（docs/loop/GROWTH.md「計測」）。送る項目は usage-event.ts の UsagePayload だけ。
// cookie は使わず credentials: 'omit' で送るので、Worker 側でもアカウントと結びつかない。
// ブラウザの保存領域には何も書かない。
// Do Not Track / Global Privacy Control が有効なら何も保存せず、何も送らない。
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { USAGE_PATH, usageRoute, type UsagePayload } from './usage-event';

// 識別子はメモリの中だけに持つ（ページを開いている間）。localStorage・sessionStorage・cookie に
// 何も残さない、というこのサイトの決まり（tests の「browser persistence」検査）を計測でも守る。
// そのため再訪は読者の識別子では数えない（docs/loop/GROWTH.md §5「継続」）。
let visitorId = '';
let sessionId = '';
let lastSeen = 0;
const SESSION_IDLE_MS = 30 * 60 * 1000;

function optedOut(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === '1' || nav.globalPrivacyControl === true;
}

function token(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** このページを開いてから最初の view なら isNew=true。 */
function visitor(): { id: string; isNew: boolean } {
  if (visitorId) return { id: visitorId, isNew: false };
  visitorId = token();
  return { id: visitorId, isNew: true };
}

/** 30 分無操作で切れるセッション。started=true ならこの view がセッションの最初。 */
function session(now: number): { id: string; started: boolean } {
  const started = !sessionId || now - lastSeen >= SESSION_IDLE_MS;
  if (started) sessionId = token();
  lastSeen = now;
  return { id: sessionId, started };
}

function send(payload: UsagePayload) {
  try {
    void fetch(USAGE_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'omit',
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

const device = () => (window.innerWidth < 768 ? 'm' : 'd') as 'm' | 'd';

function scrollPercent(): number {
  const doc = document.documentElement;
  const max = doc.scrollHeight - window.innerHeight;
  if (max <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((window.scrollY / max) * 100)));
}

/**
 * 画面が変わるたびに view を1回送り、記事・作品では離れるときに read（どこまで読んだか・
 * 見ていた秒数）を1回送る。Router の中に1つだけ置く。
 */
export function UsageBeacon() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (typeof window === 'undefined' || optedOut()) return;
    const now = Date.now();
    const who = visitor();
    const ses = session(now);
    const base = { v: 1 as const, p: pathname, a: who.id, s: ses.id, d: device() };
    const view: UsagePayload = { ...base, e: 'view', ...(who.isNew ? { n: 1 as const } : {}) };
    if (ses.started) {
      const q = new URLSearchParams(window.location.search);
      Object.assign(view, {
        r: document.referrer || undefined,
        us: q.get('utm_source') || undefined,
        um: q.get('utm_medium') || undefined,
        uc: q.get('utm_campaign') || undefined,
      });
    }
    send(JSON.parse(JSON.stringify(view)) as UsagePayload);
    if (!usageRoute(pathname).contentId) return;
    // 記事・作品：読んだ深さと、画面が見えていた時間を数え、離れるときに1回だけ送る
    let deepest = scrollPercent();
    let visibleSince: number | null = document.visibilityState === 'visible' ? now : null;
    let engagedMs = 0;
    let sent = false;
    const onScroll = () => {
      deepest = Math.max(deepest, scrollPercent());
    };
    const flush = () => {
      if (sent) return;
      sent = true;
      if (visibleSince !== null) engagedMs += Date.now() - visibleSince;
      send({
        ...base,
        e: 'read',
        sp: Math.max(deepest, scrollPercent()),
        es: Math.min(3600, Math.round(engagedMs / 1000)),
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (visibleSince !== null) engagedMs += Date.now() - visibleSince;
        visibleSince = null;
        // スマホはタブを閉じる前に hidden になったきり戻らないことが多いので、ここで送る
        flush();
      } else if (!sent) visibleSince = Date.now();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [pathname]);
  return null;
}
