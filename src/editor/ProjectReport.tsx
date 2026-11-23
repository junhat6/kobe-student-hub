import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@base-ui/react/button';
import { createProjectReportClient, validProjectReportInput } from './project-report-client';
import ProjectSessionScope from './ProjectSessionScope';
import './project-report.css';
type ReportClient = Pick<ReturnType<typeof createProjectReportClient>, 'received' | 'report'>;
/** Shared intake form. `subject` names the target in every label, e.g. 作品 or プロフィール. */
export function ReportForm({
  projectId,
  csrf,
  fetcher,
  onNavigationRiskChange,
  subject = '作品',
  createClient = createProjectReportClient,
  onSubmitted,
}: {
  projectId: string;
  csrf: string;
  fetcher: typeof fetch;
  onNavigationRiskChange?: (risk: boolean) => void;
  subject?: string;
  createClient?: (csrf: string, fetcher: typeof fetch) => ReportClient;
  /** Called once a new report is confirmed received (the dialog closes on it). */
  onSubmitted?: () => void;
}) {
  const client = useMemo(() => createClient(csrf, fetcher), [createClient, csrf, fetcher]);
  const id = useId(),
    mounted = useRef(true),
    generation = useRef(0),
    lock = useRef(false),
    request = useRef<AbortController | null>(null);
  const [input, setInput] = useState({ reason: '', detail: '' }),
    [received, setReceived] = useState(false),
    [known, setKnown] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [message, setMessage] = useState('');
  async function check() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    const run = generation.current,
      controller = new AbortController();
    request.current = controller;
    setConfirmed(false);
    setMessage('このセッションの受付状態を確認しています…');
    try {
      const value = await client.received(projectId, controller.signal);
      if (mounted.current && run === generation.current) {
        setKnown(true);
        setReceived(value.received);
        setUncertain(false);
        if (value.received) setInput({ reason: '', detail: '' });
        setMessage(
          value.received
            ? `この${subject}は、このアカウントから通報済みです。運営が内容を確認します。`
            : 'このセッションの受付はまだありません。内容を確認して送信を選んでください。',
        );
      }
    } catch {
      if (mounted.current && run === generation.current) {
        setKnown(false);
        setUncertain(true);
        setMessage('受付状態を確認できませんでした。未送信とは判断せず、入力も自動再送しません。');
      }
    } finally {
      if (mounted.current && run === generation.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  async function submit() {
    if (
      lock.current ||
      !known ||
      received ||
      uncertain ||
      !confirmed ||
      !validProjectReportInput(input)
    )
      return;
    lock.current = true;
    setBusy(true);
    setConfirmed(false);
    const run = generation.current,
      controller = new AbortController();
    request.current = controller;
    const snapshot = { ...input };
    setMessage('通報の受付結果を確認しています…');
    try {
      await client.report(projectId, snapshot, true, controller.signal);
      if (mounted.current && run === generation.current) {
        setReceived(true);
        setInput({ reason: '', detail: '' });
        setMessage(`送信しました。この${subject}の通報を受け付けました。運営が内容を確認します。`);
        onSubmitted?.();
      }
    } catch {
      if (mounted.current && run === generation.current) {
        setKnown(false);
        setUncertain(true);
        setMessage(
          `送信結果を確認できませんでした。入力は保持し、自動で再送しません。「${subject}通報の受付を確認」で確認してください。`,
        );
      }
    } finally {
      if (mounted.current && run === generation.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    void check();
    return () => {
      mounted.current = false;
      generation.current++;
      lock.current = false;
      request.current?.abort();
    };
  }, [client, projectId]);
  const unsaved = !received && (Boolean(input.reason) || Boolean(input.detail) || uncertain);
  useLayoutEffect(
    () => onNavigationRiskChange?.(unsaved || busy),
    [unsaved, busy, onNavigationRiskChange],
  );
  useEffect(() => () => onNavigationRiskChange?.(false), [onNavigationRiskChange]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    if (unsaved || busy) window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved, busy]);
  function change(key: 'reason' | 'detail', value: string) {
    setInput((current) => ({ ...current, [key]: value }));
    setConfirmed(false);
  }
  return (
    <div className="project-report-form">
      <p
        role="status"
        aria-live="polite"
        className={
          'project-report-status' + (received ? ' is-received' : uncertain ? ' is-uncertain' : '')
        }
      >
        {received && (
          <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" focusable="false">
            <circle cx="12" cy="12" r="11" fill="currentColor" />
            <path
              d="M6.5 12.5l3.5 3.5 7.5-8"
              fill="none"
              stroke="white"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        <span>{message}</span>
      </p>
      {!received && (
        <>
          <Button disabled={busy} onClick={() => void check()}>
            {subject}通報の受付を確認
          </Button>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <fieldset disabled={busy}>
              <legend>運営確認用の非公開テキスト</legend>
              <label htmlFor={id + 'reason'}>{subject}の通報理由（必須）</label>
              <textarea
                id={id + 'reason'}
                readOnly={received || uncertain}
                value={input.reason}
                maxLength={400}
                onChange={(e) => change('reason', e.target.value)}
              />
              <small>{Array.from(input.reason).length}/200文字</small>
              <label htmlFor={id + 'detail'}>{subject}の通報詳細（任意）</label>
              <textarea
                id={id + 'detail'}
                readOnly={received || uncertain}
                value={input.detail}
                maxLength={4000}
                onChange={(e) => change('detail', e.target.value)}
              />
              <small>
                2000文字・8000バイトまで。不要な個人情報や実際の秘密情報は入力しないでください。
              </small>
            </fieldset>
            <label className="project-report-confirm">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={
                  busy || !known || received || uncertain || !validProjectReportInput(input)
                }
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>入力した理由・詳細を、この{subject}の通報として運営確認用に送信します</span>
            </label>
            <Button
              type="submit"
              disabled={
                busy ||
                !known ||
                received ||
                uncertain ||
                !confirmed ||
                !validProjectReportInput(input)
              }
            >
              確認した{subject}通報を送信
            </Button>
          </form>
          <p>
            受付確認はこのセッションからの通報の有無だけです。入力と既存の受付内容の一致や、運営の対応結果を示すものではありません。
          </p>
        </>
      )}
    </div>
  );
}
/** The local lab panel. Student pages use the 「…」 menu in community/OrdinaryProjectReport. */
export default function ProjectReport({
  projectId,
  onNavigationRiskChange,
}: {
  projectId: string;
  onNavigationRiskChange?: (risk: boolean) => void;
}) {
  return (
    <section className="project-report-panel" aria-label="作品の通報">
      <h2>この作品を通報する</h2>
      <p className="project-local">
        架空データのローカル試作です。受付のみで、自動非公開・通知・運営判断は行いません。実際の学校ログインや運営連絡先は未提供です。
      </p>
      <p>
        理由・詳細は匿名の作品画面や一般読者には表示しません。確認できるまで入力を隠し、同じセッションなら保持した入力を再開します。無効・変更なら前の入力を破棄し、別の状態は明示確認後に開きます。
      </p>
      <ProjectSessionScope label="作品通報の準備を確認">
        {(session) => (
          <ReportForm
            projectId={projectId}
            csrf={session.csrf}
            fetcher={session.fetcher}
            onNavigationRiskChange={onNavigationRiskChange}
          />
        )}
      </ProjectSessionScope>
    </section>
  );
}
