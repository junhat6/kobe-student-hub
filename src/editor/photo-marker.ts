import { fencedRanges } from './ai-memo';

/**
 * The agent cannot attach files, so it writes 「（写真：…）」「（図：…）」 where an image belongs
 * (src/agent/article-format.ts, SKILL.md). The owner replaced or deleted each one by hand just
 * before publishing (#303). These helpers find the markers so the image panel can put an image
 * exactly where one is asked for, with the marker's words as its alt text.
 *
 * Only a marker outside fenced code and on one line counts, so an article that quotes the marker
 * in a code block is never rewritten.
 */
export interface PhotoMarker {
  /** Stable while the body around it changes: the marker text plus its order among equal texts. */
  key: string;
  kind: '写真' | '図';
  label: string;
  text: string;
  ordinal: number;
}

const MARKER =
  /[（(](写真|図)[：:][ \t　]*((?:[^（）()\n]|[（(][^（）()\n]*[）)]){1,80}?)[ \t　]*[）)]/g;

function scan(body: string) {
  const fences = fencedRanges(body);
  const found: Array<PhotoMarker & { start: number; end: number }> = [];
  const seen = new Map<string, number>();
  for (const match of body.matchAll(MARKER)) {
    const start = match.index;
    if (fences.some((r) => start >= r.start && start <= r.end)) continue;
    const text = match[0];
    const label = match[2].trim();
    if (!label) continue;
    const ordinal = (seen.get(text) ?? 0) + 1;
    seen.set(text, ordinal);
    found.push({
      key: `${ordinal}:${text}`,
      kind: match[1] as '写真' | '図',
      label,
      text,
      ordinal,
      start,
      end: start + text.length,
    });
  }
  return found;
}

export function findPhotoMarkers(body: string): PhotoMarker[] {
  return scan(body).map(({ key, kind, label, text, ordinal }) => ({
    key,
    kind,
    label,
    text,
    ordinal,
  }));
}

/** Image Markdown whose alt text is the marker's words, without characters that end the alt. */
export function markerImage(marker: PhotoMarker, path: string) {
  const alt = marker.label
    .replace(/[[\]\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `![${alt || '画像'}](${path})`;
}

/**
 * Replaces the marker (matched by its text and order, since the body may have changed while the
 * image was uploading) with the image. When the marker is gone, the image goes to the end of the
 * body as before, so an uploaded image is never left unreferenced.
 */
export function placeAtMarker(body: string, marker: PhotoMarker, path: string): string {
  const image = markerImage(marker, path);
  const target = scan(body).find((m) => m.text === marker.text && m.ordinal === marker.ordinal);
  if (!target) return body + `\n\n${image}\n`;
  return body.slice(0, target.start) + image + body.slice(target.end);
}
