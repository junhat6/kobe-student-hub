export type MarkdownTool = 'heading' | 'bold' | 'code';
export interface MarkdownFormat {
  body: string;
  start: number;
  end: number;
}
export const textareaText = (value: string) => value.replace(/\r\n?/g, '\n');
function rawOffset(value: string, offset: number) {
  let raw = 0,
    dom = 0;
  while (raw < value.length && dom < offset) {
    raw += value[raw] === '\r' && value[raw + 1] === '\n' ? 2 : 1;
    dom++;
  }
  return raw;
}
const domOffset = (value: string, offset: number) => textareaText(value.slice(0, offset)).length;
function insidePair(value: string, position: number) {
  return (
    position > 0 &&
    position < value.length &&
    /[\uD800-\uDBFF]/.test(value[position - 1]) &&
    /[\uDC00-\uDFFF]/.test(value[position])
  );
}
interface Line {
  start: number;
  end: number;
  eol: string;
}
function lines(value: string) {
  const result: Line[] = [];
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '\r' && value[i] !== '\n') continue;
    const eol = value[i] === '\r' && value[i + 1] === '\n' ? '\r\n' : value[i];
    result.push({ start, end: i, eol });
    i += eol.length - 1;
    start = i + 1;
  }
  result.push({ start, end: value.length, eol: '' });
  return result;
}
interface Edit {
  start: number;
  end: number;
  text: string;
}
function editSource(value: string, edits: Edit[], start: number, end: number) {
  let body = '',
    position = 0;
  for (const edit of edits) {
    body += value.slice(position, edit.start) + edit.text;
    position = edit.end;
  }
  body += value.slice(position);
  const map = (offset: number) => {
    let delta = 0;
    for (const edit of edits) {
      if (offset < edit.start) break;
      if (offset <= edit.end) return edit.start + delta + edit.text.length;
      delta += edit.text.length - (edit.end - edit.start);
    }
    return offset + delta;
  };
  return { body, start: domOffset(body, map(start)), end: domOffset(body, map(end)) };
}
/** Selection offsets are textarea/LF offsets; untouched source line endings remain exact. */
export function formatMarkdown(
  value: string,
  tool: MarkdownTool,
  start: number,
  end: number,
): MarkdownFormat | null {
  const length = textareaText(value).length;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end > length
  )
    return null;
  const first = rawOffset(value, start),
    last = rawOffset(value, end);
  if (insidePair(value, first) || insidePair(value, last)) return null;
  if (tool === 'bold') {
    const selected = value.slice(first, last) || '強調する言葉';
    const body = value.slice(0, first) + '**' + selected + '**' + value.slice(last);
    return {
      body,
      start: domOffset(body, first + 2),
      end: domOffset(body, first + 2 + selected.length),
    };
  }
  const all = lines(value);
  const from = all.findIndex((line) => first >= line.start && first <= line.end);
  let to = all.findIndex((line) => last >= line.start && last <= line.end);
  if (from < 0 || to < 0) return null;
  if (last > first && last === all[to].start) to--;
  to = Math.max(from, to);
  const covered = all.slice(from, to + 1);
  const blockStart = covered[0].start,
    blockEnd = covered[covered.length - 1].end;
  const blank = covered.length === 1 && !value.slice(blockStart, blockEnd).trim();
  if (tool === 'heading') {
    if (blank) {
      const placeholder = '見出し',
        relative = first - blockStart;
      const body =
        value.slice(0, blockStart) +
        '## ' +
        value.slice(blockStart, first) +
        placeholder +
        value.slice(first);
      return {
        body,
        start: domOffset(body, blockStart + 3 + relative),
        end: domOffset(body, blockStart + 3 + relative + placeholder.length),
      };
    }
    const edits: Edit[] = [];
    for (const line of covered) {
      const content = value.slice(line.start, line.end);
      if (!content.trim()) continue;
      const prefix = /^( {0,3})#{1,6}(?:[ \t]+|$)/.exec(content);
      edits.push(
        prefix
          ? {
              start: line.start + prefix[1].length,
              end: line.start + prefix[0].length,
              text: '## ',
            }
          : { start: line.start, end: line.start, text: '## ' },
      );
    }
    return editSource(value, edits, first, last);
  }
  let payload = value.slice(blockStart, blockEnd);
  let selectionStart = first - blockStart,
    selectionEnd = Math.min(last, blockEnd) - blockStart;
  if (blank) {
    payload = payload.slice(0, selectionStart) + 'コード' + payload.slice(selectionStart);
    selectionEnd = selectionStart + 'コード'.length;
  }
  let longest = 0,
    run = 0;
  for (let i = 0; i < payload.length; i++) {
    run = payload[i] === '`' ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const fence = '`'.repeat(Math.max(3, longest + 1));
  const eol =
    covered.find((line) => line.eol)?.eol ||
    all[from - 1]?.eol ||
    all.find((line) => line.eol)?.eol ||
    '\n';
  const opening = fence + eol;
  const body = value.slice(0, blockStart) + opening + payload + eol + fence + value.slice(blockEnd);
  return {
    body,
    start: domOffset(body, blockStart + opening.length + selectionStart),
    end: domOffset(body, blockStart + opening.length + selectionEnd),
  };
}
