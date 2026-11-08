import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@base-ui/react/button';
import { createRegistrationClient, RegistrationClientError } from './registration-client';
import { canonicalEnrollmentYears } from '../shared/enrollment';
import './account.css';

type Phase = 'checking' | 'ready' | 'starting' | 'unknown' | 'leaving';
type Operation = { controller: AbortController; generation: number };
export default function Registration({ mode }: { mode: 'signup' | 'login' }) {
  const signup = mode === 'signup',
    navigate = useNavigate(),
    id = useId();
  const client = useMemo(() => createRegistrationClient({ origin: location.origin }), []);
  const mounted = useRef(false),
    generation = useRef(0),
    operation = useRef<Operation | null>(null);
  const departing = useRef(false);
  const [admission, setAdmission] = useState(''),
    [graduation, setGraduation] = useState('');
  const [phase, setPhase] = useState<Phase>('checking'),
    [mayRestart, setMayRestart] = useState(false);
  const [message, setMessage] = useState('現在のログイン状態を確認しています…');
  const inputYear = (v: string) => (/^(?:19|20|21)\d{2}$/.test(v) ? Number(v) : null);
  const admissionYear = inputYear(admission),
    graduationYear = inputYear(graduation);
  const years =
    admissionYear !== null && graduationYear !== null
      ? canonicalEnrollmentYears({ admissionYear, graduationYear })
      : null;
  const admissionError =
    admission !== '' && admissionYear === null
      ? '入学年度を1900〜2199の西暦4桁で入力してください。'
      : '';
  const graduationError =
    graduation !== '' && graduationYear === null
      ? '卒業予定年度を1900〜2199の西暦4桁で入力してください。'
      : admissionYear !== null && graduationYear !== null && graduationYear < admissionYear
        ? '卒業予定年度は入学年度と同じか、それより後にしてください。'
        : '';
  const busy = phase === 'checking' || phase === 'starting' || phase === 'leaving';
  const current = (op: Operation) =>
    mounted.current &&
    operation.current === op &&
    generation.current === op.generation &&
    !op.controller.signal.aborted &&
    document.visibilityState === 'visible';
  function begin(next: Phase) {
    if (operation.current) return null;
    departing.current = false;
    const op = { controller: new AbortController(), generation: ++generation.current };
    operation.current = op;
    setPhase(next);
    return op;
  }
  function finish(op: Operation) {
    if (operation.current === op) operation.current = null;
  }
  function cancel() {
    const pending = operation.current;
    if (!pending) return;
    operation.current = null;
    generation.current++;
    pending.controller.abort();
    setPhase('unknown');
    setMayRestart(false);
    setMessage(
      '通信を中止しました。認証の状態はまだ確認できません。入力を残しています。登録状態を確認してから続けてください。',
    );
  }
  async function inspect(initial = false) {
    const op = begin('checking');
    if (!op) return;
    setMayRestart(false);
    setMessage('現在のログイン状態と年度の保存状態を確認しています…');
    try {
      await client.inspect(op.controller.signal);
      if (!current(op)) return;
      setPhase('leaving');
      navigate('/account', { replace: true });
    } catch (error) {
      if (!current(op)) return;
      if (error instanceof RegistrationClientError && error.kind === 'signed-out') {
        setPhase(initial ? 'ready' : 'unknown');
        setMayRestart(!initial);
        setMessage(
          initial
            ? ''
            : '現在のログインは確認できませんでした。認証をやり直す場合は、入力を確認して新しく開始できます。',
        );
      } else {
        setPhase('unknown');
        setMessage(
          '登録・ログインの状態を確認できませんでした。入力を残しています。もう一度、登録状態を確認してください。',
        );
      }
    } finally {
      finish(op);
    }
  }
  async function start() {
    if (phase !== 'ready' || (signup && !years)) return;
    const op = begin('starting');
    if (!op) return;
    setMayRestart(false);
    setMessage('学校Googleの画面を準備しています…');
    try {
      const result = signup
        ? await client.startRegistration(years!, op.controller.signal)
        : await client.startLogin(op.controller.signal);
      if (!current(op)) return;
      departing.current = true;
      setPhase('leaving');
      setMessage('学校Googleの画面へ移動します…');
      window.location.assign(result.authorizationUrl);
    } catch {
      if (!current(op)) return;
      setPhase('unknown');
      setMessage(
        'Google認証を開始できたか確認できませんでした。入力を残しています。再送せず、登録状態を確認してください。',
      );
    } finally {
      finish(op);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void inspect(true);
    const returned = () => {
      if (!departing.current) return;
      departing.current = false;
      setPhase('unknown');
      setMayRestart(false);
      setMessage('画面に戻りました。登録・ログインの状態を確認してから続けてください。');
    };
    const suspend = () => {
      cancel();
      if (departing.current) {
        setPhase('unknown');
        setMayRestart(false);
      }
    };
    const visibility = () => {
      if (document.visibilityState !== 'visible') suspend();
      else returned();
    };
    window.addEventListener('pagehide', suspend);
    window.addEventListener('pageshow', returned);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted.current = false;
      generation.current++;
      operation.current?.controller.abort();
      operation.current = null;
      window.removeEventListener('pagehide', suspend);
      window.removeEventListener('pageshow', returned);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [client]);
  return (
    <section className="account-entry" aria-labelledby={id + 'heading'}>
      <h1 id={id + 'heading'}>{signup ? '学生として登録する' : 'ログインする'}</h1>
      <p className="account-intro">
        {signup
          ? '学校メールで使うGoogleアカウントで登録します。'
          : '登録済みの学校Googleアカウントで続けます。年度の入力は不要です。'}
      </p>
      {signup && (
        <p className="account-privacy">
          年度は利用期間の確認に使い、公開プロフィールには載せません。
        </p>
      )}
      <p className="account-privacy">
        <Link to="/guide" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
          利用ルールと情報の扱い（別のタブ）
        </Link>
      </p>
      <p className="account-message" role="status" aria-live="polite" aria-atomic="true">
        {message}
      </p>
      <form
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          void start();
        }}
      >
        {signup && (
          <fieldset disabled={busy}>
            <legend className="account-legend">入学年度と卒業予定年度</legend>
            <div className="account-field">
              <label htmlFor={id + 'admission'}>
                入学年度 <span>必須</span>
              </label>
              <input
                id={id + 'admission'}
                type="text"
                inputMode="numeric"
                required
                autoComplete="off"
                value={admission}
                readOnly={phase === 'unknown'}
                aria-invalid={Boolean(admissionError)}
                aria-describedby={
                  id + 'years-help' + (admissionError ? ' ' + id + 'admission-error' : '')
                }
                onChange={(event) => setAdmission(event.target.value)}
              />
              {admissionError && (
                <p id={id + 'admission-error'} className="account-error">
                  {admissionError}
                </p>
              )}
            </div>
            <div className="account-field">
              <label htmlFor={id + 'graduation'}>
                卒業予定年度 <span>必須</span>
              </label>
              <input
                id={id + 'graduation'}
                type="text"
                inputMode="numeric"
                required
                autoComplete="off"
                value={graduation}
                readOnly={phase === 'unknown'}
                aria-invalid={Boolean(graduationError)}
                aria-describedby={
                  id +
                  'years-help ' +
                  id +
                  'graduation-help' +
                  (graduationError ? ' ' + id + 'graduation-error' : '')
                }
                onChange={(event) => setGraduation(event.target.value)}
              />
              {graduationError && (
                <p id={id + 'graduation-error'} className="account-error">
                  {graduationError}
                </p>
              )}
            </div>
            <p id={id + 'years-help'} className="account-help">
              年度は4月から翌年3月までです。
            </p>
            <p id={id + 'graduation-help'} className="account-help">
              2028年3月に卒業予定なら「2027」年度です。
            </p>
          </fieldset>
        )}
        <Button
          className="primary account-google"
          type="submit"
          disabled={phase !== 'ready' || (signup && !years)}
        >
          {phase === 'leaving'
            ? '移動しています…'
            : phase === 'starting'
              ? 'Googleの画面を準備しています…'
              : signup
                ? '学校Googleで登録'
                : '学校Googleでログイン'}
        </Button>
      </form>
      {(phase === 'checking' || phase === 'starting') && (
        <Button className="account-secondary" onClick={cancel}>
          通信を中止
        </Button>
      )}
      {phase === 'leaving' && departing.current && (
        <Button
          className="account-secondary"
          onClick={() => {
            window.stop();
            departing.current = false;
            setPhase('unknown');
            setMayRestart(false);
            setMessage('Googleへの移動を中止しました。登録状態を確認してから続けてください。');
          }}
        >
          Googleへの移動を中止
        </Button>
      )}
      {phase === 'unknown' && (
        <div className="account-recovery">
          <Button className="account-secondary" onClick={() => void inspect()}>
            登録状態を確認
          </Button>
          {mayRestart && (
            <Button
              className="account-secondary"
              onClick={() => {
                setPhase('ready');
                setMayRestart(false);
                setMessage('入力を確認してから、Google認証を新しく開始してください。');
              }}
            >
              入力を確認してやり直す
            </Button>
          )}
        </div>
      )}
      <p className="account-switch">
        {signup ? 'すでに登録していますか？' : '初めて利用しますか？'}{' '}
        <Link to={signup ? '/login' : '/signup'}>
          {signup ? 'ログインする' : '学生として登録する'}
        </Link>
      </p>
      <Link className="account-read-link" to="/">
        記事・作品を読む
      </Link>
    </section>
  );
}
