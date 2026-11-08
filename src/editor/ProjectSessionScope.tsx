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
  createSessionClient,
  createAuthorSessionGuard,
  SessionClientError,
  type AuthorSessionGuard,
} from './session-client';
/** Shared report-session boundary. Preserve hidden same-session buffers; never create an identity. */
export default function ProjectSessionScope({
  children,
  initial = false,
  label,
  signedOutMessage = '現在ログインしていません。前の入力・通報内容は閉じています。このローカル検証では学校Googleログインは利用できません。',
}: {
  children: (session: { csrf: string; fetcher: typeof fetch }) => ReactNode;
  initial?: boolean;
  label: string;
  signedOutMessage?: ReactNode;
}) {
  const client = useMemo(() => createSessionClient(), []);
  const guard = useRef<AuthorSessionGuard | null>(null),
    request = useRef<AbortController | null>(null),
    revision = useRef(0),
    mounted = useRef(true),
    lock = useRef(false),
    privatePanel = useRef<HTMLDivElement>(null),
    token = useRef<string | null>(null),
    review = useRef(false);
  const [session, setSession] = useState<{ csrf: string; generation: number } | null>(null),
    [candidate, setCandidate] = useState<string | null>(null),
    [concealed, setConcealed] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState<ReactNode>(''),
    [inspectionGeneration, setInspectionGeneration] = useState(0);
  function conceal() {
    if (privatePanel.current) {
      privatePanel.current.hidden = true;
      privatePanel.current.inert = true;
    }
    setConcealed(true);
  }
  function reset() {
    revision.current++;
    request.current?.abort();
    request.current = null;
    lock.current = false;
    setBusy(false);
    guard.current?.invalidate();
    guard.current = null;
  }
  function discard(text: ReactNode) {
    conceal();
    reset();
    token.current = null;
    setSession(null);
    setCandidate(null);
    review.current = true;
    setMessage(text);
  }
  function unknown() {
    conceal();
    reset();
    setCandidate(null);
    setMessage(
      token.current
        ? 'セッションを確認できませんでした。入力・通報内容はこのページのメモリに保持したまま隠しています。同じセッションを確認できるまで操作できません。'
        : 'セッションを確認できませんでした。入力・通報内容は開いていません。',
    );
  }
  function install(csrf: string) {
    guard.current?.invalidate();
    const current = createAuthorSessionGuard({
      csrfToken: csrf,
      origin: location.origin,
      onMismatch: () => {
        if (mounted.current && guard.current === current)
          discard(
            'セッションが無効または変更されたため、前の入力・通報内容を消しました。明示的に再確認してから続行してください。',
          );
      },
      onUnverified: () => {
        if (mounted.current && guard.current === current) unknown();
      },
    });
    guard.current = current;
    if (token.current !== csrf) {
      token.current = csrf;
      setSession({ csrf, generation: revision.current });
    }
  }
  const guardedFetch = useCallback<typeof fetch>(
    (input, init) =>
      guard.current ? guard.current.fetcher(input, init) : Promise.reject(new SessionClientError()),
    [],
  );
  async function check() {
    if (lock.current) return;
    lock.current = true;
    conceal();
    const run = revision.current,
      controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setMessage('既存のセッションを確認しています…');
    try {
      const csrf = await client.peek(controller.signal);
      if (!mounted.current || run !== revision.current) return;
      if (csrf === token.current) {
        if (!guard.current) install(csrf);
        setCandidate(null);
        setConcealed(false);
        setMessage('同じセッションを確認しました。保持した入力・通報内容を再開しています。');
      } else if (token.current !== null) {
        discard(
          '別のセッションを確認したため、前の入力・通報内容を消しました。続行には明示的な確認が必要です。',
        );
        setCandidate(csrf);
      } else if (review.current) {
        setCandidate(csrf);
        setMessage(
          '有効なセッションを確認しました。新しい状態を開くには明示的に続行してください。',
        );
      } else {
        install(csrf);
        setConcealed(false);
        setMessage(
          '有効な既存セッションを確認しました。この画面からログイン・権限付与は行いません。',
        );
      }
    } catch (error) {
      if (mounted.current && run === revision.current) {
        if (error instanceof SessionClientError && error.kind === 'signed-out')
          discard(signedOutMessage);
        else unknown();
      }
    } finally {
      if (mounted.current && run === revision.current) {
        lock.current = false;
        setBusy(false);
        setInspectionGeneration((value) => value + 1);
      }
    }
  }
  async function proceed() {
    if (!candidate || lock.current) return;
    lock.current = true;
    setBusy(true);
    const expected = candidate,
      run = revision.current,
      controller = new AbortController();
    request.current = controller;
    try {
      const csrf = await client.peek(controller.signal);
      if (!mounted.current || run !== revision.current) return;
      if (csrf !== expected) {
        setCandidate(csrf);
        setMessage('確認後にセッションが変わりました。もう一度続行を確認してください。');
        return;
      }
      install(csrf);
      setCandidate(null);
      setConcealed(false);
      setMessage('確認したセッションの状態を新しく開きました。前の入力は引き継いでいません。');
    } catch (error) {
      if (mounted.current && run === revision.current) {
        if (error instanceof SessionClientError && error.kind === 'signed-out')
          discard('セッションが無効です。入力・通報内容は開いていません。');
        else unknown();
      }
    } finally {
      if (mounted.current && run === revision.current) {
        lock.current = false;
        setBusy(false);
        setInspectionGeneration((value) => value + 1);
      }
    }
  }
  useLayoutEffect(() => {
    if (privatePanel.current) {
      privatePanel.current.hidden = concealed;
      privatePanel.current.inert = concealed;
    }
  }, [concealed, session, inspectionGeneration]);
  useEffect(() => {
    mounted.current = true;
    if (initial) void check();
    const recheck = () => {
      if (token.current) void check();
    };
    const visibility = () => {
      if (!token.current) return;
      if (document.visibilityState === 'visible') recheck();
      else conceal();
    };
    window.addEventListener('focus', recheck);
    window.addEventListener('pageshow', recheck);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted.current = false;
      revision.current++;
      request.current?.abort();
      guard.current?.invalidate();
      lock.current = false;
      window.removeEventListener('focus', recheck);
      window.removeEventListener('pageshow', recheck);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  return (
    <>
      <p aria-live="polite">{message}</p>
      <Button disabled={busy} onClick={() => void check()}>
        {label}
      </Button>
      {candidate && (
        <Button disabled={busy} onClick={() => void proceed()}>
          確認したセッションで通報画面を開く
        </Button>
      )}
      <div
        className="project-private-scope"
        ref={privatePanel}
        hidden={concealed}
        inert={concealed}
      >
        {session && (
          <div key={session.generation}>
            {children({ csrf: session.csrf, fetcher: guardedFetch })}
          </div>
        )}
      </div>
    </>
  );
}
