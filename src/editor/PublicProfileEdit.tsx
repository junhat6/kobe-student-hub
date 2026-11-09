import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@base-ui/react/button';
import ProfileCard from './ProfileCard';
import {
  ProfileConflictError,
  sameProfileInput,
  type createProfileClient,
  type ProfileInput,
  type PublicProfile,
} from './profile-client';

const editable = (p: PublicProfile): ProfileInput => ({
  displayName: p.displayName,
  department: p.department,
  yearLabel: p.yearLabel,
  bio: p.bio,
});
export default function PublicProfileEdit({
  profile,
  client,
  onUpdated,
  onRiskChange,
  disabled = false,
}: {
  profile: PublicProfile;
  client: ReturnType<typeof createProfileClient>;
  onUpdated: (value: PublicProfile) => void;
  onRiskChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const [expected, setExpected] = useState(profile);
  const [value, setValue] = useState<ProfileInput>(() => editable(profile));
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<PublicProfile | null>(null);
  const [message, setMessage] = useState('変更した内容は、保存したあと読者に公開されます。');
  const mounted = useRef(true),
    lock = useRef(false);
  const dirty = !sameProfileInput(value, expected);
  const invalid = !value.displayName.trim()
    ? '表示名を入力してください。'
    : Object.entries({ displayName: 80, department: 80, yearLabel: 32, bio: 800 }).some(
          ([key, max]) => Array.from(value[key as keyof ProfileInput]).length > max,
        )
      ? '入力できる文字数を超えています。'
      : Object.values(value).some(
            (v) =>
              v.includes('\0') ||
              new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(v)) !== v,
          )
        ? '使用できない文字が含まれています。'
        : '';
  useLayoutEffect(() => {
    onRiskChange(dirty || uncertain);
  }, [dirty, uncertain, onRiskChange]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      onRiskChange(false);
    };
  }, [onRiskChange]);
  useEffect(() => {
    if (profile.id === expected.id && sameProfileInput(profile, expected)) return;
    if (dirty || uncertain) {
      setLatest(profile);
      setConflict(true);
      return;
    }
    setExpected(profile);
    setValue(editable(profile));
    setConfirmed(false);
  }, [profile, expected, dirty, uncertain]);
  function change(key: keyof ProfileInput, text: string) {
    setValue((previous) => ({ ...previous, [key]: text }));
    setConfirmed(false);
  }
  function accept(current: PublicProfile) {
    setExpected(current);
    setValue(editable(current));
    setLatest(null);
    setConfirmed(false);
    setConflict(false);
    setUncertain(false);
    onUpdated(current);
  }
  async function run(operation: () => Promise<void>) {
    if (lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    try {
      await operation();
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function inspect() {
    await run(async () => {
      try {
        const current = await client.read();
        if (!mounted.current) return;
        if (!current || current.id !== expected.id) {
          setMessage('公開プロフィールを確認できません。アカウントの状態を再確認してください。');
          return;
        }
        if (sameProfileInput(current, value)) {
          accept(current);
          setMessage('変更した公開内容を確認できました。');
        } else if (sameProfileInput(current, expected)) {
          setUncertain(false);
          setConflict(false);
          setMessage('変更前の公開内容を確認しました。手元の入力は保持しています。');
        } else {
          setLatest(current);
          setUncertain(false);
          setConflict(true);
          setMessage('別の画面でプロフィールが変更されています。手元の入力は保持しています。');
        }
      } catch {
        if (mounted.current) setMessage('公開内容を確認できませんでした。入力を保持しています。');
      }
    });
  }
  async function save() {
    if (!dirty || !confirmed || invalid || uncertain || conflict) return;
    await run(async () => {
      try {
        const updated = await client.update({ ...value }, expected, true);
        if (!mounted.current) return;
        accept(updated);
        setMessage('公開プロフィールを更新しました。');
      } catch (error) {
        if (!mounted.current) return;
        if (error instanceof ProfileConflictError) {
          setConflict(true);
          setMessage('別の画面で変更されています。公開内容を再確認してください。');
        } else {
          setUncertain(true);
          setMessage(
            '更新結果を確認できませんでした。再送せず、公開内容を再確認してください。入力は保持しています。',
          );
        }
      }
    });
  }
  return (
    <section className="profile-setup-shell" aria-label="公開プロフィールの編集">
      <details className="profile-setup">
        <summary>
          <span>公開プロフィールを編集する</span>
          <small>
            {busy ? '処理中' : uncertain ? '結果未確認' : dirty ? '未保存' : '保存済み'}
          </small>
        </summary>
        <div className="profile-setup-content">
          <p className="profile-setup-status" role="status">
            {message}
          </p>
          <form
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="profile-setup-grid">
              <fieldset disabled={disabled || busy || uncertain || conflict}>
                <legend>プロフィールに載せる内容</legend>
                <label htmlFor="profile-edit-name">表示名 必須</label>
                <input
                  id="profile-edit-name"
                  required
                  value={value.displayName}
                  maxLength={160}
                  autoComplete="off"
                  onChange={(event) => change('displayName', event.target.value)}
                />
                <small>{Array.from(value.displayName).length}/80文字</small>
                <label htmlFor="profile-edit-department">学科・コース（任意）</label>
                <input
                  id="profile-edit-department"
                  value={value.department}
                  maxLength={160}
                  autoComplete="off"
                  onChange={(event) => change('department', event.target.value)}
                />
                <small>{Array.from(value.department).length}/80文字</small>
                <label htmlFor="profile-edit-year">学年の表示（任意）</label>
                <input
                  id="profile-edit-year"
                  value={value.yearLabel}
                  maxLength={64}
                  autoComplete="off"
                  onChange={(event) => change('yearLabel', event.target.value)}
                />
                <small>{Array.from(value.yearLabel).length}/32文字</small>
                <label htmlFor="profile-edit-bio">自己紹介（任意）</label>
                <textarea
                  id="profile-edit-bio"
                  value={value.bio}
                  maxLength={1600}
                  autoComplete="off"
                  onChange={(event) => change('bio', event.target.value)}
                />
                <small>{Array.from(value.bio).length}/800文字</small>
              </fieldset>
              <div className="profile-preview-side">
                <h3>読者からの見え方</h3>
                <ProfileCard value={value} preview />
                <p>入力した項目は公開されます。</p>
              </div>
            </div>
            <div className="profile-confirm">
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={disabled || busy || uncertain || conflict}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>変更内容を公開することを確認しました</span>
              </label>
              {dirty && invalid && (
                <p className="profile-validation" role="alert">
                  {invalid}
                </p>
              )}
              <Button
                className="profile-create-button"
                type="submit"
                disabled={
                  disabled || busy || !dirty || !confirmed || !!invalid || uncertain || conflict
                }
              >
                公開プロフィールを更新
              </Button>
            </div>
          </form>
          {(uncertain || conflict) && (
            <Button disabled={disabled || busy} onClick={() => void inspect()}>
              公開内容を再確認
            </Button>
          )}
          {conflict && latest && (
            <div>
              <h3>現在の公開内容</h3>
              <ProfileCard value={latest} />
              <Button
                disabled={disabled || busy}
                onClick={() => {
                  accept(latest);
                  setMessage('最新の公開内容を読み込みました。');
                }}
              >
                入力を置き換えて最新内容を使う
              </Button>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
