import { useEffect, useState } from 'react';
import {
  EDITORIAL_NOTE_MAX,
  EDITORIAL_POINTS,
  EDITORIAL_REVIEW_RELEASE_ENABLED,
  decodeEditorialReviewInput,
  type EditorialPoint,
  type EditorialReviewInput,
  type EditorialVerdict,
} from '../shared/editorial-review';
import { useViewer } from '../shell/viewer';
import './editorial-review.css';

const VERDICTS: { value: EditorialVerdict; label: string; icon: string }[] = [
  {
    value: 'good',
    label: '良い',
    icon: 'M7 11v9H4v-9h3zm2 9h8.2a2 2 0 0 0 2-1.6l1.2-6A2 2 0 0 0 18.4 10H14V6a2 2 0 0 0-2-2l-3 7v9z',
  },
  { value: 'ok', label: 'ふつう', icon: 'M4 12h16' },
  {
    value: 'bad',
    label: '合わない',
    icon: 'M7 13V4H4v9h3zm2-9h8.2a2 2 0 0 1 2 1.6l1.2 6A2 2 0 0 1 18.4 14H14v4a2 2 0 0 1-2 2l-3-7V4z',
  },
];
const init = (method: string, csrf?: string, body?: unknown): RequestInit => ({
  method,
  credentials: 'same-origin',
  cache: 'no-store',
  redirect: 'error',
  headers: csrf
    ? { Authorization: 'Bearer csrf.' + csrf, 'Content-Type': 'application/json' }
    : undefined,
  body: body === undefined ? undefined : JSON.stringify(body),
});
async function readReview(
  id: string,
  signal: AbortSignal,
): Promise<EditorialReviewInput | null | 'hidden'> {
  const r = await fetch('/api/private/editorial-reviews/' + id, { ...init('GET'), signal });
  if (r.status === 404) return 'hidden';
  if (!r.ok) throw new Error('editorial');
  const v = (await r.json()) as { review: unknown };
  if (v.review === null) return null;
  const { reviewedAt: _ignored, ...rest } = (v.review ?? {}) as Record<string, unknown>;
  const decoded = decodeEditorialReviewInput(rest);
  if (!decoded) throw new Error('editorial');
  return decoded;
}

/**
 * Owner-only editorial review under a published article. Renders nothing for anyone the server
 * does not treat as an operator (the API answers 404), so readers never see it.
 */
export default function EditorialReview({ contentId }: { contentId: string }) {
  const { viewer } = useViewer();
  const csrf = viewer.status === 'signed-in' ? viewer.csrfToken : null;
  const [visible, setVisible] = useState(false);
  const [verdict, setVerdict] = useState<EditorialVerdict | null>(null);
  const [points, setPoints] = useState<EditorialPoint[]>([]);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  useEffect(() => {
    if (!EDITORIAL_REVIEW_RELEASE_ENABLED || !csrf) return;
    const controller = new AbortController();
    readReview(contentId, controller.signal).then(
      (review) => {
        if (controller.signal.aborted || review === 'hidden') return;
        setVisible(true);
        if (review) {
          setVerdict(review.verdict);
          setPoints(review.points);
          setNote(review.note);
          setStatus('saved');
        }
      },
      () => {},
    );
    return () => controller.abort();
  }, [contentId, csrf]);
  if (!visible || !csrf) return null;
  const change = () => setStatus('idle');
  async function save() {
    if (!verdict || status === 'saving') return;
    setStatus('saving');
    try {
      const r = await fetch(
        '/api/private/editorial-reviews/' + contentId,
        init('PUT', csrf!, { verdict, points, note: note.trim() }),
      );
      setStatus(r.ok ? 'saved' : 'error');
    } catch {
      setStatus('error');
    }
  }
  return (
    <section className="editorial-review" aria-label="編集レビュー（運営だけに表示）">
      <div className="editorial-verdicts" role="radiogroup" aria-label="この記事は">
        {VERDICTS.map((v) => (
          <button
            key={v.value}
            type="button"
            role="radio"
            aria-checked={verdict === v.value}
            aria-label={v.label}
            title={v.label}
            className={'editorial-verdict is-' + v.value}
            onClick={() => {
              setVerdict(v.value);
              change();
            }}
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24">
              <path
                d={v.icon}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ))}
      </div>
      <div className="editorial-points">
        {EDITORIAL_POINTS.map((p) => {
          const on = points.includes(p.code);
          return (
            <button
              key={p.code}
              type="button"
              aria-pressed={on}
              className={'editorial-point is-' + p.tone}
              onClick={() => {
                setPoints(on ? points.filter((x) => x !== p.code) : [...points, p.code]);
                change();
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <textarea
        aria-label="ひとこと"
        placeholder="ひとこと"
        maxLength={EDITORIAL_NOTE_MAX}
        rows={2}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          change();
        }}
      />
      <button
        type="button"
        className="editorial-save"
        disabled={!verdict || status === 'saving' || status === 'saved'}
        aria-label={status === 'saved' ? 'レビューを記録済み' : 'レビューを記録'}
        onClick={() => void save()}
      >
        {status === 'saved' ? '✓' : '記録'}
      </button>
      {status === 'error' && (
        <p className="editorial-error" role="alert">
          記録できませんでした
        </p>
      )}
    </section>
  );
}
