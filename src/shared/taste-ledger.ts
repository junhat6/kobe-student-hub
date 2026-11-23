/**
 * The student's own taste ledger (C23, DECISIONS 2026-11-23). Lines are written by the student's
 * own agent over MCP; the server only checks their shape and limits. It never judges whether a line
 * is abstract and never calls an inference API. Private: only the student's own agent reads it.
 */
export type TasteKind = 'writing' | 'app';
export type TasteBasis = 'instruction' | 'reviews' | 'diffs';
export interface TasteLine {
  kind: TasteKind;
  text: string;
  basis: TasteBasis;
  /** Number of reviews or diffs behind the line. Absent for the student's own instruction. */
  count?: number;
  /** YYYY-MM-DD */
  date: string;
}

export const TASTE_LIMITS = { lines: 40, chars: 200, count: 10000 } as const;

const KINDS: TasteKind[] = ['writing', 'app'];
const BASES: TasteBasis[] = ['instruction', 'reviews', 'diffs'];
// Line breaks (including U+0085, U+2028, U+2029) and control characters.
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Returns the normalized lines, or an error message for HTTP 400 / JSON-RPC -32602. */
export function parseTasteLines(input: unknown): TasteLine[] | string {
  if (!Array.isArray(input)) return 'lines は配列で渡してください。';
  if (input.length > TASTE_LIMITS.lines)
    return `lines は${TASTE_LIMITS.lines}行までにしてください。`;
  const lines: TasteLine[] = [];
  for (const [i, raw] of input.entries()) {
    const at = `${i + 1}行目：`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      return at + '行はオブジェクトで渡してください。';
    const r = raw as Record<string, unknown>;
    const unknown = Object.keys(r).filter(
      (k) => !['kind', 'text', 'basis', 'count', 'date'].includes(k),
    );
    if (unknown.length) return at + '受け付けない項目があります：' + unknown.join(', ');
    if (!KINDS.includes(r.kind as TasteKind))
      return at + 'kind は writing（書き方）か app（アプリ）にしてください。';
    if (typeof r.text !== 'string') return at + 'text は文字列にしてください。';
    const text = r.text.trim();
    if (!text || Array.from(text).length > TASTE_LIMITS.chars || FORBIDDEN.test(text))
      return at + `text は1〜${TASTE_LIMITS.chars}文字の1行（改行・制御文字なし）にしてください。`;
    if (!BASES.includes(r.basis as TasteBasis))
      return (
        at +
        'basis は instruction（本人の指示）・reviews（レビュー）・diffs（差分）のどれかにしてください。'
      );
    const basis = r.basis as TasteBasis;
    if (basis === 'instruction') {
      if (r.count !== undefined) return at + 'basis が instruction のときは count を付けません。';
    } else if (
      typeof r.count !== 'number' ||
      !Number.isSafeInteger(r.count) ||
      r.count < 1 ||
      r.count > TASTE_LIMITS.count
    )
      return (
        at + `basis が ${basis} のときは count に1〜${TASTE_LIMITS.count}の件数を渡してください。`
      );
    if (!validDate(r.date)) return at + 'date は YYYY-MM-DD の日付にしてください。';
    lines.push({
      kind: r.kind as TasteKind,
      text,
      basis,
      ...(basis === 'instruction' ? {} : { count: r.count as number }),
      date: r.date,
    });
  }
  return lines;
}

/** Reads stored JSON back defensively; malformed rows are dropped rather than trusted. */
export function storedTasteLines(json: string | null | undefined): TasteLine[] {
  if (!json) return [];
  try {
    const parsed = parseTasteLines(JSON.parse(json));
    return typeof parsed === 'string' ? [] : parsed;
  } catch {
    return [];
  }
}

export function formatTasteLine(line: TasteLine) {
  const basis =
    line.basis === 'instruction'
      ? '本人の指示'
      : line.basis === 'reviews'
        ? `レビュー ${line.count}件`
        : `差分 ${line.count}件`;
  return `- ${line.text}（${basis} ${line.date}）`;
}
