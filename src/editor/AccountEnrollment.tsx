import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@base-ui/react/button';
import type { OwnEnrollmentResult } from '../shared/enrollment';
import { createEnrollmentClient, type EnrollmentInput } from './enrollment-client';
import EnrollmentYearsPicker from '../shared/EnrollmentYearsPicker';
import Icon from '../shared/Icon';
import './enrollment.css';

type RecordValue = OwnEnrollmentResult['enrollment'];
type Participation = OwnEnrollmentResult['participation'];
type Fields = { admission: string; graduation: string };
const fields = (value: RecordValue): Fields =>
  value
    ? { admission: String(value.admissionYear), graduation: String(value.graduationYear) }
    : { admission: '', graduation: '' };

/**
 * Private self-declared study period. The page reads it on its own and re-reads after an
 * unclear save, so students never have to "check the saved state" themselves.
 */
export default function AccountEnrollment({
  csrfToken,
  fetcher = fetch,
  onParticipationChange,
}: {
  csrfToken: string;
  fetcher?: typeof fetch;
  onParticipationChange?: (value: Participation) => void;
}) {
  const client = useMemo(() => createEnrollmentClient(csrfToken, fetcher), [csrfToken, fetcher]);
  const id = useId();
  const mounted = useRef(false),
    revision = useRef(0),
    request = useRef<AbortController | null>(null);
  const notify = useRef(onParticipationChange);
  notify.current = onParticipationChange;
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState<'read' | 'save' | null>(null),
    [readFailed, setReadFailed] = useState(false),
    [saveFailed, setSaveFailed] = useState(false),
    [justSaved, setJustSaved] = useState(false);
  const [saved, setSaved] = useState<RecordValue>(null),
    [input, setInput] = useState<Fields>(fields(null));
  const [message, setMessage] = useState('');
  const admissionYear = Number(input.admission),
    graduationYear = Number(input.graduation);
  const valid =
    input.admission !== '' && input.graduation !== '' && graduationYear >= admissionYear;
  const baseline = fields(saved),
    dirty = input.admission !== baseline.admission || input.graduation !== baseline.graduation;
  const current = (generation: number, controller: AbortController) =>
    mounted.current && revision.current === generation && request.current === controller;
  function begin(kind: 'read' | 'save') {
    if (request.current) return null;
    const controller = new AbortController();
    request.current = controller;
    setBusy(kind);
    return { controller, generation: ++revision.current };
  }
  function finish(generation: number, controller: AbortController) {
    if (current(generation, controller)) {
      request.current = null;
      setBusy(null);
    }
  }
  function apply(result: OwnEnrollmentResult) {
    setSaved(result.enrollment);
    notify.current?.(result.participation);
  }
  /** keepInput: after an unclear save, keep what the student chose so one tap retries it. */
  async function read(keepInput: boolean) {
    const operation = begin('read');
    if (!operation) return null;
    const { controller, generation } = operation;
    try {
      const result = await client.read(controller.signal);
      if (!current(generation, controller)) return null;
      setLoaded(true);
      setReadFailed(false);
      apply(result);
      if (!keepInput) setInput(fields(result.enrollment));
      return result;
    } catch {
      if (current(generation, controller)) {
        setReadFailed(true);
        notify.current?.('missing');
        setMessage('在学期間を読み込めませんでした。');
      }
      return null;
    } finally {
      finish(generation, controller);
    }
  }
  async function save() {
    if (!loaded || !valid || !dirty) return;
    const snapshot: EnrollmentInput = {
      admissionYear,
      graduationYear,
      expectedVersion: saved?.version ?? 0,
    };
    const operation = begin('save');
    if (!operation) return;
    const { controller, generation } = operation;
    setSaveFailed(false);
    setJustSaved(false);
    setMessage('保存しています…');
    let unclear = false;
    try {
      const result = await client.save(snapshot, controller.signal);
      if (!current(generation, controller)) return;
      apply(result);
      setJustSaved(true);
      setMessage('在学期間を保存しました。');
    } catch {
      unclear = current(generation, controller);
    } finally {
      finish(generation, controller);
    }
    if (!unclear) return;
    // Never resend on our own: read what the server holds, then let one tap retry if needed.
    const after = await read(true);
    if (!mounted.current) return;
    const record = after?.enrollment;
    if (
      record &&
      record.admissionYear === snapshot.admissionYear &&
      record.graduationYear === snapshot.graduationYear
    ) {
      setJustSaved(true);
      setMessage('在学期間を保存しました。');
    } else {
      setSaveFailed(true);
      setMessage('保存できませんでした。');
    }
  }
  useEffect(() => {
    mounted.current = true;
    setLoaded(false);
    setSaved(null);
    setInput(fields(null));
    setReadFailed(false);
    setSaveFailed(false);
    notify.current?.('missing');
    void read(false);
    return () => {
      mounted.current = false;
      revision.current++;
      request.current?.abort();
      request.current = null;
    };
  }, [client]);
  useEffect(() => {
    if (!loaded || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [loaded, dirty]);
  return (
    <section className="account-enrollment" aria-labelledby={id + 'heading'}>
      <div className="enrollment-head">
        <h2 id={id + 'heading'}>在学期間</h2>
        <span className="private-mark" role="img" aria-label="非公開" title="自分だけに見えます">
          <Icon name="lock" size={16} />
        </span>
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {message}
      </p>
      {readFailed && (
        <div className="enrollment-problem" role="alert">
          <Icon name="alert" size={18} />
          <span>読み込めませんでした</span>
          <Button disabled={busy !== null} onClick={() => void read(loaded)}>
            もう一度
          </Button>
        </div>
      )}
      {loaded && (
        <form
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <EnrollmentYearsPicker
            id={id}
            admission={input.admission}
            graduation={input.graduation}
            disabled={busy !== null}
            onChange={(next) => {
              setInput(next);
              setJustSaved(false);
              setSaveFailed(false);
            }}
          >
            {dirty ? (
              <Button className="enrollment-save" type="submit" disabled={busy !== null || !valid}>
                {busy === 'save' ? '保存中…' : '保存'}
              </Button>
            ) : (
              justSaved && (
                <span className="saved-mark" role="img" aria-label="保存しました">
                  <Icon name="check" size={20} />
                </span>
              )
            )}
          </EnrollmentYearsPicker>
          {saveFailed && (
            <p className="enrollment-error" role="alert">
              保存できませんでした。もう一度「保存」を押してください。
            </p>
          )}
        </form>
      )}
    </section>
  );
}
