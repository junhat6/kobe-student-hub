import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@base-ui/react/button';
import {
  createAuthorSessionGuard,
  createSessionClient,
  SessionClientError,
  type AuthorSessionGuard,
} from './session-client';
import './operator-read.css';
/** Article operator READ-ONLY view. No editable buffers, identity creation or role authority. */
export default function OperatorReadBoundary({
  children,
}: {
  children: (fetcher: typeof fetch) => ReactNode;
}) {
  const client = useMemo(() => createSessionClient(), []),
    guard = useRef<AuthorSessionGuard | null>(null),
    request = useRef<AbortController | null>(null),
    mounted = useRef(true),
    generation = useRef(0),
    lock = useRef(false),
    panel = useRef<HTMLDivElement>(null);
  const [scope, setScope] = useState<{ fetcher: typeof fetch; generation: number } | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('既存のセッションを確認しています…');
  function discard(text: string) {
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
    setScope(null);
    setMessage(text);
  }
  async function check() {
    if (lock.current) return;
    discard('前の読取表示を閉じて、既存セッションを確認しています…');
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
            discard(
              'セッションを確認できないため、前の通報内容を閉じました。明示的に再確認してください。',
            );
        },
      });
      guard.current = current;
      setScope({ fetcher: current.fetcher, generation: run });
      setMessage('既存セッションを確認しました。運営権限は各読取要求でサーバーが確認します。');
    } catch (error) {
      if (mounted.current && run === generation.current)
        setMessage(
          error instanceof SessionClientError && error.kind === 'signed-out'
            ? '現在ログインしていません。このローカル画面ではログイン・権限付与は利用できません。'
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
      panel.current.hidden = !scope;
      panel.current.inert = !scope;
    }
  }, [scope]);
  useEffect(() => {
    mounted.current = true;
    void check();
    const conceal = () => {
      if (guard.current || lock.current)
        discard(
          '画面・フォーカスの切替により前の通報内容を閉じました。「運営セッションを確認」から、新しいサーバー読取を確認してください。',
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
        読み取り専用の表示は、画面切替・確認不能・セッション変更時に閉じます。再開には明示的なセッション確認と、新しいサーバー側の権限確認が必要です。既に受信したデータやブラウザのメモリを完全消去する保証ではありません。
      </p>
      <div className="operator-read-private" ref={panel} hidden={!scope} inert={!scope}>
        {scope && <div key={scope.generation}>{children(scope.fetcher)}</div>}
      </div>
    </>
  );
}
