/**
 * Bounded, non-AI line diff (C23). Used to show a student's own agent how the student changed the
 * draft the agent wrote. Deterministic and cheap: common prefix/suffix are trimmed, the middle is
 * compared with an LCS table only while it stays small, and the output is capped in lines and
 * characters, so a 256 KB body can never turn into an unbounded response or CPU spike.
 */
export interface LineDiff {
  /** Lines only in `after` (the student's text). */
  added: number;
  /** Lines only in `before` (the agent's text). */
  removed: number;
  /** Changed lines in order, `-` from before and `+` from after. Capped by `maxChanges`. */
  changes: { op: '+' | '-'; line: string }[];
  /** True when changes were cut at `maxChanges`, a line was shortened, or the input was too long. */
  truncated: boolean;
  /** True when the middle was too large for the LCS table and counted as a whole replacement. */
  approximate: boolean;
}

export const DIFF_LIMITS = {
  /** Lines read from each side. Lines after this are ignored and `truncated` is set. */
  maxLines: 2000,
  /** Cells of the LCS table for the differing middle part. */
  maxCells: 1_000_000,
  /** Changed lines returned. */
  maxChanges: 120,
  /** Characters kept from each returned line. */
  maxLineChars: 200,
} as const;

const splitLines = (text: string) => (text === '' ? [] : text.split(/\r\n|\r|\n/));

export function lineDiff(before: string, after: string, limits = DIFF_LIMITS): LineDiff {
  const a0 = splitLines(before);
  const b0 = splitLines(after);
  let truncated = a0.length > limits.maxLines || b0.length > limits.maxLines;
  const a = a0.slice(0, limits.maxLines);
  const b = b0.slice(0, limits.maxLines);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const ops: { op: '+' | '-'; line: string }[] = [];
  let approximate = false;
  if ((midA.length + 1) * (midB.length + 1) > limits.maxCells) {
    approximate = true;
    for (const line of midA) ops.push({ op: '-', line });
    for (const line of midB) ops.push({ op: '+', line });
  } else {
    // lcs[i][j] = LCS length of midA[i..] and midB[j..], stored row-major.
    const w = midB.length + 1;
    const lcs = new Uint16Array((midA.length + 1) * w);
    for (let i = midA.length - 1; i >= 0; i--)
      for (let j = midB.length - 1; j >= 0; j--)
        lcs[i * w + j] =
          midA[i] === midB[j]
            ? lcs[(i + 1) * w + j + 1] + 1
            : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    let i = 0;
    let j = 0;
    while (i < midA.length || j < midB.length) {
      if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
        i++;
        j++;
      } else if (
        j < midB.length &&
        (i === midA.length || lcs[i * w + j + 1] >= lcs[(i + 1) * w + j])
      )
        ops.push({ op: '+', line: midB[j++] });
      else ops.push({ op: '-', line: midA[i++] });
    }
  }
  const added = ops.filter((o) => o.op === '+').length;
  const changes = ops.slice(0, limits.maxChanges).map((o) => {
    const chars = Array.from(o.line);
    if (chars.length <= limits.maxLineChars) return o;
    truncated = true;
    return { op: o.op, line: chars.slice(0, limits.maxLineChars).join('') + '…' };
  });
  if (ops.length > limits.maxChanges) truncated = true;
  return { added, removed: ops.length - added, changes, truncated, approximate };
}
