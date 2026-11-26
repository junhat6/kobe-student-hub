/**
 * The agent writes 「（AIメモ：…）」 at the top of a draft when it picked the topic alone
 * (worker/agent/guide.ts, SKILL.md). It is a note to the author, never reader text, and the
 * owner removed it by hand before every publication (#302). These helpers find and remove it.
 *
 * Only a memo outside fenced code and inside one paragraph counts, so an article that quotes the
 * marker in a code block, or an unclosed 「（AIメモ」, is never rewritten.
 */
export interface AiMemo {
  start: number;
  end: number;
}

const OPENERS = ['（AIメモ', '(AIメモ'];
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

function fencedRanges(body: string) {
  const ranges: AiMemo[] = [];
  let open: { start: number; marker: string } | null = null;
  let start = 0;
  while (start <= body.length) {
    const newline = body.indexOf('\n', start);
    const end = newline < 0 ? body.length : newline;
    const fence = FENCE.exec(body.slice(start, end));
    if (fence) {
      const marker = fence[1];
      if (!open) open = { start, marker };
      else if (marker[0] === open.marker[0] && marker.length >= open.marker.length) {
        ranges.push({ start: open.start, end });
        open = null;
      }
    }
    if (newline < 0) break;
    start = newline + 1;
  }
  if (open) ranges.push({ start: open.start, end: body.length });
  return ranges;
}

/** Finds each balanced 「（AIメモ…）」 (full- or half-width parentheses). */
export function findAiMemos(body: string): AiMemo[] {
  const fences = fencedRanges(body);
  const inFence = (at: number) => fences.some((r) => at >= r.start && at <= r.end);
  const memos: AiMemo[] = [];
  let from = 0;
  for (;;) {
    let start = -1;
    for (const opener of OPENERS) {
      const at = body.indexOf(opener, from);
      if (at >= 0 && (start < 0 || at < start)) start = at;
    }
    if (start < 0) break;
    from = start + 1;
    if (inFence(start)) continue;
    let depth = 0;
    let end = -1;
    for (let i = start; i < body.length; i++) {
      const c = body[i];
      if (c === '（' || c === '(') depth++;
      else if (c === '）' || c === ')') {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      } else if (c === '\n' && /^[ \t]*\r?(\n|$)/.test(body.slice(i + 1))) break;
      if (inFence(i)) break;
    }
    if (end < 0) continue;
    memos.push({ start, end });
    from = end;
  }
  return memos;
}

/**
 * Removes every memo. A line left blank by the removal goes too, with one blank line after it,
 * so the article starts at its real first paragraph.
 */
export function removeAiMemos(body: string): string {
  const memos = findAiMemos(body);
  let result = body;
  for (const memo of [...memos].reverse()) {
    const lineStart = result.lastIndexOf('\n', memo.start - 1) + 1;
    const newline = result.indexOf('\n', memo.end);
    const lineEnd = newline < 0 ? result.length : newline;
    const rest = result.slice(lineStart, memo.start) + result.slice(memo.end, lineEnd);
    if (rest.trim()) {
      const atLineStart = !result.slice(lineStart, memo.start).trim();
      const before = result.slice(0, memo.start);
      const after = result.slice(memo.end);
      result = atLineStart
        ? before + after.replace(/^[ \t　]+/, '')
        : before.replace(/[ \t　]+$/, '') + after;
      continue;
    }
    let cut = newline < 0 ? result.length : newline + 1;
    const blank = /^[ \t]*\r?\n/.exec(result.slice(cut));
    if (blank) cut += blank[0].length;
    result = result.slice(0, lineStart) + result.slice(cut);
  }
  return result;
}
