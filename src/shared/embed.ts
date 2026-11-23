import { youtubeVideoId } from './youtube';

/**
 * Official, iframe-only embeds an article line may turn into (DECISIONS 2026-11-23「記事の埋め込み」).
 * Only an ID is extracted; the iframe URL is rebuilt here, so author-supplied hosts, queries and
 * player settings never reach a frame. No provider script ever runs in this site's page.
 */
export type Embed =
  | { kind: 'youtube'; id: string }
  | { kind: 'map'; pb: string }
  | { kind: 'instagram'; code: string };

/**
 * Google マップ「地図を共有 → 地図を埋め込む」の pb 値（不透明な文字列）。引用符・& などは通さず、
 * 百分率エスケープも Google が使う : = + , / 空白 だけにする（%22 などは URL パーサが作るため）。
 */
const MAP_PB = /^!(?:[A-Za-z0-9!._~:+/=-]|%(?:3[AaDd]|2[0BbCcFf]))+$/;
const MAP_PB_MAX = 2048;
const INSTAGRAM_CODE = /^[A-Za-z0-9_-]{5,64}$/;

function safeUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    return url;
  } catch {
    return null;
  }
}

/** The Google Maps share-embed `pb` value, or null. Only `https://www.google.com/maps/embed?pb=…`. */
export function mapEmbedPb(value: unknown): string | null {
  const url = safeUrl(value);
  if (!url || url.hostname !== 'www.google.com' || url.pathname !== '/maps/embed') return null;
  // Read the raw query: URLSearchParams would turn a base64 `+` into a space.
  const pb = /^\?pb=([^&#]*)$/.exec(url.search)?.[1];
  return pb && pb.length <= MAP_PB_MAX && MAP_PB.test(pb) ? pb : null;
}

/** An Instagram post or reel shortcode, or null. Usernames and tracking queries are dropped. */
export function instagramCode(value: unknown): string | null {
  const url = safeUrl(value);
  if (!url || !['www.instagram.com', 'instagram.com'].includes(url.hostname)) return null;
  const code =
    /^\/(?:[A-Za-z0-9._]{1,30}\/)?(?:p|reel)\/([^/]+)\/?(?:embed\/?(?:captioned\/?)?)?$/.exec(
      url.pathname,
    )?.[1];
  return code && INSTAGRAM_CODE.test(code) ? code : null;
}

export function parseEmbed(value: unknown): Embed | null {
  const id = youtubeVideoId(value);
  if (id) return { kind: 'youtube', id };
  const pb = mapEmbedPb(value);
  if (pb) return { kind: 'map', pb };
  const code = instagramCode(value);
  return code ? { kind: 'instagram', code } : null;
}

/** The only URLs a frame is ever given. Must stay inside the CSP `frame-src` list. */
export function embedFrameUrl(embed: Embed): string {
  if (embed.kind === 'youtube') return 'https://www.youtube-nocookie.com/embed/' + embed.id;
  if (embed.kind === 'map') return 'https://www.google.com/maps/embed?pb=' + embed.pb;
  return 'https://www.instagram.com/p/' + embed.code + '/embed/';
}

/** Where the reader can open the original. Maps share-embeds carry no public place URL. */
export function embedPublicUrl(embed: Embed): string | null {
  if (embed.kind === 'youtube') return 'https://www.youtube.com/watch?v=' + embed.id;
  if (embed.kind === 'instagram') return 'https://www.instagram.com/p/' + embed.code + '/';
  return null;
}

const decodeAttr = (value: string) => value.replace(/&amp;/g, '&');

/**
 * Turns pasted official embed HTML (Google マップの `<iframe src=…>`、Instagram の
 * `<blockquote data-instgrm-permalink=…>`、YouTube の `<iframe>`) into the one URL line the
 * renderer embeds. Returns null for anything else, so ordinary pastes are untouched.
 */
export function embedLineFromPaste(text: string): string | null {
  const trimmed = text.trim();
  if (!/^<(?:iframe|blockquote)\b/i.test(trimmed) || trimmed.length > 65536) return null;
  const candidates = [
    /\bsrc\s*=\s*"([^"]+)"/i.exec(trimmed)?.[1],
    /\bdata-instgrm-permalink\s*=\s*"([^"]+)"/i.exec(trimmed)?.[1],
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    const embed = parseEmbed(decodeAttr(raw));
    if (!embed) continue;
    return embed.kind === 'map' ? embedFrameUrl(embed) : embedPublicUrl(embed);
  }
  return null;
}
