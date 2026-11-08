import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button } from '@base-ui/react/button';
import {
  createAuthorSessionGuard,
  createSessionClient,
  SessionClientError,
  type AuthorSessionGuard,
} from './session-client';
import './operator-read.css';
import { createModerationClient } from './moderation-client';
/** Existing-session boundary; operator authority always comes from the server. */
export default function OperatorReadBoundary({
  children,
  decisions = false,
}: {
  children: (fetcher: typeof fetch) => ReactNode;
  decisions?: boolean;
}) {
  const client = useMemo(() => createSessionClient(), []),
    guard = useRef<AuthorSessionGuard | null>(null),
    request = useRef<AbortController | null>(null),
    mounted = useRef(true),
    generation = useRef(0),
    lock = useRef(false),
    panel = useRef<HTMLDivElement>(null),
    scopeRef = useRef<{ fetcher: typeof fetch; generation: number; csrfToken: string } | null>(
      null,
    ),
    mountRevision = useRef(0);
  const [scope, setScope] = useState<typeof scopeRef.current>(null),
    [concealed, setConcealed] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('既存のセッションを確認しています…');
  const guardedFetch = useCallback<typeof fetch>((input, init) => {
    const current = guard.current;
    return current ? current.fetcher(input, init) : Promise.reject(new SessionClientError());
  }, []);
  function hide(text: string, retain: boolean) {
    if (panel.current) {
      panel.current.hidden = true;
      panel.current.inert = true;
    }
    generation.current++;
    request.current?.abort();
    guard.current?.invalidate();
    guard.current = null;
    lock.current = false;
    setBusy(false);
    setConcealed(true);
    if (!retain) {
      scopeRef.current = null;
      setScope(null);
    }
    setMessage(text);
  }
  const discard = (text: string) => hide(text, false);
  const pause = (text: string) => hide(text, decisions);
  async function check() {
    if (lock.current) return;
    pause(
      decisions
        ? '入力を隠して、セッションと運営権限を確認しています…'
        : '前の読取表示を閉じて、既存セッションを確認しています…',
    );
    lock.current = true;
    setBusy(true);
    const run = generation.current,
      controller = new AbortController();
    request.current = controller;
    try {
      const csrf = await client.peek(controller.signal);
      if (!mounted.current || run !== generation.current) return;
      const current = createAuthorSessionGuard({
        csrfToken: csrf,
        origin: location.origin,
        onMismatch: () => {
          if (mounted.current && guard.current === current)
            discard(
              'セッションが無効または変更されたため、前の通報内容を閉じました。明示的に再確認してください。',
            );
        },
        onUnverified: () => {
          if (mounted.current && guard.current === current)
            pause(
              decisions
                ? 'セッションを確認できないため、通報内容と判断入力を隠しています。同じセッションを再確認すると再開できます。'
                : 'セッションを確認できないため、前の通報内容を閉じました。明示的に再確認してください。',
            );
        },
      });
      guard.current = current;
      if (scopeRef.current && scopeRef.current.csrfToken !== csrf) {
        scopeRef.current = null;
        setScope(null);
      }
      if (decisions) await createModerationClient(current.fetcher).queue();
      if (
        !mounted.current ||
        run !== generation.current ||
        (decisions && document.visibilityState !== 'visible')
      )
        return;
      const next = scopeRef.current ?? {
        fetcher: decisions ? guardedFetch : current.fetcher,
        generation: ++mountRevision.current,
        csrfToken: csrf,
      };
      scopeRef.current = next;
      setScope(next);
      setConcealed(false);
      setMessage(
        decisions
          ? 'セッションと運営権限を確認しました。各判断でもサーバーが権限を確認します。'
          : '既存セッションを確認しました。運営権限は各読取要求でサーバーが確認します。',
      );
    } catch (error) {
      if (mounted.current && run === generation.current)
        setMessage(
          error instanceof SessionClientError && error.kind === 'signed-out'
            ? decisions
              ? '現在ログインしていません。アカウント画面からログイン状態を確認してください。運営権限はサーバーの指定が必要です。'
              : '現在ログインしていません。このローカル画面ではログイン・権限付与は利用できません。'
            : decisions
              ? 'セッションまたは運営権限を確認できませんでした。通報内容と入力は表示しません。運営セッションを再確認してください。'
              : 'セッションを確認できませんでした。前の通報内容は表示しません。',
        );
    } finally {
      if (mounted.current && run === generation.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  useLayoutEffect(() => {
    if (panel.current) {
      panel.current.hidden = !scope || concealed;
      panel.current.inert = !scope || concealed;
    }
  }, [scope, concealed]);
  useEffect(() => {
    mounted.current = true;
    void check();
    const conceal = () => {
      if (guard.current || lock.current)
        pause(
          decisions
            ? '画面・フォーカスの切替により通報内容と入力を隠しました。「運営セッションを確認」から再開してください。'
            : '画面・フォーカスの切替により前の通報内容を閉じました。「運営セッションを確認」から、新しいサーバー読取を確認してください。',
        );
    };
    window.addEventListener('focus', conceal);
    window.addEventListener('pageshow', conceal);
    document.addEventListener('visibilitychange', conceal);
    return () => {
      mounted.current = false;
      generation.current++;
      request.current?.abort();
      guard.current?.invalidate();
      lock.current = false;
      window.removeEventListener('focus', conceal);
      window.removeEventListener('pageshow', conceal);
      document.removeEventListener('visibilitychange', conceal);
    };
  }, []);
  return (
    <>
      <p className="operator-read-message" aria-live="polite">
        {message}
      </p>
      <Button disabled={busy} onClick={() => void check()}>
        運営セッションを確認
      </Button>
      <p className="operator-read-note">
        {decisions
          ? '画面切替や確認不能時は入力を隠し、同じセッションと運営権限を再確認してから再開します。別のセッションでは通報内容と入力を破棄します。'
          : '読み取り専用の表示は、画面切替・確認不能・セッション変更時に閉じます。再開には明示的なセッション確認と、新しいサーバー側の権限確認が必要です。既に受信したデータやブラウザのメモリを完全消去する保証ではありません。'}
      </p>
      <div
        className="operator-read-private"
        ref={panel}
        hidden={!scope || concealed}
        inert={!scope || concealed}
      >
        {scope && <div key={scope.generation}>{children(scope.fetcher)}</div>}
      </div>
    </>
  );
}
