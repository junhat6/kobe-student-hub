import type { ReactNode } from 'react';

/**
 * #310 (C26 条件5): the picture for a card that has no image. It is drawn on the device from the
 * kind, the id and (for articles) the first tag — no server generation, no AI, no randomness or
 * clock — so the same article shows the same picture everywhere. Colours come from the card's
 * `--card-hue` and the card-art CSS variables, so the art follows the theme. The only user text
 * is the tag, placed as a React text node (never as markup) and never the title, which the card
 * already says. The whole picture is decoration (`aria-hidden`).
 */
export type CardArtInput = { kind: 'article' | 'project'; id: string; tag?: string };

/** FNV-1a over the id: a stable seed for the pattern and its offsets. */
function cardArtSeed(id: string) {
  let hash = 0x811c9dc5;
  for (const char of id) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export const CARD_ART_PATTERNS = ['dots', 'stripes', 'rings', 'waves'] as const;
export type CardArtPattern = (typeof CARD_ART_PATTERNS)[number];

export function cardArtPattern(id: string): CardArtPattern {
  return CARD_ART_PATTERNS[cardArtSeed(id) % CARD_ART_PATTERNS.length]!;
}

/** Long tags would run into the sheet; keep the first 7 characters (by code point). */
export function cardArtLabel(tag: string | undefined) {
  const trimmed = tag?.trim();
  if (!trimmed) return null;
  const chars = Array.from(trimmed);
  return '#' + (chars.length > 8 ? chars.slice(0, 7).join('') + '…' : trimmed);
}

const W = 400;
const H = 200;

function Pattern({ pattern, seed }: { pattern: CardArtPattern; seed: number }) {
  const shift = (seed >>> 8) % 24;
  const shapes: ReactNode[] = [];
  if (pattern === 'dots') {
    for (let y = 12 + (shift % 12); y < H; y += 24)
      for (let x = 12 + shift; x < W; x += 24)
        shapes.push(<circle key={`${x}-${y}`} cx={x} cy={y} r={3} />);
  } else if (pattern === 'stripes') {
    for (let x = -H + shift; x < W; x += 28)
      shapes.push(<path key={x} d={`M${x} ${H}L${x + H} 0`} className="card-art-line" />);
  } else if (pattern === 'rings') {
    const cx = 300 + (shift % 60);
    const cy = 40 + ((seed >>> 16) % 80);
    for (let r = 18; r < 340; r += 26)
      shapes.push(<circle key={r} cx={cx} cy={cy} r={r} className="card-art-line" />);
  } else {
    for (let y = 10 + (shift % 20); y < H + 20; y += 22)
      shapes.push(
        <path
          key={y}
          d={`M0 ${y} Q 25 ${y - 10} 50 ${y} T 100 ${y} T 150 ${y} T 200 ${y} T 250 ${y} T 300 ${y} T 350 ${y} T 400 ${y}`}
          className="card-art-line"
        />,
      );
  }
  return <g className="card-art-pattern">{shapes}</g>;
}

/**
 * Article: a sheet of paper with a folded corner and text lines, the tag set large beside it.
 * Without a tag the sheet moves to the centre so the frame does not look half empty.
 */
function ArticleFigure({ label }: { label: string | null }) {
  return (
    <>
      <g
        className="card-art-sheet"
        transform={label ? 'translate(276 34) rotate(6)' : 'translate(152 34) rotate(6)'}
      >
        <path d="M0 0H76L96 20V128H0Z" className="card-art-sheet-paper" />
        <path d="M76 0V20H96" className="card-art-sheet-fold" />
        <path d="M14 36H70M14 54H82M14 72H62M14 90H78M14 108H50" className="card-art-sheet-text" />
      </g>
      {label && (
        <text
          x={28}
          y={H - 34}
          className="card-art-label"
          fontSize={Array.from(label).length > 6 ? 26 : 34}
        >
          {label}
        </text>
      )}
    </>
  );
}

/** Work: stacked blocks (an isometric cube on a tile), with no text. */
function ProjectFigure({ seed }: { seed: number }) {
  const x = 150 + ((seed >>> 12) % 100);
  const cube = (cx: number, cy: number, s: number, key: string) => (
    <g key={key} className="card-art-cube">
      <path
        d={`M${cx} ${cy - s}L${cx + s} ${cy - s / 2}L${cx} ${cy}L${cx - s} ${cy - s / 2}Z`}
        className="card-art-cube-top"
      />
      <path
        d={`M${cx - s} ${cy - s / 2}L${cx} ${cy}V${cy + s}L${cx - s} ${cy + s / 2}Z`}
        className="card-art-cube-left"
      />
      <path
        d={`M${cx + s} ${cy - s / 2}L${cx} ${cy}V${cy + s}L${cx + s} ${cy + s / 2}Z`}
        className="card-art-cube-right"
      />
    </g>
  );
  return (
    <>
      {cube(x, 118, 44, 'a')}
      {cube(x - 44, 140, 22, 'b')}
      {cube(x + 52, 70, 26, 'c')}
    </>
  );
}

export default function CardArt({ kind, id, tag }: CardArtInput) {
  const seed = cardArtSeed(id);
  const pattern = cardArtPattern(id);
  return (
    <svg
      className={`card-art card-art-${kind}`}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
      data-pattern={pattern}
    >
      <rect width={W} height={H} className="card-art-ground" />
      <Pattern pattern={pattern} seed={seed} />
      {kind === 'article' ? (
        <ArticleFigure label={cardArtLabel(tag)} />
      ) : (
        <ProjectFigure seed={seed} />
      )}
    </svg>
  );
}
