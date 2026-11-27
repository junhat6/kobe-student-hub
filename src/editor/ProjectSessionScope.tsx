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
  inDialog = false,
  surface = 'lab',
  label,
  signedOutMessage = '現在ログインしていません。前の入力・通報内容は閉じています。このローカル検証では学校Googleログインは利用できません。',
  signedInMessage = '有効な既存セッションを確認しました。この画面からログイン・権限付与は行いません。',
}: {
  children: (session: { csrf: string; fetcher: typeof fetch }) => ReactNode;
  initial?: boolean;
  /** In the report dialog the check starts on open; the button is only the way back after a failure. */
  inDialog?: boolean;
  /** 'ordinary' is the student report dialog: same behaviour, plain words (no セッション). */
  surface?: 'lab' | 'ordinary';
  label: string;
  signedOutMessage?: ReactNode;
  /** Shown when an existing session opens the panel; student pages pass '' (the form speaks for itself). */
  signedInMessage?: ReactNode;
}) {
  const lab = surface === 'lab';
  const copy = (legacy: string, ordinary: string) => (lab ? legacy : ordinary);
  const proceedLabel = copy('確認したセッションで通報画面を開く', '確認したアカウントで通報する');
  const client = useMemo(() => createSessionClient(), []);
  const guard = useRef<AuthorSessionGuard | null>(null),
    request = useRef<AbortController | null>(null),
    revision = useRef(0),
    mounted = useRef(true),
    lock = useRef(false),
    privatePanel = useRef<HTMLDivElement>(null),
    token = useRef<string | null>(null),
    review = useRef(false),
    pageActive = useRef(true),
    resumeInspection = useRef(initial);
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
  const canReveal = () =>
    mounted.current && pageActive.current && document.visibilityState === 'visible';
  function reveal() {
    if (canReveal()) setConcealed(false);
    else conceal();
  }
  function cancelInspection() {
    revision.current++;
    request.current?.abort();
    request.current = null;
    lock.current = false;
    setBusy(false);
  }
  function reset() {
    cancelInspection();
    resumeInspection.current = false;
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
        ? copy(
            'セッションを確認できませんでした。入力・通報内容はこのページのメモリに保持したまま隠しています。同じセッションを確認できるまで操作できません。',
            'ログイン状態を確認できませんでした。入力は残したまま隠しています。確認できるまで操作できません。',
          )
        : copy(
            'セッションを確認できませんでした。入力・通報内容は開いていません。',
            'ログイン状態を確認できませんでした。',
          ),
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
            copy(
              'セッションが無効または変更されたため、前の入力・通報内容を消しました。明示的に再確認してから続行してください。',
              'ログインが切れたか変わったため、入力を消しました。',
            ),
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
    if (!canReveal() || lock.current) return;
    resumeInspection.current = false;
    lock.current = true;
    conceal();
    const run = revision.current,
      controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setMessage(copy('既存のセッションを確認しています…', 'ログイン状態を確認しています…'));
    try {
      const csrf = await client.peek(controller.signal);
      if (!canReveal() || run !== revision.current) return;
      if (csrf === token.current) {
        if (!guard.current) install(csrf);
        setCandidate(null);
        reveal();
        setMessage(
          copy(
            '同じセッションを確認しました。保持した入力・通報内容を再開しています。',
            'ログインを確認しました。入力はそのまま残っています。',
          ),
        );
      } else if (token.current !== null) {
        discard(
          copy(
            '別のセッションを確認したため、前の入力・通報内容を消しました。続行には明示的な確認が必要です。',
            `別のアカウントでログインしたため、入力を消しました。「${proceedLabel}」で開き直せます。`,
          ),
        );
        setCandidate(csrf);
      } else if (review.current) {
        setCandidate(csrf);
        setMessage(
          copy(
            '有効なセッションを確認しました。新しい状態を開くには明示的に続行してください。',
            `ログインを確認しました。「${proceedLabel}」で開きます。`,
          ),
        );
      } else {
        install(csrf);
        reveal();
        setMessage(signedInMessage);
      }
    } catch (error) {
      if (canReveal() && run === revision.current) {
        if (error instanceof SessionClientError && error.kind === 'signed-out')
          discard(signedOutMessage);
        else unknown();
      }
    } finally {
      if (mounted.current && run === revision.current) {
        lock.current = false;
        setBusy(false);
        setInspectionGeneration((value) => value + 1);
        if (request.current === controller) request.current = null;
      }
    }
  }
  async function proceed() {
    if (!canReveal() || !candidate || lock.current) return;
    lock.current = true;
    setBusy(true);
    const expected = candidate,
      run = revision.current,
      controller = new AbortController();
    request.current = controller;
    try {
      const csrf = await client.peek(controller.signal);
      if (!canReveal() || run !== revision.current) return;
      if (csrf !== expected) {
        setCandidate(csrf);
        setMessage(
          copy(
            '確認後にセッションが変わりました。もう一度続行を確認してください。',
            `ログイン中のアカウントが変わりました。もう一度「${proceedLabel}」を押してください。`,
          ),
        );
        return;
      }
      install(csrf);
      setCandidate(null);
      reveal();
      setMessage(
        copy('確認したセッションの状態を新しく開きました。前の入力は引き継いでいません。', ''),
      );
    } catch (error) {
      if (canReveal() && run === revision.current) {
        if (error instanceof SessionClientError && error.kind === 'signed-out')
          discard(
            copy(
              'セッションが無効です。入力・通報内容は開いていません。',
              'ログインが切れています。もう一度ログインしてください。',
            ),
          );
        else unknown();
      }
    } finally {
      if (mounted.current && run === revision.current) {
        lock.current = false;
        setBusy(false);
        setInspectionGeneration((value) => value + 1);
        if (request.current === controller) request.current = null;
      }
    }
  }
  useLayoutEffect(() => {
    if (privatePanel.current) {
      const hidden = concealed || !canReveal();
      privatePanel.current.hidden = hidden;
      privatePanel.current.inert = hidden;
    }
  }, [concealed, session, inspectionGeneration]);
  useEffect(() => {
    mounted.current = true;
    pageActive.current = true;
    if (initial) void check();
    const recheck = () => {
      if (token.current || resumeInspection.current) void check();
    };
    const suspend = () => {
      conceal();
      resumeInspection.current = resumeInspection.current || request.current !== null;
      cancelInspection();
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') recheck();
      else suspend();
    };
    const pagehide = () => {
      pageActive.current = false;
      suspend();
    };
    const pageshow = () => {
      pageActive.current = true;
      recheck();
    };
    window.addEventListener('focus', recheck);
    window.addEventListener('pageshow', pageshow);
    window.addEventListener('pagehide', pagehide);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted.current = false;
      revision.current++;
      request.current?.abort();
      guard.current?.invalidate();
      lock.current = false;
      window.removeEventListener('focus', recheck);
      window.removeEventListener('pageshow', pageshow);
      window.removeEventListener('pagehide', pagehide);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  return (
    <>
      <p aria-live="polite">{message}</p>
      {(!inDialog || (concealed && !busy)) && (
        <Button disabled={busy} onClick={() => void check()}>
          {label}
        </Button>
      )}
      {candidate && (
        <Button disabled={busy} onClick={() => void proceed()}>
          {proceedLabel}
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
