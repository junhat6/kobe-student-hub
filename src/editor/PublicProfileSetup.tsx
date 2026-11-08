import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PublicSurface } from '../shared/public-paths';
import { Button } from '@base-ui/react/button';
import {
  createProfileClient,
  sameProfileInput,
  type ProfileInput,
  type PublicProfile,
} from './profile-client';
import './profile-setup.css';
const empty: ProfileInput = { displayName: '', department: '', yearLabel: '', bio: '' };
function ProfileCard({ value, preview = false }: { value: ProfileInput; preview?: boolean }) {
  return (
    <article
      className="profile-public-card"
      aria-label={preview ? '公開プロフィールのプレビュー' : '登録されたプロフィール'}
    >
      <span className="profile-public-avatar" aria-hidden="true">
        {'initials' in value
          ? String(value.initials)
          : Array.from(value.displayName.trim())[0] || '◎'}
      </span>
      <div>
        <h3>{value.displayName || '表示名がここに表示されます'}</h3>
        <p className="profile-public-meta">
          {[value.department, value.yearLabel].filter(Boolean).join(' · ') ||
            '学科・学年は未入力です'}
        </p>
        <p className="profile-public-bio">{value.bio || '自己紹介は未入力です'}</p>
      </div>
    </article>
  );
}
export default function PublicProfileSetup({
  csrfToken,
  fetcher = fetch,
  surface = 'lab',
  onNavigationRiskChange,
}: {
  csrfToken: string;
  fetcher?: typeof fetch;
  surface?: PublicSurface;
  onNavigationRiskChange?: (risk: boolean) => void;
}) {
  const client = useMemo(() => createProfileClient(csrfToken, fetcher), [csrfToken, fetcher]);
  const mounted = useRef(true);
  const lock = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [text, setText] = useState<ProfileInput>(empty);
  const [confirmed, setConfirmed] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [attempt, setAttempt] = useState<ProfileInput | null>(null);
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState('プロフィールの登録状態を確認しています…');
  const [failed, setFailed] = useState(false);
  const invalid = !text.displayName.trim()
    ? '表示名を入力してください。'
    : Object.entries({ displayName: 80, department: 80, yearLabel: 32, bio: 800 }).some(
          ([key, max]) => Array.from(text[key as keyof ProfileInput]).length > max,
        )
      ? '入力できる文字数を超えています。'
      : Object.values(text).some(
            (v) =>
              v.includes('\0') ||
              new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(v)) !== v,
          )
        ? '使用できない文字が含まれています。'
        : '';
  const hasUnsaved = Object.values(text).some(Boolean) && (!profile || conflict);
  useLayoutEffect(() => {
    onNavigationRiskChange?.(hasUnsaved || uncertain);
  }, [hasUnsaved, uncertain, onNavigationRiskChange]);
  useEffect(() => () => onNavigationRiskChange?.(false), [onNavigationRiskChange]);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await action();
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function inspect(initial = false) {
    await run(async () => {
      setMessage('登録状態を確認しています…');
      try {
        const existing = await client.read();
        if (!mounted.current) return;
        setLoaded(true);
        setFailed(false);
        setUncertain(false);
        if (existing) {
          setProfile(existing);
          if (
            attempt &&
            (!sameProfileInput(existing, attempt) ||
              existing.initials !== Array.from(attempt.displayName.trim())[0])
          ) {
            setConflict(true);
            setConfirmed(false);
            setMessage(
              '異なる内容のプロフィールが登録されています。この画面から上書きしません。手元の入力は残しています。',
            );
          } else {
            setConflict(false);
            setMessage(
              attempt
                ? '同じ内容のプロフィールを確認できました。作成を確認しました。'
                : '登録済みのプロフィールを表示しています。',
            );
          }
        } else {
          setProfile(null);
          setConflict(false);
          setConfirmed(false);
          setAttempt(null);
          setMessage(
            initial
              ? '表示する内容を自分で入力し、公開される情報を確認してください。'
              : '登録をまだ確認できませんでした。入力とプレビューを確認し直してから、必要なら改めて作成してください。自動では再送しません。',
          );
        }
      } catch {
        if (mounted.current) {
          setFailed(true);
          setMessage(
            '登録状態を確認できませんでした。入力内容はこの画面に残っています。確認できるまで、変更や再送はしません。',
          );
        }
      }
    });
  }
  useEffect(() => {
    mounted.current = true;
    void inspect(true);
    return () => {
      mounted.current = false;
    };
  }, [client]);
  useEffect(() => {
    if (!hasUnsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsaved]);
  function change(key: keyof ProfileInput, value: string) {
    setText((t) => ({ ...t, [key]: value }));
    setConfirmed(false);
  }
  async function create() {
    if (!loaded || profile || !confirmed || invalid || uncertain) return;
    const snapshot = { ...text };
    await run(async () => {
      setAttempt(snapshot);
      setMessage('確認した内容でプロフィールを作成しています…');
      try {
        const result = await client.create(snapshot, true);
        if (mounted.current) {
          setProfile(result);
          setConflict(false);
          setUncertain(false);
          setFailed(false);
          setMessage(
            surface === 'ordinary'
              ? '公開プロフィールを作成しました。'
              : '公開プロフィールを作成しました。このローカル検証内でのみ保存されています。',
          );
        }
      } catch {
        if (mounted.current) {
          setUncertain(true);
          setConfirmed(false);
          setFailed(true);
          setMessage(
            '作成結果を確認できませんでした。入力内容は残しています。再送せず、登録状態を確認してください。',
          );
        }
      }
    });
  }
  const showForm = loaded && (!profile || conflict);
  const readOnly = uncertain || conflict;
  return (
    <section className="profile-setup-shell" aria-label="公開プロフィールの初回作成">
      <details className="profile-setup">
        <summary>
          <span>公開プロフィールを準備する</span>
          <small>
            {busy
              ? '処理中'
              : failed || uncertain
                ? '未確認'
                : !loaded
                  ? '確認中'
                  : profile
                    ? '作成済み'
                    : '未作成'}
          </small>
        </summary>
        <div className="profile-setup-content">
          <div className="profile-setup-heading">
            {surface === 'lab' && <p>PUBLIC PROFILE · LOCAL LAB</p>}
            <h2>読者に見せる情報を、自分で選ぶ。</h2>
          </div>
          {surface === 'lab' && (
            <p className="profile-local-note">
              架空アカウントによるローカル専用の検証です。一般閲覧への接続や実際の公開は行っていません。
            </p>
          )}
          <p className="profile-setup-status" aria-live="polite" aria-atomic="true">
            {message}
          </p>
          {(!loaded || uncertain || failed) && (
            <Button disabled={busy} onClick={() => void inspect()}>
              登録状態を確認
            </Button>
          )}
          {profile && (
            <>
              <ProfileCard value={profile} />
              <p className="profile-create-limit">
                {surface === 'ordinary'
                  ? '作成後の編集・削除は、まだ利用できません。'
                  : '作成後の編集・削除は、この検証ではまだ利用できません。'}
              </p>
            </>
          )}
          {showForm && (
            <form
              autoComplete="off"
              onSubmit={(event) => {
                event.preventDefault();
                void create();
              }}
            >
              <div className="profile-setup-grid">
                <fieldset disabled={busy}>
                  <legend>{conflict ? '保持している入力' : 'プロフィールに載せる内容'}</legend>
                  <label htmlFor="profile-display-name">
                    表示名 <span>必須</span>
                  </label>
                  <input
                    id="profile-display-name"
                    autoComplete="off"
                    value={text.displayName}
                    maxLength={160}
                    readOnly={readOnly}
                    onChange={(event) => change('displayName', event.target.value)}
                  />
                  <small>
                    {Array.from(text.displayName).length}/80文字。本名を入力する必要はありません。
                  </small>
                  <label htmlFor="profile-department">学科（任意）</label>
                  <input
                    id="profile-department"
                    autoComplete="off"
                    value={text.department}
                    maxLength={160}
                    readOnly={readOnly}
                    onChange={(event) => change('department', event.target.value)}
                  />
                  <small>{Array.from(text.department).length}/80文字</small>
                  <label htmlFor="profile-year-label">学年の表示（任意）</label>
                  <input
                    id="profile-year-label"
                    autoComplete="off"
                    value={text.yearLabel}
                    maxLength={64}
                    readOnly={readOnly}
                    onChange={(event) => change('yearLabel', event.target.value)}
                  />
                  <small>
                    {Array.from(text.yearLabel).length}
                    /32文字。入力した文字をそのまま表示します。在籍や学年を自動判定しません。
                  </small>
                  <label htmlFor="profile-bio">自己紹介（任意）</label>
                  <textarea
                    id="profile-bio"
                    autoComplete="off"
                    value={text.bio}
                    maxLength={1600}
                    readOnly={readOnly}
                    onChange={(event) => change('bio', event.target.value)}
                  />
                  <small>
                    {Array.from(text.bio).length}
                    /800文字。メールアドレスなど、公開したくない情報は書かないでください。
                  </small>
                </fieldset>
                <div className="profile-preview-side">
                  <h3>ログインしていない読者からの見え方</h3>
                  <ProfileCard value={text} preview />
                  <p>
                    表示名・学科・学年の表示・自己紹介は、すべて公開される情報です。Googleの本名・写真・メールを自動入力することはありません。
                  </p>
                </div>
              </div>
              {!conflict && (
                <div className="profile-confirm">
                  <label>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={busy || uncertain}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    <span>この内容をログインしていない人にも表示することを確認しました</span>
                  </label>
                  {invalid && text.displayName && <p className="profile-validation">{invalid}</p>}
                  <Button
                    className="profile-create-button"
                    type="submit"
                    disabled={busy || uncertain || !confirmed || Boolean(invalid)}
                  >
                    確認した内容でプロフィールを作成
                  </Button>
                  <p>
                    入力内容を変更すると確認は解除されます。作成は初回のみで、この画面から上書きはしません。
                  </p>
                </div>
              )}
            </form>
          )}
          <p className="profile-scope-note">
            {surface === 'ordinary' ? (
              <>
                ここでは公開プロフィールだけを作成します。下書きや画像は、記事・作品の公開操作まで公開されません。
                <a
                  href="/guide#privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                >
                  公開する情報の扱いを見る
                </a>
              </>
            ) : (
              'プロフィール作成は在籍確認、実投稿の許可、すべての利用規約への同意を意味しません。未確認の入力はこの画面のメモリ内だけに保持し、自動保存・自動再送は行いません。'
            )}
          </p>
        </div>
      </details>
    </section>
  );
}
