/**
 * Card preview of a project description. The description is Markdown, but cards, search matching
 * and the agent listing show it as plain text, so syntax (image embeds, link targets, list and
 * heading markers, emphasis) must not leak as raw symbols and media IDs (#301).
 *
 * Line-by-line with simple, non-nested patterns so the cost stays linear in the bounded input
 * (descriptions are at most 16 KiB). This is a display projection, not a sanitizer: the client
 * renders it as text, never as HTML or Markdown.
 */
export const PROJECT_PREVIEW_CHARS = 300;

// Backslash-escaped punctuation is shielded in the Private Use Area while markers are removed,
// so `\*word\*` shows as `*word*` instead of being read as emphasis.
const shield = (line: string) =>
  line.replace(/\\([!-/:-@[-`{-~])/g, (_, c: string) =>
    String.fromCharCode(0xe000 + c.charCodeAt(0)),
  );
const unshield = (line: string) =>
  line.replace(/[-]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xe000));

// Each bracketed part excludes its own opener, so a scan stops at the next candidate and a
// long run of unmatched openers stays linear instead of quadratic.
const inline = (line: string): string =>
  unshield(
    shield(line)
      // Images disappear (alt text is usually a caption duplicating the title).
      .replace(/!\[[^[\]\n]*\]\([^()\n]*\)/g, '')
      .replace(/!\[[^[\]\n]*\]\[[^[\]\n]*\]/g, '')
      // Links keep their text only.
      .replace(/\[([^[\]\n]*)\]\([^()\n]*\)/g, '$1')
      .replace(/\[([^[\]\n]*)\]\[[^[\]\n]*\]/g, '$1')
      .replace(/<((?:https?|mailto):[^<>\s]*)>/gi, '$1')
      // Raw HTML tags.
      .replace(/<\/?[A-Za-z][^<>\n]*>/g, '')
      // Inline code keeps its content.
      .replace(/`+([^`\n]*)`+/g, '$1')
      // Emphasis and strikethrough markers.
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')
      .replace(/__([^_\n]+)__/g, '$1')
      .replace(/~~([^~\n]+)~~/g, '$1')
      .replace(/(^|[^\w*])\*([^*\s][^*\n]*)\*(?![\w*])/g, '$1$2')
      .replace(/(^|[^\w_])_([^_\s][^_\n]*)_(?![\w_])/g, '$1$2'),
  );

export const projectDescriptionPreview = (markdown: string): string => {
  const out: string[] = [];
  let fence: string | null = null;
  let rawBlock: string | null = null;
  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    // A script/style/textarea/pre HTML block is skipped whole by the detail page's renderer
    // (skipHtml), so its body must not surface in the preview either.
    if (rawBlock === null) {
      const open = /^ {0,3}<(script|style|textarea|pre)(?=[\s>]|$)/i.exec(raw);
      if (open) rawBlock = open[1]!.toLowerCase();
    }
    if (rawBlock !== null) {
      if (raw.toLowerCase().includes(`</${rawBlock}>`)) rawBlock = null;
      continue;
    }
    const fenceMark = /^ {0,3}(`{3,}|~{3,})/.exec(raw);
    if (fence) {
      if (fenceMark && fenceMark[1]![0] === fence[0] && fenceMark[1]!.length >= fence.length)
        fence = null;
      continue; // Code blocks are not prose; leave them out of the preview.
    }
    if (fenceMark) {
      fence = fenceMark[1]!;
      continue;
    }
    // Reference definitions, thematic breaks and table delimiter rows carry no prose.
    if (/^ {0,3}\[[^\]\n]+\]:\s/.test(raw)) continue;
    if (/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(raw)) continue;
    if (/^ {0,3}(?:=+|-+)[ \t]*$/.test(raw) && out.length && out[out.length - 1]) continue;
    if (raw.includes('|') && raw.includes('-') && /^[\s|:-]+$/.test(raw)) continue;
    let line = raw.replace(/^(?: {0,3}>[ \t]?)+/, ''); // blockquote
    const heading = /^ {0,3}#{1,6}(?:[ \t]+|$)/.exec(line);
    if (heading) line = line.slice(heading[0].length).replace(/(?:^|[ \t]+)#+[ \t]*$/, '');
    line = line.replace(/^\s*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/, ''); // list item / task
    if (/^\s*\|.*\|\s*$/.test(line))
      line = line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean)
        .join(' ');
    out.push(
      inline(line)
        .replace(/[ \t]+/g, ' ')
        .trim(),
    );
  }
  const text = out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return Array.from(text).slice(0, PROJECT_PREVIEW_CHARS).join('');
};
