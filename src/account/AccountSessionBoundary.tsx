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
} from '../editor/session-client';
import { announceSessionChange, announceSessionConfirmed } from '../shell/viewer';
import type { ProjectFields } from '../project-types';
import LoadingSkeleton from '../shared/LoadingSkeleton';
type Phase =
  | 'checking'
  | 'active'
  | 'review'
  | 'signed-out'
  | 'unverified'
  | 'logout-pending'
  | 'logout-unknown';
/**
 * Unsaved input kept in page memory only when the session itself expired.
 * A project that was never saved has no id: it is shown for copying but never applied
 * to the next session, because nothing on the client can prove it is the same account.
 */
export type UnsavedRescue =
  | { kind: 'article'; draftId: string; title: string; body: string }
  | { kind: 'project'; projectId: string | null; fields: ProjectFields };
const PROJECT_LABELS: [keyof ProjectFields, string][] = [
  ['technologies', '使った技術'],
  ['githubUrl', 'GitHub URL'],
  ['demoUrl', 'デモ URL'],
];
/** The plain text shown in the read-only rescue box and copied to the clipboard. */
function rescueText(value: UnsavedRescue) {
  if (value.kind === 'article') return (value.title ? value.title + '\n\n' : '') + value.body;
  const { fields } = value;
  const lines = PROJECT_LABELS.filter(([key]) => fields[key]).map(
    ([key, label]) => label + '：' + fields[key],
  );
  return [fields.title, lines.join('\n'), fields.description].filter(Boolean).join('\n\n');
}
export interface RescueChannel {
  /** The editor registers how to read its unsaved buffer; null unregisters. */
  provide: (read: (() => UnsavedRescue | null) | null) => void;
  /** Text waiting to be restored after the user signs in again. */
  pending: UnsavedRescue | null;
  /** Called only after the server opened the same draft for the new session. */
  restored: () => void;
}
export interface AccountSessionBoundaryProps {
  variant?: 'lab' | 'account' | 'authoring';
  children: (session: {
    csrfToken: string;
    fetcher: typeof fetch;
    rescue?: RescueChannel;
  }) => ReactNode;
  signedOutContent?: ReactNode;
  title?: string;
  onRescueChange?: (value: boolean) => void;
}
/** Shown (to screen readers only) on ordinary pages when nobody is signed in. */
const NOT_SIGNED_IN = 'ログインしていません。';
const expiredWithRescue = (value: UnsavedRescue) =>
  value.kind === 'article'
    ? 'ログインの有効期限が切れたため、最後の変更を保存できませんでした。保存できなかった文章を下に残しています。'
    : 'ログインの有効期限が切れたため、最後の変更を保存できませんでした。保存できなかった作品の入力を下に残しています。';
/** Reuses the existing UI consumption guard; server authentication remains authoritative. */
export default function AccountSessionBoundary({
  variant = 'account',
  children,
  signedOutContent,
  title,
  onRescueChange,
}: AccountSessionBoundaryProps) {
  const lab = variant === 'lab',
    authoring = variant === 'authoring';
  const copy = (legacy: string, account: string, drafts = account) =>
    lab ? legacy : authoring ? drafts : account;
  const client = useMemo(() => createSessionClient(), []);
  const mounted = useRef(true);
  const revision = useRef(0);
  const checkingRef = useRef(false);
  const logoutRef = useRef(false);
  const inspection = useRef<AbortController | null>(null);
  const pageActive = useRef(true);
  const initialInspection = useRef(true);
  const resumeInspection = useRef(true);
  const guard = useRef<AuthorSessionGuard | null>(null);
  const tokenRef = useRef<string | null>(null);
  const privatePanel = useRef<HTMLDivElement>(null);
  const rescueReader = useRef<(() => UnsavedRescue | null) | null>(null);
  const rescueRef = useRef<UnsavedRescue | null>(null);
  const [rescue, setRescueState] = useState<UnsavedRescue | null>(null);
  const [copyMessage, setCopyMessage] = useState('');
  const setRescue = (value: UnsavedRescue | null) => {
    rescueRef.current = value;
    setRescueState(value);
    setCopyMessage('');
  };
  // Only an expired session keeps the unsaved buffer. A different session still destroys it.
  function keepUnsaved() {
    if (!authoring) return;
    let value: UnsavedRescue | null = null;
    try {
      value = rescueReader.current?.() ?? null;
    } catch {
      value = null;
    }
    if (value) setRescue(value);
  }
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [concealed, setConcealed] = useState(true);
  const [phase, setPhase] = useState<Phase>('checking');
  // Read by the mount-time focus/visibility listeners, which would otherwise see a stale phase.
  const phaseRef = useRef<Phase>('checking');
  phaseRef.current = phase;
  const [checking, setChecking] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [message, setMessage] = useState(
      copy('既存のセッションを確認しています…', 'ログイン状態を確認しています…'),
    ),
    [inspectionGeneration, setInspectionGeneration] = useState(0);
  const conceal = () => {
    if (privatePanel.current) {
      privatePanel.current.hidden = true;
      privatePanel.current.inert = true;
    }
    setConcealed(true);
  };
  const canReveal = () =>
    mounted.current && pageActive.current && document.visibilityState === 'visible';
  const reveal = () => {
    if (canReveal()) setConcealed(false);
    else conceal();
  };
  // A lifecycle boundary cancels the proof, not the editor or its unsaved buffer.
  function cancelInspection() {
    revision.current++;
    inspection.current?.abort();
    inspection.current = null;
    checkingRef.current = false;
    setChecking(false);
  }
  function resetPending() {
    cancelInspection();
    guard.current?.invalidate();
    guard.current = null;
  }
  function clearPrivate() {
    initialInspection.current = false;
    resumeInspection.current = false;
    conceal();
    resetPending();
    tokenRef.current = null;
    setSessionToken(null);
    setCandidate(null);
  }
  function unknown() {
    initialInspection.current = false;
    resumeInspection.current = false;
    conceal();
    resetPending();
    setCandidate(null);
    setPhase('unverified');
    setMessage(
      tokenRef.current
        ? copy(
            'セッションを確認できませんでした。手元の編集はこのページのメモリ内に保持したまま隠しています。再確認できるまで操作できません。',
            'ログイン状態を確認できませんでした。このページの入力は残したまま隠しています。確認できるまで操作できません。',
            'ログイン状態を確認できませんでした。編集中の内容は残したまま隠しています。確認できるまで操作できません。',
          )
        : copy(
            'セッションを確認できませんでした。編集画面は開いていません。もう一度確認してください。',
            'ログイン状態を確認できませんでした。もう一度確認してください。',
          ),
    );
  }
  function install(current: string) {
    guard.current?.invalidate();
    const bound = createAuthorSessionGuard({
      csrfToken: current,
      origin: location.origin,
      onMismatch: (kind) => {
        if (!mounted.current || guard.current !== bound) return;
        if (kind === 'signed-out') keepUnsaved();
        clearPrivate();
        // The header read the session earlier and would keep the old name and menu until the
        // next focus; let it re-read now, so it offers 「ログイン」 or the new account instead.
        announceSessionChange();
        setPhase(kind === 'signed-out' ? 'signed-out' : 'review');
        setMessage(
          kind === 'signed-out'
            ? rescueRef.current
              ? expiredWithRescue(rescueRef.current)
              : copy(
                  '現在のセッションは無効です。前の編集画面は閉じています。',
                  'ログインが切れました。もう一度ログインしてください。',
                )
            : copy(
                '別のセッションを検出したため、前の編集画面を閉じました。セッションを再確認してから続行してください。',
                'ログインが変わったため、前の画面を閉じました。',
              ),
        );
        // Ordinary pages go straight to the explicit "open the confirmed session" step
        // instead of leaving the reader at a dead end that needs a separate re-check.
        // Nothing private is shown until the reader presses it.
        if (!lab) {
          // Let the next focus/visibility check find whoever is signed in now; a
          // replaced session can look signed out for a moment while it is swapped.
          resumeInspection.current = true;
          if (kind !== 'signed-out') void inspect(false);
        }
      },
      onUnverified: () => {
        if (mounted.current && guard.current === bound) unknown();
      },
    });
    guard.current = bound;
    tokenRef.current = current;
    setSessionToken(current);
    announceSessionConfirmed();
  }
  // SDK instances keep this stable proxy across a hidden/same-session recovery.
  const guardedFetch = useCallback<typeof fetch>((input, init) => {
    const active = guard.current;
    return active ? active.fetcher(input, init) : Promise.reject(new SessionClientError());
  }, []);
  async function inspect(allowInitialMount = false) {
    if (!canReveal() || checkingRef.current || logoutRef.current) return;
    resumeInspection.current = false;
    checkingRef.current = true;
    setChecking(true);
    conceal();
    // A signed-out page re-checks by itself on focus (after a sign-in in another tab). Keep its
    // sign-in links and message still meanwhile, so a click is never lost and nothing is re-announced.
    if (lab || phaseRef.current !== 'signed-out' || rescueRef.current)
      setMessage(copy('現在のセッションを確認しています…', 'ログイン状態を確認しています…'));
    const request = revision.current;
    const controller = new AbortController();
    inspection.current = controller;
    try {
      // A single dropped proof request must not hide the editor: retry the read first.
      const current = await client.peekSteadily(controller.signal);
      if (!canReveal() || request !== revision.current) return;
      initialInspection.current = false;
      if (tokenRef.current === current) {
        if (!guard.current) install(current);
        setCandidate(null);
        setPhase('active');
        setMessage(
          copy(
            '同じセッションを確認しました。手元の編集を保持して再開しています。',
            'ログインを確認しました。入力はそのまま残っています。',
          ),
        );
        reveal();
      } else if (tokenRef.current !== null) {
        clearPrivate();
        setCandidate(current);
        setPhase('review');
        setMessage(
          copy(
            '別のセッションを確認したため、前の編集内容を閉じました。新しい編集画面を開くには、明示的に続行してください。',
            '別のアカウントでログインしたため、前の画面と入力を閉じました。「確認したアカウントを開く」で開き直せます。',
            '別のアカウントでログインしたため、前の下書きと入力を閉じました。「下書きを開き直す」で開き直せます。',
          ),
        );
      } else if (allowInitialMount) {
        install(current);
        setCandidate(null);
        setPhase('active');
        setMessage(
          copy(
            '有効な既存セッションを確認しました。この画面からログインやアカウント作成は行っていません。',
            'ログインしています。',
            // Participation is read later; this line must stay true even when writes are closed.
            'ログインを確認しました。',
          ),
        );
        reveal();
      } else {
        setCandidate(current);
        setPhase('review');
        setMessage(
          rescueRef.current
            ? rescueRef.current.kind === 'article'
              ? 'ログインを確認しました。「下書きを開き直す」を押すと、保存できなかった文章を同じ下書きに戻します。'
              : rescueRef.current.projectId
                ? 'ログインを確認しました。「下書きを開き直す」を押すと、保存できなかった入力を同じ作品に戻します。'
                : 'ログインを確認しました。保存前の新しい作品の入力は自動では戻しません。下に残した入力をコピーして使ってください。'
            : copy(
                '有効なセッションを確認しました。編集画面はまだ開いていません。内容を新しく読み込むには続行してください。',
                'ログインを確認しました。「確認したアカウントを開く」で開きます。',
                'ログインを確認しました。「下書きを開き直す」で開きます。',
              ),
        );
      }
    } catch (error) {
      if (!canReveal() || request !== revision.current) return;
      initialInspection.current = false;
      if (error instanceof SessionClientError && error.kind === 'signed-out') {
        if (tokenRef.current) keepUnsaved();
        clearPrivate();
        // Ordinary pages look again on the next focus, so the reader who signs in from another
        // tab never needs a "check" button to continue (#251).
        if (!lab) resumeInspection.current = true;
        setPhase('signed-out');
        setMessage(
          rescueRef.current
            ? expiredWithRescue(rescueRef.current)
            : copy(
                '現在ログインしていません。このローカル画面では学校Googleログインやアカウント作成は利用できません。',
                NOT_SIGNED_IN,
              ),
        );
      } else unknown();
    } finally {
      if (mounted.current && request === revision.current && inspection.current === controller) {
        checkingRef.current = false;
        setChecking(false);
        setInspectionGeneration((value) => value + 1);
        if (inspection.current === controller) inspection.current = null;
      }
    }
  }
  async function proceed() {
    if (!canReveal() || !candidate || checkingRef.current || logoutRef.current) return;
    const expected = candidate;
    checkingRef.current = true;
    setChecking(true);
    const request = revision.current;
    const controller = new AbortController();
    inspection.current = controller;
    try {
      const current = await client.peek(controller.signal);
      if (!canReveal() || request !== revision.current) return;
      if (current !== expected) {
        setCandidate(current);
        setMessage(
          copy(
            '確認後にセッションが変わりました。編集画面は開かず、改めて続行の確認を待っています。',
            'ログイン中のアカウントが変わりました。もう一度「確認したアカウントを開く」を押してください。',
            'ログイン中のアカウントが変わりました。もう一度「下書きを開き直す」を押してください。',
          ),
        );
        return;
      }
      install(current);
      setCandidate(null);
      setPhase('active');
      setMessage(
        rescueRef.current
          ? rescueRef.current.kind === 'article'
            ? '下書きを開きました。保存できなかった文章を同じ下書きに戻しています。'
            : '作品を開きました。'
          : copy(
              '確認したセッションの編集画面を新しく開きました。前のセッションの入力は引き継いでいません。',
              'アカウント情報を開きました。',
              '下書きを開きました。',
            ),
      );
      reveal();
    } catch (error) {
      if (!canReveal() || request !== revision.current) return;
      initialInspection.current = false;
      if (error instanceof SessionClientError && error.kind === 'signed-out') {
        clearPrivate();
        setPhase('signed-out');
        setMessage(
          copy(
            '現在のセッションは無効です。編集画面は開いていません。',
            'ログインが切れています。もう一度ログインしてください。',
          ),
        );
      } else unknown();
    } finally {
      if (mounted.current && request === revision.current && inspection.current === controller) {
        checkingRef.current = false;
        setChecking(false);
        setInspectionGeneration((value) => value + 1);
        if (inspection.current === controller) inspection.current = null;
      }
    }
  }
  async function logout() {
    const previous = tokenRef.current;
    if (!previous || logoutRef.current || concealed) return;
    if (
      !window.confirm(
        copy(
          '未保存の文章や公開情報は、この画面から消えます。このブラウザのセッションを終了しますか？',
          'このページの未保存の入力は消えます。このブラウザのセッションを終了しますか？',
        ),
      )
    )
      return;
    logoutRef.current = true;
    setLoggingOut(true);
    clearPrivate();
    setPhase('logout-pending');
    setMessage(
      copy(
        '編集画面を閉じて、このブラウザのログアウト結果を確認しています…',
        'アカウント情報を閉じて、このブラウザのログアウト結果を確認しています…',
        '下書きを閉じて、このブラウザのログアウト結果を確認しています…',
      ),
    );
    const request = revision.current;
    try {
      await client.logout(previous);
      if (mounted.current && request === revision.current) {
        setPhase('signed-out');
        setMessage(
          'このブラウザのセッションをログアウトしました。他のセッションの終了は確認していません。',
        );
      }
    } catch {
      if (mounted.current && request === revision.current) {
        setPhase('logout-unknown');
        setMessage(
          copy(
            'ログアウトの結果を確認できませんでした。編集画面は閉じたままです。セッションの状態を手動で確認してください。',
            'ログアウトの結果を確認できませんでした。アカウント情報は閉じたままです。セッションの状態を手動で確認してください。',
            'ログアウトの結果を確認できませんでした。下書きは閉じたままです。セッションの状態を手動で確認してください。',
          ),
        );
      }
    } finally {
      logoutRef.current = false;
      if (mounted.current) setLoggingOut(false);
    }
  }
  useLayoutEffect(() => {
    if (privatePanel.current) {
      const hidden = concealed || !canReveal();
      privatePanel.current.hidden = hidden;
      privatePanel.current.inert = hidden;
    }
  }, [concealed, sessionToken, inspectionGeneration]);
  useEffect(() => {
    mounted.current = true;
    pageActive.current = true;
    void inspect(initialInspection.current);
    const recheck = () => {
      if (!logoutRef.current && (tokenRef.current || resumeInspection.current || rescueRef.current))
        void inspect(initialInspection.current);
    };
    const suspend = () => {
      conceal();
      if (logoutRef.current) return;
      resumeInspection.current = resumeInspection.current || inspection.current !== null;
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
      inspection.current?.abort();
      guard.current?.invalidate();
      window.removeEventListener('focus', recheck);
      window.removeEventListener('pageshow', pageshow);
      window.removeEventListener('pagehide', pagehide);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  const rescueChannel = useMemo<RescueChannel | undefined>(
    () =>
      authoring
        ? {
            provide: (read) => {
              rescueReader.current = read;
            },
            pending: rescue,
            restored: () => {
              if (mounted.current) setRescue(null);
            },
          }
        : undefined,
    [authoring, rescue],
  );
  useEffect(() => {
    onRescueChange?.(rescue !== null);
    if (!rescue) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [rescue, onRescueChange]);
  useEffect(() => () => onRescueChange?.(false), [onRescueChange]);
  const rescueValue = rescue ? rescueText(rescue) : '';
  const rescueNoun = rescue?.kind === 'project' ? '作品の入力' : '文章';
  async function copyRescue() {
    try {
      await navigator.clipboard.writeText(rescueValue);
      if (mounted.current) setCopyMessage(rescueNoun + 'をコピーしました。');
    } catch {
      if (mounted.current)
        setCopyMessage('コピーできませんでした。文章を選択してコピーしてください。');
    }
  }
  function discardRescue() {
    if (
      window.confirm(
        '保存できなかった' +
          rescueNoun +
          'をこの画面から消します。消した' +
          rescueNoun +
          'は元に戻せません。消しますか？',
      )
    )
      setRescue(null);
  }
  // Outside the lab, a confirmed session needs no visible session chrome: the header owns
  // identity and logout. The live region stays for assistive technology.
  const quiet = !lab && phase === 'active' && !concealed && !checking && !candidate;
  // Signed out (or still on the first check), the only useful next step is the page's own
  // sign-in links: the re-check runs by itself, and the logout note belongs to signed-in pages.
  // A kept rescue still offers the manual re-check after signing in again in a new tab (#251).
  const signedOutQuiet =
    !lab && !candidate && !rescue && (phase === 'signed-out' || phase === 'checking');
  // The page's own sign-in button already says what to do when nobody is signed in, so the plain
  // "not signed in" line is kept for screen readers only. Why a page closed (expired, switched)
  // stays visible (#320).
  const hideMessage =
    quiet || (signedOutQuiet && phase === 'signed-out' && message === NOT_SIGNED_IN);
  return (
    <div className={lab ? 'session-account-lab' : 'session-account'}>
      <section
        className={'session-control' + (quiet ? ' session-control-quiet' : '')}
        aria-label={
          lab
            ? '既存セッションの確認'
            : authoring
              ? '下書きのセッション確認'
              : 'アカウントのセッション確認'
        }
      >
        {lab && <p className="session-eyebrow">LOCAL AUTHOR SESSION</p>}
        <h1>{title ?? (lab ? 'セッションと編集画面' : authoring ? '下書き' : 'アカウント')}</h1>
        {lab && (
          <p className="session-local-notice">
            架空のアカウントを使うローカル専用の検証です。このページからログイン・アカウント作成・権限付与は行いません。
          </p>
        )}
        <p
          className={'session-message' + (hideMessage ? ' sr-only' : '')}
          aria-live="polite"
          aria-atomic="true"
        >
          {message}
        </p>
        <div className="session-actions" hidden={quiet || signedOutQuiet}>
          <Button disabled={checking || loggingOut} onClick={() => void inspect(false)}>
            {lab ? 'セッションを再確認' : 'ログイン状態を確認'}
          </Button>
          {candidate && (
            <Button disabled={checking || loggingOut} onClick={() => void proceed()}>
              {lab
                ? '確認したセッションで編集を開く'
                : authoring
                  ? '下書きを開き直す'
                  : '確認したアカウントを開く'}
            </Button>
          )}
          {lab && sessionToken && phase === 'active' && !concealed && (
            <Button disabled={checking || loggingOut} onClick={() => void logout()}>
              このブラウザをログアウト
            </Button>
          )}
        </div>
        {concealed && sessionToken && (
          <p className="session-hidden-note">
            {lab
              ? '確認できるまで、編集中の文章は表示・操作できません。同じセッションの確認が取れれば、このページに保持した編集を再開できます。'
              : authoring
                ? '確認できるまで、編集中の文章は表示・操作できません。同じアカウントと確かめられたら、続きから再開できます。'
                : '確認できるまで、アカウント情報は表示・操作できません。同じアカウントと確かめられたら、入力の続きから再開できます。'}
          </p>
        )}
        {lab ? (
          <p className="session-scope-note">
            別タブの変更を常時検知するものではありません。ログアウトは同じブラウザ文脈のセッションと保留中の認証試行が対象です。別端末の終了は確認していません。通信の中止で、すでに保存・公開された操作を取り消すことはできません。ページを閉じると未保存の入力は失われます。
          </p>
        ) : quiet || signedOutQuiet ? null : (
          <details className="session-scope-note">
            <summary>ログアウトと入力の保持について</summary>
            <p>
              ログアウトはこのブラウザが対象です。別端末は終了しません。ページを閉じると未保存の入力は失われます。通信の中止で、すでに保存された変更を取り消すことはできません。
            </p>
          </details>
        )}
      </section>
      {rescue && (
        <section className="session-rescue" aria-labelledby="session-rescue-heading">
          <h2 id="session-rescue-heading">保存できなかった{rescueNoun}</h2>
          <p>
            この{rescueNoun}
            はこのページの中にだけ残っています。ページを閉じたり再読み込みしたりすると消えます。
            {phase === 'active'
              ? ''
              : rescue.kind === 'article'
                ? '新しいタブでログインし直してからこのタブに戻ると、同じ下書きに戻して続きを保存できます。'
                : rescue.projectId
                  ? '新しいタブでログインし直してからこのタブに戻ると、同じ作品に戻して続きを保存できます。'
                  : '保存前の新しい作品だったため、ログインし直しても自動では戻しません。コピーして、ログイン後の入力欄に貼り付けてください。'}
          </p>
          <textarea
            readOnly
            aria-label={'保存できなかった' + rescueNoun + 'の内容'}
            value={rescueValue}
            rows={Math.min(12, Math.max(4, rescueValue.split('\n').length + 1))}
          />
          <div className="session-rescue-actions">
            {phase !== 'active' && (
              <a className="primary" href="/login" target="_blank" rel="noopener">
                新しいタブでログインし直す
              </a>
            )}
            <Button onClick={() => void copyRescue()}>
              {rescue.kind === 'project' ? '入力をコピー' : '文章をコピー'}
            </Button>
            <Button onClick={discardRescue}>
              {rescue.kind === 'project' ? 'この入力を破棄' : 'この文章を破棄'}
            </Button>
          </div>
          <p className="session-rescue-copy" aria-live="polite">
            {copyMessage}
          </p>
        </section>
      )}
      {phase === 'signed-out' && !loggingOut && !rescue && signedOutContent}
      {/* While a check runs, the private panel stays hidden; a neutral placeholder holds its
          place so the page does not go blank (#272). It shows nothing from the previous session,
          and the session message above is the one that announces the wait. */}
      {!lab && concealed && (checking || phase === 'checking') && !candidate && !rescue && (
        <LoadingSkeleton shape="rows" label="" announce={false} className="session-skeleton" />
      )}
      <div ref={privatePanel} className="session-private" hidden={concealed} inert={concealed}>
        {sessionToken && (
          <div key={sessionToken}>
            {children({ csrfToken: sessionToken, fetcher: guardedFetch, rescue: rescueChannel })}
          </div>
        )}
      </div>
    </div>
  );
}
