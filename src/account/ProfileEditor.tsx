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
import ProfileLinks from '../shared/ProfileLinks';
import {
  PROFILE_LINK_LABELS,
  PROFILE_LINK_SERVICES,
  normalizeProfileLink,
  type ProfileLink,
  type ProfileLinkService,
} from '../shared/profile-links';
import { createProfileLinksClient, type ProfileLinkInput } from '../editor/profile-links-client';
import { ownAvatarPath } from '../shared/avatar';
import ProfileAvatarTools from './ProfileAvatarTools';
import { forgetPublicAvatar } from '../shared/public-avatars';
import { useViewer } from '../shell/viewer';
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
type LinkText = Record<ProfileLinkService, string>;
const noLinks: LinkText = { x: '', github: '', linkedin: '', website: '' };
const linkText = (links: ProfileLink[]): LinkText => {
  const text = { ...noLinks };
  for (const link of links) text[link.service] = link.url;
  return text;
};
const linkHints: Record<ProfileLinkService, string> = {
  x: 'https://x.com/ユーザー名',
  github: 'https://github.com/ユーザー名',
  linkedin: 'https://www.linkedin.com/in/ID',
  website: 'https://で始まるURL',
};
/** Services whose typed value is not an accepted shape (empty means "no link"). */
const badLinks = (text: LinkText) =>
  PROFILE_LINK_SERVICES.filter(
    (service) => text[service].trim() && normalizeProfileLink(service, text[service]) === null,
  );
/** The set the text would store, compared with what is stored now. */
const linksChanged = (text: LinkText, stored: ProfileLink[]) =>
  PROFILE_LINK_SERVICES.some((service) => {
    const typed = text[service].trim();
    const now = stored.find((link) => link.service === service)?.url ?? '';
    return (typed ? normalizeProfileLink(service, typed) : '') !== now;
  });
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

/** The public face, shown the way the author page shows it (name, bio, then details with icons). */
function Card({
  value,
  initials,
  avatar,
  tools,
  actions,
  links = [],
}: {
  value: ProfileInput;
  initials?: string;
  avatar?: string | null;
  tools?: ReactNode;
  actions?: ReactNode;
  links?: ProfileLink[];
}) {
  const mark = initials ?? (Array.from(value.displayName.trim())[0] || '');
  return (
    <div className="profile-editor-card">
      <div className="profile-editor-avatar-wrap">
        <Avatar mark={mark} avatar={avatar} />
        {tools}
      </div>
      <div className="profile-editor-card-text">
        <strong>{value.displayName || ' '}</strong>
        {value.bio && <p className="profile-editor-bio">{value.bio}</p>}
        <Details value={value} />
        <ProfileLinks links={links} name={value.displayName} />
      </div>
      {actions}
    </div>
  );
}

function Avatar({ mark, avatar }: { mark: string; avatar?: string | null }) {
  return (
    <span className="profile-editor-avatar" aria-hidden="true">
      {avatar ? (
        <img src={ownAvatarPath(avatar)} alt="" width={72} height={72} />
      ) : (
        mark || <Icon name="user" size={28} />
      )}
    </span>
  );
}

function Details({ value }: { value: ProfileInput }) {
  if (!value.department && !value.yearLabel) return null;
  return (
    <ul className="profile-editor-details">
      {value.department && (
        <li>
          <Icon name="school" size={16} />
          <span>{value.department}</span>
        </li>
      )}
      {value.yearLabel && (
        <li>
          <Icon name="calendar" size={16} />
          <span>{value.yearLabel}</span>
        </li>
      )}
    </ul>
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
  startEditing = false,
}: {
  csrfToken: string;
  fetcher: typeof fetch;
  /** Opened from 「プロフィールを編集」 on the author page: go straight to the form. */
  startEditing?: boolean;
  onStateChange?: (state: ProfileState) => void;
  onSaved?: (profile: PublicProfile) => void;
  onRiskChange?: (risk: boolean) => void;
}) {
  const client = useMemo(() => createProfileClient(csrfToken, fetcher), [csrfToken, fetcher]);
  const linksClient = useMemo(
    () => createProfileLinksClient(csrfToken, fetcher),
    [csrfToken, fetcher],
  );
  // null: not read (yet, or the read failed). The link fields appear only once read, so a
  // failed read never shows as "no links" and a save never removes links it did not see.
  const [links, setLinks] = useState<ProfileLink[] | null>(null);
  const [linkInput, setLinkInput] = useState<LinkText>(noLinks);
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
  const { viewer, refresh: refreshViewer } = useViewer();
  const wantsEditing = useRef(startEditing);
  const creating = state === 'none';
  const open = creating || editing;
  const profileDirty = open && !sameProfileInput(text, profile ? editable(profile) : empty);
  const linksEditable = editing && links !== null;
  const linksDirty = linksEditable && linksChanged(linkInput, links);
  const dirty = profileDirty || linksDirty;
  const wrongLinks = linksEditable ? badLinks(linkInput) : [];
  const invalid =
    problem(text) ||
    (wrongLinks.length
      ? `${wrongLinks.map((s) => PROFILE_LINK_LABELS[s]).join('・')}のリンクの形が違います`
      : '');
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
      let current: PublicProfile | null;
      try {
        current = await client.read();
        if (!mounted.current) return;
        setProfile(current);
        setText(current ? editable(current) : empty);
        setState(current ? 'exists' : 'none');
        setError('');
        if (current && wantsEditing.current) setEditing(true);
        wantsEditing.current = false;
      } catch {
        if (mounted.current) setState('unknown');
        return;
      }
      // Links belong to an existing profile; a new one adds them from 「プロフィールを編集」.
      if (current) await loadLinks();
    });
  }
  async function loadLinks() {
    try {
      const current = await linksClient.read();
      if (!mounted.current) return;
      setLinks(current);
      setLinkInput(linkText(current));
    } catch {
      // No profile yet, or the read failed: the fields stay hidden instead of looking empty.
      if (mounted.current) setLinks(null);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [client]);
  function saved(next: PublicProfile, note: string) {
    if (links) setLinkInput(linkText(links));
    // A profile just created has no links yet; read them so 「プロフィールを編集」 can add some.
    else void loadLinks();
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
    if (linksDirty) {
      const typed: ProfileLinkInput = { ...linkInput };
      let ok = false;
      await run(async () => {
        setError('');
        try {
          const stored = await linksClient.save(typed);
          if (!mounted.current) return;
          setLinks(stored);
          setLinkInput(linkText(stored));
          ok = true;
        } catch {
          if (!mounted.current) return;
          setError('リンクを保存できませんでした。もう一度押してください。');
          // Show what is actually stored now, so the next press starts from the truth.
          await loadLinks();
        }
      });
      if (!ok || !mounted.current) return;
      if (!profileDirty) {
        setEditing(false);
        setMessage('プロフィールを保存しました。');
        return;
      }
    }
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
  const avatarTools = (
    <ProfileAvatarTools
      csrfToken={csrfToken}
      fetcher={fetcher}
      avatar={avatar}
      onChange={(next) => {
        setAvatar(next);
        // The header and this visit's cards show the new icon without a reload (#205).
        // Only a real difference re-reads the header; the first load usually matches it.
        if (profile) forgetPublicAvatar(profile.id);
        if (viewer.status === 'signed-in' && viewer.profile && viewer.profile.avatar !== next)
          refreshViewer();
      }}
      onMessage={setMessage}
    />
  );
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
          links={links ?? []}
          tools={avatarTools}
          actions={
            <div className="profile-editor-tools">
              <Button
                className="profile-editor-edit"
                onClick={() => {
                  setText(editable(profile));
                  if (links) setLinkInput(linkText(links));
                  setEditing(true);
                  setMessage('');
                }}
              >
                プロフィールを編集
              </Button>
              <Link
                className="icon-button"
                to={`/students/${profile.id}`}
                aria-label="公開プロフィールを見る"
                title="公開プロフィールを見る"
              >
                <Icon name="eye" />
              </Link>
            </div>
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
          <div className="profile-editor-columns">
            <fieldset disabled={busy}>
              <legend className="sr-only">プロフィールの内容</legend>
              {field('displayName', '表示名', 'ニックネームでもOK')}
              {field('bio', '自己紹介', 'つくっているもの・興味のあること')}
              <div className="profile-editor-pair">
                {field('department', '学科', '例：ゲーム開発')}
                {field('yearLabel', '学年', '例：2年')}
              </div>
              {linksEditable && (
                <fieldset className="profile-editor-links">
                  <legend>リンク</legend>
                  <p className="profile-editor-hint">
                    制作や学習の発信先を、使っているものだけ。空のままでも大丈夫です。
                  </p>
                  {PROFILE_LINK_SERVICES.map((service) => (
                    <div className="profile-editor-field" key={service}>
                      <div className="profile-editor-label">
                        <label htmlFor={id + 'link-' + service}>
                          {PROFILE_LINK_LABELS[service]}
                        </label>
                      </div>
                      <input
                        id={id + 'link-' + service}
                        type="text"
                        inputMode="url"
                        value={linkInput[service]}
                        maxLength={200}
                        placeholder={linkHints[service]}
                        autoComplete="off"
                        spellCheck={false}
                        aria-invalid={wrongLinks.includes(service) || undefined}
                        onChange={(event) =>
                          setLinkInput((t) => ({ ...t, [service]: event.target.value }))
                        }
                      />
                    </div>
                  ))}
                </fieldset>
              )}
            </fieldset>
            <div className="profile-editor-picture">
              <Avatar
                mark={profile?.initials ?? (Array.from(text.displayName.trim())[0] || '')}
                avatar={avatar}
              />
              {/* An icon can be added once the profile exists. */}
              {profile && avatarTools}
            </div>
          </div>
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
                  if (links) setLinkInput(linkText(links));
                }}
              >
                キャンセル
              </Button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
