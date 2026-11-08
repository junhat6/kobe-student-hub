/** Extract only a video ID. Author-supplied origins, queries and player settings never reach an iframe. */
export function youtubeVideoId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    let id: string | null = null;
    if (url.hostname === 'youtu.be') id = /^\/([A-Za-z0-9_-]{11})$/.exec(url.pathname)?.[1] ?? null;
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
      if (url.pathname === '/watch' && url.searchParams.getAll('v').length === 1)
        id = url.searchParams.get('v');
      else id = /^\/(?:embed|shorts)\/([A-Za-z0-9_-]{11})$/.exec(url.pathname)?.[1] ?? null;
    } else if (url.hostname === 'www.youtube-nocookie.com')
      id = /^\/embed\/([A-Za-z0-9_-]{11})$/.exec(url.pathname)?.[1] ?? null;
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
