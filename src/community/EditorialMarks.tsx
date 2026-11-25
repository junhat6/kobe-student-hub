import { useCallback, useEffect, useState, type RefObject } from 'react';
import {
  EDITORIAL_MARK_CONTEXT_MAX,
  EDITORIAL_MARK_NOTE_MAX,
  EDITORIAL_MARK_QUOTE_MAX,
  EDITORIAL_MARKS_PER_DRAFT,
  decodeEditorialMarkList,
  locateMark,
  type EditorialMarkInput,
  type EditorialMarkView,
} from '../shared/editorial-draft-marks';
import { EDITORIAL_REVIEW_RELEASE_ENABLED } from '../shared/editorial-review';
import './editorial-marks.css';

const HIGHLIGHT = 'ksh-editorial-mark';
type Anchor = Omit<EditorialMarkInput, 'note'>;

const init = (method: string, csrf?: string, body?: unknown): RequestInit => ({
  method,
  credentials: 'same-origin',
  cache: 'no-store',
  redirect: 'error',
  headers: csrf
    ? {
        Authorization: 'Bearer csrf.' + csrf,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      }
    : undefined,
  body: body === undefined ? undefined : JSON.stringify(body),
});
const chars = (s: string) => Array.from(s);
const tail = (s: string) => chars(s).slice(-EDITORIAL_MARK_CONTEXT_MAX).join('');
const head = (s: string) => chars(s).slice(0, EDITORIAL_MARK_CONTEXT_MAX).join('');

/** Text offset of a boundary point inside `root`, counted over text nodes (as Range.toString). */
function offsetOf(root: Node, node: Node, offset: number) {
  const r = document.createRange();
  r.setStart(root, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}
/** A DOM range covering text offsets [start, end) of `root`. */
function rangeOf(root: Node, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let at = 0;
  let started = false;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = (n as Text).data.length;
    if (!started && start <= at + len) {
      range.setStart(n, start - at);
      started = true;
    }
    if (started && end <= at + len) {
      range.setEnd(n, end - at);
      return range;
    }
    at += len;
  }
  return null;
}

/**
 * #274: the operator selects text in the preview of one of their own drafts and leaves a comment on
 * that passage (赤ペン). Renders nothing unless the server answers 200 (operator, own draft). Marks
 * whose passage is no longer in the draft stay listed as 「元の箇所が見つかりません」.
 */
export default function EditorialMarks({
  draftId,
  csrfToken,
  target,
}: {
  draftId: string;
  csrfToken: string;
  target: RefObject<HTMLElement | null>;
}) {
  const path = '/api/private/editorial-draft-marks/' + draftId;
  const [marks, setMarks] = useState<EditorialMarkView[] | null>(null);
  const [found, setFound] = useState<Record<string, boolean>>({});
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [tooLong, setTooLong] = useState(false);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');

  useEffect(() => {
    if (!EDITORIAL_REVIEW_RELEASE_ENABLED) return;
    const controller = new AbortController();
    fetch(path, { ...init('GET'), signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) return;
        const list = decodeEditorialMarkList(await r.json());
        if (list && !controller.signal.aborted) setMarks(list);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [path]);

  // Remember the latest selection inside the preview; tapping the form must not lose it (mobile).
  useEffect(() => {
    if (!marks) return;
    const onChange = () => {
      const root = target.current;
      const selection = document.getSelection();
      if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
      const text = root.textContent ?? '';
      const start = offsetOf(root, range.startContainer, range.startOffset);
      const end = offsetOf(root, range.endContainer, range.endOffset);
      const quote = text.slice(start, end);
      if (quote.trim() === '') return;
      if (chars(quote).length > EDITORIAL_MARK_QUOTE_MAX) {
        setTooLong(true);
        setAnchor(null);
        return;
      }
      setTooLong(false);
      setAnchor({ quote, prefix: tail(text.slice(0, start)), suffix: head(text.slice(end)) });
      setStatus('idle');
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, [marks, target]);

  // Locate every mark in the rendered text and paint the found passages (CSS Highlight API).
  const paint = useCallback(() => {
    const root = target.current;
    if (!root || !marks) return;
    const text = root.textContent ?? '';
    const ranges: Range[] = [];
    const next: Record<string, boolean> = {};
    for (const m of marks) {
      const at = locateMark(text, m);
      const range = at && rangeOf(root, at.start, at.end);
      next[m.id] = range !== null;
      if (range) ranges.push(range);
    }
    setFound((prev) =>
      Object.keys(next).length === Object.keys(prev).length &&
      Object.entries(next).every(([k, v]) => prev[k] === v)
        ? prev
        : next,
    );
    if (typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined')
      CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges));
  }, [marks, target]);
  useEffect(() => {
    const root = target.current;
    if (!root || !marks) return;
    paint();
    const observer = new MutationObserver(paint);
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      if (typeof CSS !== 'undefined' && 'highlights' in CSS) CSS.highlights.delete(HIGHLIGHT);
    };
  }, [marks, paint, target]);

  if (!marks) return null;
  const full = marks.length >= EDITORIAL_MARKS_PER_DRAFT;

  async function add() {
    if (!anchor || !note.trim() || status === 'saving' || full) return;
    setStatus('saving');
    try {
      const r = await fetch(path, init('POST', csrfToken, { ...anchor, note: note.trim() }));
      const v = r.status === 201 ? ((await r.json()) as { mark: unknown }) : null;
      const list = v && decodeEditorialMarkList({ marks: [v.mark] });
      if (!list) throw new Error('mark');
      setMarks((prev) => [...(prev ?? []), ...list]);
      setAnchor(null);
      setNote('');
      setStatus('idle');
      document.getSelection()?.removeAllRanges();
    } catch {
      setStatus('error');
    }
  }
  async function remove(id: string) {
    try {
      const r = await fetch(path + '/' + id, init('DELETE', csrfToken));
      if (r.status !== 204) throw new Error('mark');
      setMarks((prev) => (prev ?? []).filter((m) => m.id !== id));
    } catch {
      setStatus('error');
    }
  }

  return (
    <section className="editorial-marks" aria-label="箇所コメント（運営だけに表示）">
      <h4>箇所コメント</h4>
      {anchor ? (
        <div className="editorial-mark-form">
          <blockquote className="editorial-mark-quote">{anchor.quote}</blockquote>
          <textarea
            aria-label="選んだ箇所へのコメント"
            placeholder="この箇所へのコメント"
            maxLength={EDITORIAL_MARK_NOTE_MAX}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="editorial-mark-actions">
            <button
              type="button"
              className="editorial-mark-cancel"
              onClick={() => {
                setAnchor(null);
                setNote('');
              }}
            >
              やめる
            </button>
            <button
              type="button"
              className="editorial-save"
              disabled={!note.trim() || status === 'saving' || full}
              onClick={() => void add()}
            >
              付ける
            </button>
          </div>
        </div>
      ) : (
        <p className="editorial-mark-hint">
          {full
            ? `この下書きには${EDITORIAL_MARKS_PER_DRAFT}件まで付けられます。`
            : tooLong
              ? `${EDITORIAL_MARK_QUOTE_MAX}字までの範囲を選んでください。`
              : '本文の文字を選ぶと、その箇所にコメントを付けられます。'}
        </p>
      )}
      {status === 'error' && (
        <p className="editorial-error" role="alert">
          保存できませんでした
        </p>
      )}
      {marks.length > 0 && (
        <ol className="editorial-mark-list">
          {marks.map((m) => (
            <li key={m.id} className={found[m.id] === false ? 'is-lost' : undefined}>
              <blockquote className="editorial-mark-quote">{m.quote}</blockquote>
              {found[m.id] === false && (
                <p className="editorial-mark-lost">元の箇所が見つかりません</p>
              )}
              <p className="editorial-mark-note">{m.note}</p>
              <button
                type="button"
                className="editorial-mark-delete"
                aria-label="この箇所コメントを削除"
                onClick={() => void remove(m.id)}
              >
                削除
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
