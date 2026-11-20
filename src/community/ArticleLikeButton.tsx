import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { createLikesClient } from '../editor/likes-client';
import { useViewer } from '../shell/viewer';
import './article-actions.css';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; liked: boolean }
  | { kind: 'saving'; liked: boolean }
  | { kind: 'error'; liked: boolean | null };

/**
 * One-tap public like for signed-in readers. A failed change is never retried
 * automatically; the reader sees the last confirmed state and can try again.
 */
export default function ArticleLikeButton({ contentId }: { contentId: string }) {
  const { viewer, refresh } = useViewer();
  const csrf = viewer.status === 'signed-in' ? viewer.csrfToken : null;
  const hasProfile = viewer.status === 'signed-in' && viewer.profile !== null;
  const client = useMemo(() => (csrf ? createLikesClient(csrf, fetch) : null), [csrf]);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [hint, setHint] = useState<'login' | 'profile' | null>(null);
  useEffect(() => {
    if (!client) {
      setState({ kind: 'idle' });
      return;
    }
    const controller = new AbortController();
    setState({ kind: 'loading' });
    client.read(contentId, controller.signal).then(
      (liked) => {
        if (!controller.signal.aborted) setState({ kind: 'ready', liked });
      },
      () => {
        if (!controller.signal.aborted) setState({ kind: 'error', liked: null });
      },
    );
    return () => controller.abort();
  }, [client, contentId]);
  const liked = state.kind === 'ready' || state.kind === 'saving' ? state.liked : false;
  const busy = state.kind === 'loading' || state.kind === 'saving';
  async function toggle() {
    if (viewer.status !== 'signed-in') {
      setHint('login');
      return;
    }
    if (!client || busy || state.kind === 'idle') return;
    if (state.kind === 'error' && state.liked === null) {
      // Unknown current state: re-read instead of guessing a direction.
      setState({ kind: 'loading' });
      try {
        setState({ kind: 'ready', liked: await client.read(contentId) });
      } catch {
        setState({ kind: 'error', liked: null });
        refresh();
      }
      return;
    }
    const current = state.kind === 'error' ? Boolean(state.liked) : liked;
    if (!current && !hasProfile) {
      setHint('profile');
      return;
    }
    setState({ kind: 'saving', liked: !current });
    try {
      const value = await client.set(contentId, !current);
      setState({ kind: 'ready', liked: value });
    } catch {
      setState({ kind: 'error', liked: current });
      refresh();
    }
  }
  return (
    <div className="article-like">
      <button
        type="button"
        className={'like-toggle' + (liked ? ' is-liked' : '')}
        aria-pressed={viewer.status === 'signed-in' ? liked : undefined}
        disabled={busy}
        onClick={() => void toggle()}
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24">
          <path
            d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.5 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.5 0 5.6 3.5 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"
            fill={liked ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
        {liked ? 'いいね済み' : 'いいね'}
      </button>
      <p className="article-like-note" role="status" aria-live="polite">
        {state.kind === 'error'
          ? '保存できたか確認できませんでした。もう一度押すと最新の状態を確認します。'
          : hint === 'login'
            ? null
            : hint === 'profile'
              ? null
              : liked
                ? 'あなたの公開プロフィールの「いいね」に表示されます。'
                : '役に立ったら、いいねで書いた人に伝えよう。'}
        {hint === 'login' && state.kind !== 'error' && (
          <>
            いいねするには<Link to="/login">ログイン</Link>してください。
          </>
        )}
        {hint === 'profile' && state.kind !== 'error' && (
          <>
            いいねは公開プロフィールに表示されます。先に
            <Link to="/account">マイページで公開プロフィールを作成</Link>してください。
          </>
        )}
      </p>
    </div>
  );
}
