import type { ReactNode } from 'react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@base-ui/react/button';
import {
  createProfileClient,
  ProfileConflictError,
  sameProfileInput,
  type ProfileInput,
  type PublicProfile,
} from '../editor/profile-client';
import Icon from '../shared/Icon';
import { ownAvatarPath } from '../shared/avatar';
import ProfileAvatarTools from './ProfileAvatarTools';
import './profile-editor.css';

const empty: ProfileInput = { displayName: '', department: '', yearLabel: '', bio: '' };
const limits = { displayName: 80, department: 80, yearLabel: 32, bio: 800 } as const;
const editable = (p: PublicProfile): ProfileInput => ({
  displayName: p.displayName,
  department: p.department,
  yearLabel: p.yearLabel,
  bio: p.bio,
});
const length = (v: string) => Array.from(v).length;
function problem(v: ProfileInput) {
  if (!v.displayName.trim()) return '表示名を入れてください';
  if ((Object.keys(limits) as (keyof ProfileInput)[]).some((k) => length(v[k]) > limits[k]))
    return '文字数が多すぎます';
  if (
    Object.values(v).some(
      (s) =>
        s.includes('\0') ||
        new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(s)) !== s,
    )
  )
    return '使えない文字が入っています';
  return '';
}
export type ProfileState = 'loading' | 'none' | 'exists' | 'unknown';

/** The public face shown next to articles. The card itself is the preview: what you see is published. */
function Card({
  value,
  initials,
  avatar,
  tools,
}: {
  value: ProfileInput;
  initials?: string;
  avatar?: string | null;
  tools?: ReactNode;
}) {
  const mark = initials ?? (Array.from(value.displayName.trim())[0] || '');
  return (
    <div className="profile-editor-card">
      <div className="profile-editor-avatar-wrap">
        <span className="profile-editor-avatar" aria-hidden="true">
          {avatar ? (
            <img src={ownAvatarPath(avatar)} alt="" width={72} height={72} />
          ) : (
            mark || <Icon name="user" size={28} />
          )}
        </span>
        {tools}
      </div>
      <div className="profile-editor-card-text">
        <strong>{value.displayName || ' '}</strong>
        {(value.department || value.yearLabel) && (
          <span className="profile-editor-meta">
            {[value.department, value.yearLabel].filter(Boolean).join(' · ')}
          </span>
        )}
        {value.bio && <p className="profile-editor-bio">{value.bio}</p>}
      </div>
    </div>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  const n = length(value);
  // Only worth a glance when it matters.
  if (n < max * 0.8) return null;
  return <small className={n > max ? 'profile-editor-over' : undefined}>{`${n}/${max}`}</small>;
}

/**
 * Create-or-edit for the student's public profile on the ordinary account page.
 * Reads on its own and re-reads after an unclear write; never resends automatically.
 */
export default function ProfileEditor({
  csrfToken,
  fetcher,
  onStateChange,
  onSaved,
  onRiskChange,
}: {
  csrfToken: string;
  fetcher: typeof fetch;
  onStateChange?: (state: ProfileState) => void;
  onSaved?: (profile: PublicProfile) => void;
  onRiskChange?: (risk: boolean) => void;
}) {
  const client = useMemo(() => createProfileClient(csrfToken, fetcher), [csrfToken, fetcher]);
  const id = useId();
  const mounted = useRef(true),
    lock = useRef(false);
  const [state, setState] = useState<ProfileState>('loading');
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState<ProfileInput>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const creating = state === 'none';
  const open = creating || editing;
  const dirty = open && !sameProfileInput(text, profile ? editable(profile) : empty);
  const invalid = problem(text);
  const notify = useRef(onStateChange);
  notify.current = onStateChange;
  useEffect(() => notify.current?.(state), [state]);
  useLayoutEffect(() => onRiskChange?.(dirty), [dirty, onRiskChange]);
  useEffect(() => () => onRiskChange?.(false), [onRiskChange]);
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
  async function load() {
    await run(async () => {
      try {
        const current = await client.read();
        if (!mounted.current) return;
        setProfile(current);
        setText(current ? editable(current) : empty);
        setState(current ? 'exists' : 'none');
        setError('');
      } catch {
        if (mounted.current) setState('unknown');
      }
    });
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [client]);
  function saved(next: PublicProfile, note: string) {
    setProfile(next);
    setText(editable(next));
    setState('exists');
    setEditing(false);
    setError('');
    setMessage(note);
    onSaved?.(next);
  }
  async function submit() {
    if (busy || invalid || (!creating && !dirty)) return;
    const snapshot = { ...text };
    const expected = profile;
    let unclear = false;
    await run(async () => {
      setError('');
      try {
        const result = expected
          ? await client.update(snapshot, expected, true)
          : await client.create(snapshot, true);
        if (mounted.current)
          saved(result, expected ? 'プロフィールを保存しました。' : 'プロフィールを公開しました。');
      } catch (failure) {
        if (!mounted.current) return;
        if (failure instanceof ProfileConflictError) {
          setError(
            '別の画面で変更されていました。最新の内容を読み込んだので、もう一度保存してください。',
          );
        }
        unclear = true;
      }
    });
    if (!unclear || !mounted.current) return;
    // Find out what actually happened instead of asking the student to check.
    await run(async () => {
      try {
        const current = await client.read();
        if (!mounted.current) return;
        if (current && sameProfileInput(current, snapshot)) {
          saved(
            current,
            expected ? 'プロフィールを保存しました。' : 'プロフィールを公開しました。',
          );
          return;
        }
        setProfile(current);
        if (current && !expected) {
          // Created elsewhere meanwhile: show that one rather than overwrite it.
          setText(editable(current));
          setState('exists');
          setEditing(false);
          setError('別の画面で作成済みのプロフィールを表示しています。');
          return;
        }
        setError((e) => e || '保存できませんでした。もう一度押してください。');
      } catch {
        if (mounted.current) setError('保存できませんでした。もう一度押してください。');
      }
    });
  }
  const field = (key: keyof ProfileInput, label: string, placeholder?: string) => (
    <div className="profile-editor-field">
      <div className="profile-editor-label">
        <label htmlFor={id + key}>{label}</label>
        <Counter value={text[key]} max={limits[key]} />
      </div>
      {key === 'bio' ? (
        <textarea
          id={id + key}
          value={text[key]}
          maxLength={limits[key] * 2}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(event) => setText((t) => ({ ...t, [key]: event.target.value }))}
        />
      ) : (
        <input
          id={id + key}
          value={text[key]}
          maxLength={limits[key] * 2}
          placeholder={placeholder}
          required={key === 'displayName'}
          autoComplete="off"
          onChange={(event) => setText((t) => ({ ...t, [key]: event.target.value }))}
        />
      )}
    </div>
  );
  return (
    <section
      className={'profile-editor' + (creating ? ' profile-editor-first' : '')}
      aria-labelledby={id + 'heading'}
    >
      <div className="profile-editor-head">
        <h2 id={id + 'heading'}>{creating ? 'プロフィールをつくる' : 'プロフィール'}</h2>
        <span
          className="profile-editor-public"
          role="img"
          aria-label="公開"
          title="誰でも見られます"
        >
          <Icon name="globe" size={16} />
        </span>
        {state === 'exists' && profile && !editing && (
          <div className="profile-editor-tools">
            <Link
              className="icon-button"
              to={`/students/${profile.id}`}
              aria-label="公開プロフィールを見る"
              title="公開プロフィールを見る"
            >
              <Icon name="eye" />
            </Link>
            <Button
              className="icon-button"
              aria-label="プロフィールを編集"
              title="編集"
              onClick={() => {
                setText(editable(profile));
                setEditing(true);
                setMessage('');
              }}
            >
              <Icon name="pencil" />
            </Button>
          </div>
        )}
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {message}
      </p>
      {state === 'loading' && <div className="profile-editor-skeleton" aria-busy="true" />}
      {state === 'unknown' && (
        <div className="profile-editor-problem" role="alert">
          <Icon name="alert" size={18} />
          <span>読み込めませんでした</span>
          <Button className="text-button" disabled={busy} onClick={() => void load()}>
            もう一度
          </Button>
        </div>
      )}
      {state === 'exists' && profile && !editing && (
        <Card
          value={editable(profile)}
          initials={profile.initials}
          avatar={avatar}
          tools={
            <ProfileAvatarTools
              csrfToken={csrfToken}
              fetcher={fetcher}
              avatar={avatar}
              onChange={setAvatar}
              onMessage={setMessage}
            />
          }
        />
      )}
      {open && (
        <form
          className="profile-editor-form"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="profile-editor-preview">
            <Card value={text} avatar={avatar} />
          </div>
          <fieldset disabled={busy}>
            <legend className="sr-only">プロフィールの内容</legend>
            {field('displayName', '表示名', 'ニックネームでもOK')}
            <div className="profile-editor-pair">
              {field('department', '学科', '例：ゲーム開発')}
              {field('yearLabel', '学年', '例：2年')}
            </div>
            {field('bio', '自己紹介', 'つくっているもの・興味のあること')}
          </fieldset>
          {error && (
            <p className="profile-editor-error" role="alert">
              {error}
            </p>
          )}
          {text.displayName.trim() && invalid && (
            <p className="profile-editor-error" role="alert">
              {invalid}
            </p>
          )}
          <div className="profile-editor-actions">
            <Button
              className="primary"
              type="submit"
              disabled={busy || Boolean(invalid) || (!creating && !dirty)}
            >
              <Icon name={creating ? 'globe' : 'check'} size={18} />
              {creating ? '公開する' : '保存'}
            </Button>
            {editing && (
              <Button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setError('');
                  if (profile) setText(editable(profile));
                }}
              >
                やめる
              </Button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
