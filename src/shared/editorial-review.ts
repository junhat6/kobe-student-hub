/**
 * Editorial review: the owner (an operator) records how a published article reads to them, so the
 * owner's taste accumulates in one place and the editor loop can turn it into writing guidance
 * (docs/loop/prompts/editor.md → src/agent/editorial-taste.ts).
 *
 * R2 (operator-only private data + migration 0030). Flip only after an independent verification
 * in a separate context. The Worker and the UI read the same constant.
 */
export const EDITORIAL_REVIEW_RELEASE_ENABLED = true;

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
const EDITORIAL_POINT_CODES: readonly string[] = EDITORIAL_POINTS.map((p) => p.code);
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

/** Window of the operator's 好み summary (C22 condition 5). */
export const EDITORIAL_SUMMARY_DAYS = 30;

/** Newest AI-written drafts whose lines are compared for the 好み screen (same bound as the editor's materials). */
export const EDITORIAL_AI_DIFF_COMPARED = 8;

/**
 * How the operator changed the drafts their own AI agent wrote (C22 condition 5), as numbers only.
 * `drafts` counts every AI-written draft recorded in the window; the line counts, `published` and
 * the median days cover only the newest `compared` of them. A published draft is compared with the
 * latest published body, any other with the current draft. Never a title, a line or an id.
 */
export interface EditorialAiDiff {
  days: number;
  drafts: number;
  compared: number;
  edited: number;
  added: number;
  removed: number;
  published: number;
  /** Median days from the AI creating the draft to its publication, one decimal; null when none is known. */
  medianDaysToPublish: number | null;
  /** True when a body was too long or too different to count every line exactly. */
  approximate: boolean;
}

/**
 * The operator's 好み screen: the operator ledger (writing and app lines) and counts only.
 * Never carries a note, an article, an author or a reviewer.
 */
export interface EditorialTasteSummary {
  ledger: { taste: string[]; product: string[]; updated: string };
  reviews: {
    days: number;
    total: number;
    verdicts: Record<EditorialVerdict, number>;
    points: Record<EditorialPoint, number>;
  };
  aiDiff: EditorialAiDiff;
}

const countMap = (v: unknown, keys: readonly string[]): Record<string, number> | null => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const x = v as Record<string, unknown>;
  if (Object.keys(x).length !== keys.length) return null;
  const out: Record<string, number> = {};
  for (const k of keys) {
    const n = x[k];
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) return null;
    out[k] = n;
  }
  return out;
};
const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const AI_DIFF_KEYS = [
  'days',
  'drafts',
  'compared',
  'edited',
  'added',
  'removed',
  'published',
  'medianDaysToPublish',
  'approximate',
] as const;
function decodeAiDiff(v: unknown): EditorialAiDiff | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const x = v as Record<string, unknown>;
  if (
    Object.keys(x).length !== AI_DIFF_KEYS.length ||
    !AI_DIFF_KEYS.every((k) => Object.hasOwn(x, k))
  )
    return null;
  const median = x.medianDaysToPublish;
  if (
    x.days !== EDITORIAL_SUMMARY_DAYS ||
    !count(x.drafts) ||
    !count(x.compared) ||
    !count(x.edited) ||
    !count(x.added) ||
    !count(x.removed) ||
    !count(x.published) ||
    (x.compared as number) > EDITORIAL_AI_DIFF_COMPARED ||
    (x.compared as number) > (x.drafts as number) ||
    (x.edited as number) > (x.compared as number) ||
    (x.published as number) > (x.compared as number) ||
    typeof x.approximate !== 'boolean' ||
    !(
      median === null ||
      (typeof median === 'number' && Number.isFinite(median) && median >= 0 && x.published !== 0)
    )
  )
    return null;
  return {
    days: EDITORIAL_SUMMARY_DAYS,
    drafts: x.drafts as number,
    compared: x.compared as number,
    edited: x.edited as number,
    added: x.added as number,
    removed: x.removed as number,
    published: x.published as number,
    medianDaysToPublish: median as number | null,
    approximate: x.approximate,
  };
}
const lines = (v: unknown) =>
  Array.isArray(v) && v.length <= 100 && v.every((l) => typeof l === 'string' && l.length <= 400)
    ? [...(v as string[])]
    : null;

/** Strict client-side decoder for the summary. Returns null for anything unexpected. */
export function decodeEditorialTasteSummary(v: unknown): EditorialTasteSummary | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const x = v as Record<string, unknown>;
  const ledger = x.ledger as Record<string, unknown> | null;
  const reviews = x.reviews as Record<string, unknown> | null;
  if (!ledger || typeof ledger !== 'object' || !reviews || typeof reviews !== 'object') return null;
  const taste = lines(ledger.taste);
  const product = lines(ledger.product);
  if (!taste || !product || typeof ledger.updated !== 'string') return null;
  const verdicts = countMap(reviews.verdicts, EDITORIAL_VERDICTS);
  const points = countMap(reviews.points, EDITORIAL_POINT_CODES);
  const aiDiff = decodeAiDiff(x.aiDiff);
  if (
    !verdicts ||
    !points ||
    reviews.days !== EDITORIAL_SUMMARY_DAYS ||
    typeof reviews.total !== 'number' ||
    !Number.isSafeInteger(reviews.total) ||
    reviews.total < 0 ||
    !aiDiff
  )
    return null;
  return {
    ledger: { taste, product, updated: ledger.updated },
    reviews: {
      days: EDITORIAL_SUMMARY_DAYS,
      total: reviews.total,
      verdicts: verdicts as Record<EditorialVerdict, number>,
      points: points as Record<EditorialPoint, number>,
    },
    aiDiff,
  };
}
