/**
 * #274: the operator's comments on a selected passage of one of their own drafts, from its preview
 * (赤ペン). A mark is anchored by the selected text plus a little context before and after
 * (a text-quote selector), and records the draft version it was made on. When the draft changes
 * and the passage is gone, the mark stays and is shown as 「元の箇所が見つかりません」.
 *
 * Private: never part of a public DTO, a public page or MCP. Operator-only on the server.
 */
export const EDITORIAL_MARK_QUOTE_MAX = 200;
export const EDITORIAL_MARK_CONTEXT_MAX = 32;
export const EDITORIAL_MARK_NOTE_MAX = 500;
/** Per draft; the migration's trigger enforces the same bound. */
export const EDITORIAL_MARKS_PER_DRAFT = 100;

export interface EditorialMarkInput {
  quote: string;
  prefix: string;
  suffix: string;
  note: string;
}
export interface EditorialMarkView extends EditorialMarkInput {
  id: string;
  draftVersion: number;
  createdAt: string;
}

const length = (s: string) => Array.from(s).length;
// Selected text may span paragraphs (newlines, tabs); no other control characters.
const badText = (s: string) => /[\u0000-\u0008\u000b-\u001f\u007f]/.test(s);
const exact = (v: unknown, keys: readonly string[]): v is Record<string, unknown> => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  if (Object.getPrototypeOf(v) !== Object.prototype) return false;
  const own = Reflect.ownKeys(v);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(v, k));
};

export function decodeEditorialMarkInput(v: unknown): EditorialMarkInput | null {
  if (!exact(v, ['quote', 'prefix', 'suffix', 'note'])) return null;
  const { quote, prefix, suffix, note } = v;
  if ([quote, prefix, suffix, note].some((s) => typeof s !== 'string')) return null;
  const q = quote as string;
  const n = (note as string).trim();
  if (q.trim() === '' || length(q) > EDITORIAL_MARK_QUOTE_MAX || badText(q)) return null;
  for (const c of [prefix as string, suffix as string])
    if (length(c) > EDITORIAL_MARK_CONTEXT_MAX || badText(c)) return null;
  if (n === '' || length(n) > EDITORIAL_MARK_NOTE_MAX || badText(n.replace(/\t/g, ' ')))
    return null;
  return { quote: q, prefix: prefix as string, suffix: suffix as string, note: n };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function decodeEditorialMarkList(v: unknown): EditorialMarkView[] | null {
  if (!exact(v, ['marks']) || !Array.isArray(v.marks)) return null;
  if (v.marks.length > EDITORIAL_MARKS_PER_DRAFT) return null;
  const out: EditorialMarkView[] = [];
  for (const m of v.marks as unknown[]) {
    if (!exact(m, ['id', 'quote', 'prefix', 'suffix', 'note', 'draftVersion', 'createdAt']))
      return null;
    const { id, draftVersion, createdAt, ...rest } = m;
    const input = decodeEditorialMarkInput(rest);
    if (!input || typeof id !== 'string' || !UUID.test(id)) return null;
    if (typeof draftVersion !== 'number' || !Number.isSafeInteger(draftVersion)) return null;
    if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) return null;
    out.push({ ...input, id, draftVersion, createdAt });
  }
  return out;
}

/**
 * Where a mark's passage is in the current text, or null when it can no longer be found. Among
 * several occurrences of the quote, the one whose surroundings match the saved context best wins.
 */
export function locateMark(
  text: string,
  mark: Pick<EditorialMarkInput, 'quote' | 'prefix' | 'suffix'>,
): { start: number; end: number } | null {
  if (!mark.quote) return null;
  let best: { start: number; score: number } | null = null;
  for (let at = text.indexOf(mark.quote); at !== -1; at = text.indexOf(mark.quote, at + 1)) {
    const before = text.slice(Math.max(0, at - mark.prefix.length), at);
    const after = text.slice(at + mark.quote.length, at + mark.quote.length + mark.suffix.length);
    let score = 0;
    for (let i = 1; i <= Math.min(before.length, mark.prefix.length); i++) {
      if (before[before.length - i] !== mark.prefix[mark.prefix.length - i]) break;
      score++;
    }
    for (let i = 0; i < Math.min(after.length, mark.suffix.length); i++) {
      if (after[i] !== mark.suffix[i]) break;
      score++;
    }
    if (!best || score > best.score) best = { start: at, score };
  }
  return best ? { start: best.start, end: best.start + mark.quote.length } : null;
}
