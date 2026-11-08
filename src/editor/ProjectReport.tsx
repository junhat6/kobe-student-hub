import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PublicSurface } from '../shared/public-paths';
import { Button } from '@base-ui/react/button';
import { createProjectReportClient, validProjectReportInput } from './project-report-client';
import ProjectSessionScope from './ProjectSessionScope';
import './project-report.css';
function ProjectReportForm({
  projectId,
  csrf,
  fetcher,
  onNavigationRiskChange,
}: {
  projectId: string;
  csrf: string;
  fetcher: typeof fetch;
  onNavigationRiskChange?: (risk: boolean) => void;
}) {
  const client = useMemo(() => createProjectReportClient(csrf, fetcher), [csrf, fetcher]);
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
        setMessage(
          value.received
            ? 'このアカウントの受付記録を確認しました。理由の一致や通知・非公開化・判断の確認ではありません。'
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
        setMessage(
          'このアカウントの受付記録を確認しました。理由の一致や通知・非公開化・判断の確認ではありません。',
        );
      }
    } catch {
      if (mounted.current && run === generation.current) {
        setKnown(false);
        setUncertain(true);
        setMessage(
          '送信結果を確認できませんでした。入力は保持し、自動で再送しません。「作品通報の受付を確認」で確認してください。',
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
      <p role="status" aria-live="polite">
        {message}
      </p>
      <Button disabled={busy} onClick={() => void check()}>
        作品通報の受付を確認
      </Button>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy}>
          <legend>運営確認用の非公開テキスト</legend>
          <label htmlFor={id + 'reason'}>作品の通報理由（必須）</label>
          <textarea
            id={id + 'reason'}
            readOnly={received || uncertain}
            value={input.reason}
            maxLength={400}
            onChange={(e) => change('reason', e.target.value)}
          />
          <small>{Array.from(input.reason).length}/200文字</small>
          <label htmlFor={id + 'detail'}>作品の通報詳細（任意）</label>
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
            disabled={busy || !known || received || uncertain || !validProjectReportInput(input)}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>入力した理由・詳細を、この作品の通報として運営確認用に送信します</span>
        </label>
        <Button
          type="submit"
          disabled={
            busy || !known || received || uncertain || !confirmed || !validProjectReportInput(input)
          }
        >
          確認した作品通報を送信
        </Button>
      </form>
      <p>
        受付確認はこのセッションからの通報の有無だけです。入力と既存の受付内容の一致や、運営の対応結果を示すものではありません。
      </p>
    </div>
  );
}
export default function ProjectReport({
  projectId,
  surface = 'lab',
  onNavigationRiskChange,
}: {
  projectId: string;
  surface?: PublicSurface;
  onNavigationRiskChange?: (risk: boolean) => void;
}) {
  return (
    <section className="project-report-panel" aria-label="作品の通報">
      <h2>{surface === 'ordinary' ? '作品の通報' : 'この作品を通報する'}</h2>
      {surface === 'lab' && (
        <p className="project-local">
          架空データのローカル試作です。受付のみで、自動非公開・通知・運営判断は行いません。実際の学校ログインや運営連絡先は未提供です。
        </p>
      )}
      {surface === 'lab' && (
        <p>
          理由・詳細は匿名の作品画面や一般読者には表示しません。確認できるまで入力を隠し、同じセッションなら保持した入力を再開します。無効・変更なら前の入力を破棄し、別の状態は明示確認後に開きます。
        </p>
      )}
      <ProjectSessionScope
        label={surface === 'ordinary' ? 'この作品を通報する' : '作品通報の準備を確認'}
        signedOutMessage={
          surface === 'ordinary' ? (
            <>
              通報するには<a href="/login">ログイン</a>してください。前の入力は引き継ぎません。
            </>
          ) : undefined
        }
      >
        {(session) => (
          <ProjectReportForm
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
