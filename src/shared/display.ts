/** Presentation helpers shared by cards and detail pages. */
export function formatDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : value;
}

/** Stable, decorative hue per tag so cards are distinguishable without images. */
export function tagHue(text: string) {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  const hues = [212, 168, 262, 28, 340, 190, 132, 8];
  return String(hues[hash % hues.length]);
}
