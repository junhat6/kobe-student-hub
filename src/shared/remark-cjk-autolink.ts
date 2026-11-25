// GFM literal autolinks only stop at ASCII whitespace/punctuation, so a bare URL written
// inside Japanese text swallows the closing "）", "、", "」" and the rest of the sentence.
// This runs after remark-gfm and cuts such links at CJK punctuation or an unbalanced ")",
// leaving the remainder as plain text (re-linking any further URL in it).
type MdNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
  position?: { start?: { offset?: number } };
};

// CJK symbols/punctuation (incl. U+3000 ideographic space) and full-width ASCII punctuation.
const CJK_STOP = /[　-〿！-／：-＠［-｀｛-･]/;
// Same trailing punctuation GFM drops from a literal autolink.
const TRAILING = /[!"'*,.:;?_~\]]+$/;
const START = /(?:https?:\/\/|www\.)/gi;

function cutAutolink(text: string): string {
  let depth = 0;
  let end = text.length;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      if (depth === 0) {
        end = i;
        break;
      }
      depth -= 1;
    } else if (CJK_STOP.test(ch)) {
      end = i;
      break;
    }
  }
  return text.slice(0, end).replace(TRAILING, '');
}

function linkNode(template: MdNode | null, head: string): MdNode | null {
  // Needs something after the scheme/"www." to be a link at all.
  const scheme = /^https?:\/\//i.test(head) ? '' : 'http://';
  if (!/^(?:https?:\/\/|www\.)[^/?#]*[A-Za-z0-9\u0080-￿]/i.test(head)) return null;
  return {
    ...(template ?? { type: 'link' }),
    url: scheme + head,
    children: [{ type: 'text', value: head }],
  };
}

function linkifyRest(text: string): MdNode[] {
  const nodes: MdNode[] = [];
  let from = 0;
  START.lastIndex = 0;
  for (let m = START.exec(text); m; m = START.exec(text)) {
    if (m.index > 0 && /[A-Za-z0-9]/.test(text[m.index - 1])) continue;
    const head = cutAutolink(text.slice(m.index));
    const link = linkNode(null, head);
    if (!link) continue;
    if (m.index > from) nodes.push({ type: 'text', value: text.slice(from, m.index) });
    nodes.push(link);
    from = m.index + head.length;
    START.lastIndex = from;
  }
  if (from < text.length) nodes.push({ type: 'text', value: text.slice(from) });
  return nodes;
}

function isLiteralAutolink(node: MdNode, source: string): node is MdNode & { url: string } {
  if (node.type !== 'link' || typeof node.url !== 'string') return false;
  const offset = node.position?.start?.offset;
  // Explicit "[label](url)" and "<url>" links are left exactly as written.
  if (offset === undefined || source[offset] === '[' || source[offset] === '<') return false;
  const text = node.children?.length === 1 ? node.children[0] : null;
  if (text?.type !== 'text' || typeof text.value !== 'string') return false;
  return /^(?:https?:\/\/|www\.)/i.test(text.value) && node.url.endsWith(text.value);
}

function fix(parent: MdNode, source: string) {
  if (!parent.children) return;
  const out: MdNode[] = [];
  for (const child of parent.children) {
    if (!isLiteralAutolink(child, source)) {
      fix(child, source);
      out.push(child);
      continue;
    }
    const text = child.children![0].value!;
    const head = cutAutolink(text);
    if (head === text) {
      out.push(child);
      continue;
    }
    const link = linkNode(child, head);
    if (link) out.push(link);
    out.push(...linkifyRest(link ? text.slice(head.length) : text));
  }
  parent.children = out;
}

export default function remarkCjkAutolink() {
  return (tree: MdNode, file: { value?: unknown }) => fix(tree, String(file.value ?? ''));
}
