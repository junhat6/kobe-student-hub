/**
 * Editorial review: the owner (an operator) records how a published article reads to them, so the
 * owner's taste accumulates in one place and the editor loop can turn it into writing guidance
 * (docs/loop/prompts/editor.md → src/agent/editorial-taste.ts).
 *
 * R2 (operator-only private data + migration 0030). Flip only after an independent verification
 * in a separate context. The Worker and the UI read the same constant.
 */
export const EDITORIAL_REVIEW_RELEASE_ENABLED = false;

export const EDITORIAL_VERDICTS = ['good', 'ok', 'bad'] as const;
export type EditorialVerdict = (typeof EDITORIAL_VERDICTS)[number];

/**
 * Fixed rubric. Codes are stored; labels are shown. Add codes freely; never rename or reuse a
 * code (old reviews keep their meaning). The editor loop reads the counts per code.
 */
export const EDITORIAL_POINTS = [
  { code: 'experience', label: '体験が具体的', tone: 'plus' },
  { code: 'voice', label: '本人の言葉', tone: 'plus' },
  { code: 'next_action', label: '次の行動になる', tone: 'plus' },
  { code: 'visuals', label: '写真・図が効く', tone: 'plus' },
  { code: 'length_ok', label: '長さがちょうどいい', tone: 'plus' },
  { code: 'thin', label: '中身が薄い', tone: 'minus' },
  { code: 'padded', label: '盛っている', tone: 'minus' },
  { code: 'too_long', label: '長い', tone: 'minus' },
  { code: 'unclear_reader', label: '誰向けか分からない', tone: 'minus' },
  { code: 'missing_facts', label: '時期・値段などが足りない', tone: 'minus' },
] as const;
export type EditorialPoint = (typeof EDITORIAL_POINTS)[number]['code'];
export const EDITORIAL_POINT_CODES: readonly string[] = EDITORIAL_POINTS.map((p) => p.code);
export const EDITORIAL_NOTE_MAX = 500;

export interface EditorialReviewInput {
  verdict: EditorialVerdict;
  points: EditorialPoint[];
  note: string;
}
export interface EditorialReviewView extends EditorialReviewInput {
  reviewedAt: string;
}

/** Strict decoder shared by the Worker and the client. Returns null for anything unexpected. */
export function decodeEditorialReviewInput(v: unknown): EditorialReviewInput | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  if (Object.getPrototypeOf(v) !== Object.prototype) return null;
  const x = v as Record<string, unknown>;
  const keys = Reflect.ownKeys(v);
  if (keys.length !== 3 || !['verdict', 'points', 'note'].every((k) => Object.hasOwn(x, k)))
    return null;
  if (
    typeof x.verdict !== 'string' ||
    !(EDITORIAL_VERDICTS as readonly string[]).includes(x.verdict)
  )
    return null;
  if (
    !Array.isArray(x.points) ||
    x.points.length > EDITORIAL_POINTS.length ||
    !x.points.every((p) => typeof p === 'string' && EDITORIAL_POINT_CODES.includes(p)) ||
    new Set(x.points).size !== x.points.length
  )
    return null;
  if (typeof x.note !== 'string') return null;
  const note = x.note.trim();
  // One short note; no control characters except newlines.
  if (
    Array.from(note).length > EDITORIAL_NOTE_MAX ||
    /[\u0000-\u0009\u000b-\u001f\u007f]/.test(note)
  )
    return null;
  return {
    verdict: x.verdict as EditorialVerdict,
    points: [...(x.points as EditorialPoint[])],
    note,
  };
}
