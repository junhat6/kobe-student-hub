import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { createLikesClient } from '../editor/likes-client';
import { useViewer } from '../shell/viewer';
import Icon from '../shared/Icon';
import './article-actions.css';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; liked: boolean }
  | { kind: 'saving'; liked: boolean }
  | { kind: 'error'; liked: boolean | null }
  // The change did not take: the server confirmed the old state after the failure.
  | { kind: 'failed'; liked: boolean };

/**
 * One-tap public like for signed-in readers. A failed change is never resent
 * automatically: the button re-reads the stored state by itself (原則4) and only
 * an unreadable state or a change that did not take is shown in visible text (原則6).
 */
export default function ArticleLikeButton({
  contentId,
  actions,
}: {
  contentId: string;
  /** Controls shown right after the button, before the note (e.g. sharing, #227). */
  actions?: ReactNode;
}) {
  const { viewer, refresh } = useViewer();
  // #174: the account page offers the way back here once the profile exists.
  const { pathname } = useLocation();
  const csrf = viewer.status === 'signed-in' ? viewer.csrfToken : null;
  // Only a confirmed "no profile" blocks a like; an unreadable profile lets the server decide.
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
  // After a failed save, keep showing the last state the server confirmed.
  const liked =
    state.kind === 'ready' || state.kind === 'saving' || state.kind === 'failed'
      ? state.liked
      : state.kind === 'error'
        ? Boolean(state.liked)
        : false;
  // While the session is still being checked, a press would wrongly ask a signed-in reader to log in.
  // Signed in but the first read has not started yet (one render before the effect runs): a press
  // there would be dropped silently by toggle(), so it counts as loading too.
  const busy =
    viewer.status === 'loading' ||
    (client !== null && state.kind === 'idle') ||
    state.kind === 'loading' ||
    state.kind === 'saving';
  // Re-read the stored state instead of resending. `attempted` is the change that may have failed.
  async function reread(confirmed: boolean | null, attempted?: boolean) {
    if (!client) return;
    setState({ kind: 'loading' });
    try {
      const stored = await client.read(contentId);
      setState(
        attempted === undefined || stored === attempted
          ? { kind: 'ready', liked: stored }
          : { kind: 'failed', liked: stored },
      );
    } catch {
      setState({ kind: 'error', liked: confirmed });
      refresh();
    }
  }
  async function toggle() {
    if (viewer.status !== 'signed-in') {
      setHint('login');
      return;
    }
    if (!client || busy || state.kind === 'idle') return;
    if (state.kind === 'error') {
      // The last change may or may not have been stored: re-read instead of resending.
      await reread(state.liked);
      return;
    }
    const current = liked;
    if (!current && !hasProfile) {
      setHint('profile');
      return;
    }
    setState({ kind: 'saving', liked: !current });
    try {
      const value = await client.set(contentId, !current);
      setState({ kind: 'ready', liked: value });
    } catch {
      // Unknown outcome: never resend; read what the server stored (the screen re-reads itself).
      await reread(current, !current);
    }
  }
  return (
    <div className="article-like">
      <div className="article-like-row">
        <button
          type="button"
          className={'like-toggle' + (liked ? ' is-liked' : '')}
          aria-pressed={viewer.status === 'signed-in' && state.kind !== 'error' ? liked : undefined}
          title={liked ? 'いいねを取り消す' : undefined}
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
          {/* The filled heart and aria-pressed say "liked"; the label stays the same (原則2). */}
          いいね
        </button>
        {actions}
      </div>
      <p
        className={
          'article-like-note' +
          (state.kind === 'error' || state.kind === 'failed' ? ' is-error' : '')
        }
        role="status"
        aria-live="polite"
      >
        {state.kind === 'error' ? (
          <>
            いいねの状態を確認できませんでした。
            <button type="button" className="article-like-retry" onClick={() => void toggle()}>
              もう一度
            </button>
          </>
        ) : state.kind === 'failed' ? (
          'いいねを変更できませんでした。'
        ) : hint === 'login' ? null : hint === 'profile' ? null : (
          // Liking is public: a globe and one line instead of a paragraph (原則2).
          <>
            <Icon name="globe" size={14} />
            いいねは公開プロフィールに表示されます。
          </>
        )}
        {hint === 'login' && state.kind !== 'error' && (
          <>
            いいねするには<Link to="/login">ログイン</Link>してください。
          </>
        )}
        {hint === 'profile' && state.kind !== 'error' && (
          <>
            いいねは公開プロフィールに表示されます。先に
            <Link to="/account" state={{ returnTo: pathname }}>
              マイページで公開プロフィールを作成
            </Link>
            してください。
          </>
        )}
      </p>
    </div>
  );
}
