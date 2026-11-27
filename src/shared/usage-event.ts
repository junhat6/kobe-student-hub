// 使われ方の計測（docs/loop/GROWTH.md「計測」）。ブラウザが送り、Worker が確かめて
// Cloudflare Workers Analytics Engine に1行ずつ書く。送ってよい項目はここに列挙したものだけ
// （DESIGN-PRINCIPLES 原則1：伏せるより渡すものを決める）。アカウント・cookie・IP・本文・検索語・
// URL のクエリ（utm_* 以外）・生の参照元 URL は扱わない。

export const USAGE_PATH = '/api/usage';
export const USAGE_BODY_LIMIT = 1024;

export type UsageEventName = 'view' | 'read';

/** 画面の種類。ここに無い経路はすべて `other`。ID を残すのは公開の記事・作品だけ。 */
export type UsageRoute =
  | 'home'
  | 'search'
  | 'works'
  | 'article'
  | 'project'
  | 'student'
  | 'about'
  | 'guide'
  | 'agents'
  | 'write'
  | 'account'
  | 'other';

const UUID4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const CONTENT = new RegExp(`^/(articles|projects)/(${UUID4})$`);
const STUDENT = /^\/students\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?:\/(?:likes|works))?$/;
const FIXED: Record<string, UsageRoute> = {
  '/': 'home',
  '/search': 'search',
  '/works': 'works',
  '/about': 'about',
  '/guide': 'guide',
  '/agents': 'agents',
};

/** pathname を画面の種類と（記事・作品のときだけ）公開 ID に落とす。学生のハンドルは残さない。 */
export function usageRoute(pathname: string): { route: UsageRoute; contentId: string } {
  if (FIXED[pathname]) return { route: FIXED[pathname], contentId: '' };
  const content = CONTENT.exec(pathname);
  if (content)
    return { route: content[1] === 'articles' ? 'article' : 'project', contentId: content[2] };
  if (STUDENT.test(pathname)) return { route: 'student', contentId: '' };
  if (/^\/(?:drafts|works\/new)(?:\/|$)/.test(pathname)) return { route: 'write', contentId: '' };
  if (/^\/(?:account|signup|login|history|connect|moderation)(?:\/|$)/.test(pathname))
    return { route: 'account', contentId: '' };
  return { route: 'other', contentId: '' };
}

/** 参照元はホスト名だけ（パス・クエリ＝検索語や投稿 ID を残さない）。自サイト・読めないものは空。 */
export function referrerHost(referrer: unknown, ownHost: string): string {
  if (typeof referrer !== 'string' || !referrer || referrer.length > 2048) return '';
  try {
    const url = new URL(referrer);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    const host = url.hostname.toLowerCase();
    if (host === ownHost || !/^[a-z0-9.-]{1,64}$/.test(host)) return '';
    return host;
  } catch {
    return '';
  }
}

/** utm_* は英小文字・数字・`-`・`_`・`.` の 40 文字まで。それ以外は捨てる（自由文を入れさせない）。 */
export function utmValue(value: unknown): string {
  if (typeof value !== 'string') return '';
  const v = value.trim().toLowerCase();
  return /^[a-z0-9._-]{1,40}$/.test(v) ? v : '';
}

const TOKEN = /^[A-Za-z0-9_-]{16,32}$/;

/** ブラウザが送る形。キーはこれだけ（余分なキーがあれば丸ごと捨てる）。 */
export interface UsagePayload {
  v: 1;
  e: UsageEventName;
  /** location.pathname。Worker が usageRoute で落とす */
  p: string;
  /** 匿名の識別子（ページを開くたびにブラウザがランダムに作る。保存しない・アカウントと結ばない） */
  a: string;
  /** 30 分無操作で変わるセッションの識別子 */
  s: string;
  /** 'm'（幅 768 未満）か 'd' */
  d: 'm' | 'd';
  /** この識別子で最初の view（ページを開いて最初）なら 1 */
  n?: 0 | 1;
  /** セッションの最初の view だけ：document.referrer（Worker がホスト名に落とす） */
  r?: string;
  /** セッションの最初の view だけ：utm_source / utm_medium / utm_campaign */
  us?: string;
  um?: string;
  uc?: string;
  /** read だけ：最も深く読んだ位置（0〜100） */
  sp?: number;
  /** read だけ：画面を見ていた秒数（0〜3600） */
  es?: number;
}

const KEYS = new Set(['v', 'e', 'p', 'a', 's', 'd', 'n', 'r', 'us', 'um', 'uc', 'sp', 'es']);

/** Analytics Engine に書く1行。blobs の順番は docs/loop/GROWTH.md の表と同じにする。 */
export interface UsageRow {
  index: string;
  blobs: [
    UsageEventName,
    UsageRoute,
    string, // contentId
    string, // referrer host
    string, // utm_source
    string, // utm_medium
    string, // utm_campaign
    string, // anonymous id
    string, // session id
    'm' | 'd',
    '0' | '1', // new visitor
  ];
  doubles: [number, number]; // scroll %, engaged seconds
}

const intIn = (v: unknown, max: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;

/** 送られた JSON を確かめて1行にする。少しでも形が違えば null（丸ごと捨てる）。 */
export function usageRow(value: unknown, ownHost: string): UsageRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((k) => !KEYS.has(k))) return null;
  if (v.v !== 1 || (v.e !== 'view' && v.e !== 'read')) return null;
  if (typeof v.p !== 'string' || !v.p.startsWith('/') || v.p.length > 300) return null;
  if (typeof v.a !== 'string' || !TOKEN.test(v.a)) return null;
  if (typeof v.s !== 'string' || !TOKEN.test(v.s)) return null;
  if (v.d !== 'm' && v.d !== 'd') return null;
  if (v.n !== undefined && v.n !== 0 && v.n !== 1) return null;
  for (const k of ['r', 'us', 'um', 'uc'])
    if (v[k] !== undefined && (typeof v[k] !== 'string' || (v[k] as string).length > 2048))
      return null;
  const { route, contentId } = usageRoute(v.p);
  let sp = 0;
  let es = 0;
  if (v.e === 'read') {
    // 読まれ方は記事・作品だけ
    if (!contentId || !intIn(v.sp, 100) || !intIn(v.es, 3600)) return null;
    sp = v.sp as number;
    es = v.es as number;
  } else if (v.sp !== undefined || v.es !== undefined) return null;
  return {
    index: v.a,
    blobs: [
      v.e,
      route,
      contentId,
      referrerHost(v.r, ownHost),
      utmValue(v.us),
      utmValue(v.um),
      utmValue(v.uc),
      v.a,
      v.s,
      v.d,
      v.n === 1 ? '1' : '0',
    ],
    doubles: [sp, es],
  };
}

/** UA が明らかに自動の閲覧なら数えない（検索エンジン・プレビュー取得・ヘッドレス）。 */
export function automatedAgent(ua: string | null): boolean {
  return !ua || /bot|crawl|spider|slurp|headless|preview|facebookexternalhit|curl|wget/i.test(ua);
}
