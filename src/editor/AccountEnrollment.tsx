import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@base-ui/react/button';
import type { OwnEnrollmentResult } from '../shared/enrollment';
import { createEnrollmentClient, type EnrollmentInput } from './enrollment-client';
import './enrollment.css';

type RecordValue = OwnEnrollmentResult['enrollment'];
type Participation = OwnEnrollmentResult['participation'];
type Fields = { admissionYear: string; graduationYear: string };
const blank: Fields = { admissionYear: '', graduationYear: '' };
const fields = (value: RecordValue): Fields =>
  value
    ? { admissionYear: String(value.admissionYear), graduationYear: String(value.graduationYear) }
    : { ...blank };
const sameRecord = (a: RecordValue, b: RecordValue) =>
  a === null
    ? b === null
    : b !== null &&
      a.version === b.version &&
      a.admissionYear === b.admissionYear &&
      a.graduationYear === b.graduationYear &&
      a.updatedAtMs === b.updatedAtMs;
const participationText: Record<Participation, string> = {
  missing: '入学年度と卒業予定年度を登録してください。',
  upcoming: '登録した入学年度より前です。入力に誤りがあれば訂正してください。',
  current: '登録した年度に基づく利用期間内です。年度はこの画面で訂正できます。',
  ended: '登録した卒業予定年度を過ぎています。入力に誤りがあれば訂正してください。',
};
function year(value: string) {
  return /^(?:19|20|21)\d{2}$/.test(value) ? Number(value) : null;
}

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
    [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState<RecordValue>(null),
    [input, setInput] = useState<Fields>({ ...blank }),
    [participation, setParticipation] = useState<Participation>('missing');
  const [uncertain, setUncertain] = useState(false),
    [attempt, setAttempt] = useState<EnrollmentInput | null>(null),
    [needsBasis, setNeedsBasis] = useState(false);
  const [message, setMessage] = useState('年度の登録状態を確認しています…');
  const admissionYear = year(input.admissionYear),
    graduationYear = year(input.graduationYear);
  const admissionError =
    input.admissionYear !== '' && admissionYear === null
      ? '入学年度は1900〜2199の西暦4桁で入力してください。'
      : '';
  const graduationError =
    input.graduationYear !== '' && graduationYear === null
      ? '卒業予定年度は1900〜2199の西暦4桁で入力してください。'
      : admissionYear !== null && graduationYear !== null && graduationYear < admissionYear
        ? '卒業予定年度は入学年度と同じか、それより後にしてください。'
        : '';
  const valid =
    admissionYear !== null && graduationYear !== null && graduationYear >= admissionYear;
  const baseline = fields(saved),
    dirty =
      input.admissionYear !== baseline.admissionYear ||
      input.graduationYear !== baseline.graduationYear;
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
  function publishParticipation(value: Participation) {
    setParticipation(value);
    notify.current?.(value);
  }
  async function inspect(initial = false) {
    const operation = begin('read');
    if (!operation) return;
    const { controller, generation } = operation;
    setMessage('年度の登録状態を確認しています…');
    const firstRead = initial || !loaded;
    const attempted = firstRead ? null : attempt;
    const previous = firstRead ? null : saved;
    try {
      const result = await client.read(controller.signal);
      if (!current(generation, controller)) return;
      setLoaded(true);
      setFailed(false);
      setSaved(result.enrollment);
      publishParticipation(result.participation);
      if (firstRead) {
        setInput(fields(result.enrollment));
        setUncertain(false);
        setAttempt(null);
        setNeedsBasis(false);
        setMessage(
          result.enrollment
            ? '保存済みの年度を確認しました。誤りがあれば、この画面で訂正してください。'
            : '入学年度と卒業予定年度を入力してください。',
        );
      } else if (attempted) {
        const record = result.enrollment;
        if (
          record &&
          record.admissionYear === attempted.admissionYear &&
          record.graduationYear === attempted.graduationYear &&
          record.version === attempted.expectedVersion + 1
        ) {
          setUncertain(false);
          setAttempt(null);
          setNeedsBasis(false);
          setMessage('送信した年度の保存を確認しました。手元の入力はそのまま残しています。');
        } else {
          setUncertain(false);
          setNeedsBasis(true);
          setMessage(
            '送信した内容の保存は確認できませんでした。現在の保存状態と手元の入力を比べ、訂正する場合は保存版を基準にしてください。',
          );
        }
      } else if (!sameRecord(previous, result.enrollment)) {
        setNeedsBasis(true);
        setMessage(
          '保存状態が変わっています。手元の入力は残しています。現在の保存版を確認してから訂正してください。',
        );
      } else {
        setMessage('現在の保存状態を確認しました。手元の入力はそのまま残しています。');
      }
    } catch {
      if (current(generation, controller)) {
        setFailed(true);
        notify.current?.('missing');
        setMessage(
          '年度の登録状態を確認できませんでした。入力はこの画面に残しています。もう一度、保存状態を確認してください。',
        );
      }
    } finally {
      finish(generation, controller);
    }
  }
  async function save() {
    if (!loaded || !valid || !dirty || failed || uncertain || needsBasis) return;
    const snapshot: EnrollmentInput = {
      admissionYear: admissionYear!,
      graduationYear: graduationYear!,
      expectedVersion: saved?.version ?? 0,
    };
    const operation = begin('save');
    if (!operation) return;
    const { controller, generation } = operation;
    setAttempt(snapshot);
    setMessage('年度を保存しています…');
    try {
      const result = await client.save(snapshot, controller.signal);
      if (!current(generation, controller)) return;
      setSaved(result.enrollment);
      publishParticipation(result.participation);
      setAttempt(null);
      setUncertain(false);
      setFailed(false);
      setNeedsBasis(false);
      setMessage('年度を保存しました。誤りがあれば、この画面で訂正できます。');
    } catch {
      if (current(generation, controller)) {
        setUncertain(true);
        setFailed(true);
        notify.current?.('missing');
        setMessage(
          '保存結果を確認できませんでした。入力は残しています。再送せず、保存状態を確認してください。',
        );
      }
    } finally {
      finish(generation, controller);
    }
  }
  useEffect(() => {
    mounted.current = true;
    setLoaded(false);
    setSaved(null);
    setInput({ ...blank });
    setUncertain(false);
    setAttempt(null);
    setNeedsBasis(false);
    setFailed(false);
    publishParticipation('missing');
    void inspect(true);
    return () => {
      mounted.current = false;
      revision.current++;
      request.current?.abort();
      request.current = null;
    };
  }, [client]);
  useEffect(() => {
    if (!loaded || (!dirty && !uncertain)) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [loaded, dirty, uncertain]);
  const readOnly = uncertain || needsBasis;
  return (
    <section className="account-enrollment" aria-labelledby={id + 'heading'}>
      <h2 id={id + 'heading'}>入学年度と卒業予定年度</h2>
      <p>利用期間の確認に使う非公開の登録情報です。公開プロフィールには載りません。</p>
      <p className="enrollment-status" role="status" aria-live="polite" aria-atomic="true">
        {message}
      </p>
      <Button disabled={busy !== null} onClick={() => void inspect()}>
        保存状態を確認
      </Button>
      {loaded && (
        <>
          <div className="enrollment-saved" aria-label="保存済みの年度">
            {saved ? (
              <p>
                {failed || uncertain ? '前回確認した年度' : '保存済み'}：{saved.admissionYear}
                年度入学・{saved.graduationYear}年度卒業予定
              </p>
            ) : (
              <p>
                {failed || uncertain
                  ? '年度の登録状態は未確認です。'
                  : '年度はまだ登録されていません。'}
              </p>
            )}
            {!failed && !uncertain && <p>{participationText[participation]}</p>}
          </div>
          <form
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <fieldset disabled={busy !== null}>
              <legend>{readOnly ? '保持している入力' : '年度を入力・訂正する'}</legend>
              <div className="enrollment-fields">
                <div>
                  <label htmlFor={id + 'admission'}>
                    入学年度 <span>必須</span>
                  </label>
                  <input
                    id={id + 'admission'}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    required
                    value={input.admissionYear}
                    readOnly={readOnly}
                    aria-invalid={Boolean(admissionError)}
                    aria-describedby={
                      id + 'year-help' + (admissionError ? ' ' + id + 'admission-error' : '')
                    }
                    onChange={(event) =>
                      setInput((value) => ({ ...value, admissionYear: event.target.value }))
                    }
                  />
                  {admissionError && (
                    <p className="enrollment-error" id={id + 'admission-error'}>
                      {admissionError}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor={id + 'graduation'}>
                    卒業予定年度 <span>必須</span>
                  </label>
                  <input
                    id={id + 'graduation'}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    required
                    value={input.graduationYear}
                    readOnly={readOnly}
                    aria-invalid={Boolean(graduationError)}
                    aria-describedby={
                      id +
                      'year-help ' +
                      id +
                      'graduation-help' +
                      (graduationError ? ' ' + id + 'graduation-error' : '')
                    }
                    onChange={(event) =>
                      setInput((value) => ({ ...value, graduationYear: event.target.value }))
                    }
                  />
                  {graduationError && (
                    <p className="enrollment-error" id={id + 'graduation-error'}>
                      {graduationError}
                    </p>
                  )}
                </div>
              </div>
              <p className="enrollment-help" id={id + 'year-help'}>
                1900〜2199の西暦4桁で入力してください。年度は4月から翌年3月までです。
              </p>
              <p className="enrollment-help" id={id + 'graduation-help'}>
                2028年3月に卒業予定なら「2027」年度です。同じ年度に入学・卒業予定の場合も登録できます。
              </p>
            </fieldset>
            {needsBasis && !failed && (
              <Button
                className="enrollment-basis"
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  setNeedsBasis(false);
                  setAttempt(null);
                  setMessage(
                    '確認した保存版を基準にしました。手元の入力を確認して、必要な訂正を保存してください。',
                  );
                }}
              >
                確認した保存版を基準にする
              </Button>
            )}
            <Button
              className="enrollment-save"
              type="submit"
              disabled={busy !== null || !valid || !dirty || failed || uncertain || needsBasis}
            >
              {busy === 'save' ? '保存しています…' : saved ? '年度を訂正して保存' : '年度を保存'}
            </Button>
            <p className="enrollment-help">
              {dirty ? '手元に未保存の年度があります。' : '入力と保存状態は一致しています。'}{' '}
              自動保存はありません。
            </p>
          </form>
        </>
      )}
    </section>
  );
}
