import { mergeConfirmedProject } from './project-list';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { publicPaths, type PublicSurface } from '../shared/public-paths';
import { Button } from '@base-ui/react/button';
import type {
  ProjectFields,
  ProjectDraft,
  ProjectDraftSummary,
  ProjectReceipt,
} from '../project-types';
import { normalizeProjectFields } from '../project-input';
import { createProjectClient, sameProjectFields } from './project-client';
import { createProfileClient, type PublicProfile } from './profile-client';
import './project.css';
import MarkdownRenderer from '../MarkdownRenderer';
import MediaAttachments from './MediaAttachments';
import MediaPublicationPreview from './MediaPublicationPreview';
import { referencedMediaIds } from '../shared/media';
const empty: ProjectFields = { title: '', description: '', githubUrl: '', demoUrl: '' };
export function ProjectText({
  value,
  showTitle = true,
  privateMedia,
}: {
  value: ProjectFields;
  showTitle?: boolean;
  privateMedia?: { fetcher: typeof fetch; scopeKey: string };
}) {
  return (
    <div className="project-text">
      {showTitle && <h3>{value.title}</h3>}
      <div className="project-description">
        <MarkdownRenderer body={value.description} privateMedia={privateMedia} />
      </div>
      {(['githubUrl', 'demoUrl'] as const).map(
        (key) =>
          value[key] && (
            <p key={key}>
              <strong>{key === 'githubUrl' ? 'GitHub URL' : 'デモ URL'}</strong>
              <a href={value[key]} target="_blank" rel="noopener noreferrer">
                {value[key]} ↗
              </a>
            </p>
          ),
      )}
    </div>
  );
}
export default function ProjectRegistration({
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
  const formId = useId();
  const client = useMemo(() => createProjectClient(csrfToken, fetcher), [csrfToken, fetcher]),
    profiles = useMemo(() => createProfileClient(csrfToken, fetcher), [csrfToken, fetcher]);
  const mounted = useRef(true),
    revision = useRef(0),
    lock = useRef(false);
  const request = useRef<AbortController | null>(null);
  const [input, setInput] = useState<ProjectFields>({ ...empty }),
    [saved, setSaved] = useState<ProjectDraft | null>(null),
    [list, setList] = useState<ProjectDraftSummary[]>([]),
    [listFailed, setListFailed] = useState(false),
    [candidate, setCandidate] = useState<ProjectDraft | null>(null),
    [workBusy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaUncertain, setMediaUncertain] = useState(false);
  const busy = workBusy || mediaBusy;
  const [createUnknown, setCreateUnknown] = useState(false),
    [saveUnknown, setSaveUnknown] = useState(false),
    [pubUnknown, setPubUnknown] = useState(false),
    [ready, setReady] = useState(false),
    [profile, setProfile] = useState<PublicProfile | null>(null),
    [receipt, setReceipt] = useState<ProjectReceipt['publication']>(null),
    [published, setPublished] = useState<{ id: string; version: number } | null>(null);
  const attempt = useRef<{ draft: ProjectDraft; profile: PublicProfile } | null>(null);
  const normalized = normalizeProjectFields(input);
  const dirty = saved
    ? !normalized || !sameProjectFields(saved, normalized)
    : Object.values(input).some(Boolean);
  const publishable = Boolean(
    saved?.title.trim() &&
    saved?.description.trim() &&
    referencedMediaIds(saved.description).length <= 8,
  );
  const hasUnsaved = dirty || createUnknown || saveUnknown || pubUnknown || mediaUncertain;
  useLayoutEffect(
    () => onNavigationRiskChange?.(hasUnsaved || busy),
    [hasUnsaved, busy, onNavigationRiskChange],
  );
  useEffect(() => () => onNavigationRiskChange?.(false), [onNavigationRiskChange]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    if (hasUnsaved || busy) window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsaved, busy]);
  async function run(action: (signal: AbortSignal, generation: number) => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    const controller = new AbortController();
    request.current = controller;
    const generation = revision.current;
    try {
      await action(controller.signal, generation);
    } finally {
      if (mounted.current && generation === revision.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  const current = (generation: number) => mounted.current && generation === revision.current;
  async function refresh() {
    await run(async (signal, g) => {
      try {
        const rows = await client.list(signal);
        if (current(g)) {
          setList(rows);
          setListFailed(false);
        }
      } catch {
        if (current(g)) {
          setListFailed(true);
          setMessage('保存一覧を取得できませんでした。手元の入力は残しています。');
        }
      }
    });
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      revision.current++;
      request.current?.abort();
      lock.current = false;
    };
  }, [client]);
  function reset() {
    if (
      hasUnsaved &&
      !window.confirm('未保存・未確定の作品情報をこの画面から破棄して、新しい入力を始めますか？')
    )
      return;
    setInput({ ...empty });
    setSaved(null);
    setCandidate(null);
    setCreateUnknown(false);
    setSaveUnknown(false);
    setPubUnknown(false);
    setReady(false);
    setReceipt(null);
    setPublished(null);
    attempt.current = null;
    setMessage('新しい作品の入力です。まだ保存していません。');
  }
  async function save() {
    if (!normalized || createUnknown || saveUnknown || pubUnknown || !dirty) return;
    const snapshot = normalized;
    const source = saved;
    await run(async (signal, g) => {
      try {
        const result = await client.save(source?.id ?? null, snapshot, source?.version, signal);
        if (current(g)) {
          setList((rows) => mergeConfirmedProject(rows, result));
          setSaved(result);
          setCandidate(null);
          setReady(false);
          setReceipt(null);
          setMessage(
            '確認した入力を保存しました。後から入力した変更は保存結果と別に保持しています。',
          );
        }
      } catch {
        if (current(g)) {
          if (source) setSaveUnknown(true);
          else setCreateUnknown(true);
          setReady(false);
          setMessage(
            source
              ? '保存結果を確認できませんでした。手元の入力を保持しています。保存済みの版を確認してください。'
              : '新規保存の結果を確認できませんでした。自動で再送しません。保存一覧を更新し、候補の保存版を確認して明示的に開いてください。',
          );
        }
      }
    });
  }
  async function inspect(id: string) {
    await run(async (signal, g) => {
      try {
        const value = await client.read(id, signal);
        if (current(g)) {
          setList((rows) => mergeConfirmedProject(rows, value));
          setCandidate(value);
          setMessage('保存版を比較用に表示しました。手元の入力は置き換えていません。');
        }
      } catch {
        if (current(g)) setMessage('保存版を確認できませんでした。入力は残しています。');
      }
    });
  }
  function openCandidate() {
    if (!candidate) return;
    if (hasUnsaved && !window.confirm('手元の作品情報を、表示した保存版で置き換えますか？')) return;
    setInput({
      title: candidate.title,
      description: candidate.description,
      githubUrl: candidate.githubUrl,
      demoUrl: candidate.demoUrl,
    });
    setSaved(candidate);
    setCandidate(null);
    setCreateUnknown(false);
    setSaveUnknown(false);
    setPubUnknown(false);
    setReady(false);
    setReceipt(null);
    setPublished(null);
    attempt.current = null;
    setMessage('確認した保存版を開きました。');
  }
  function rebase() {
    if (!candidate || !saved || candidate.id !== saved.id) return;
    setSaved(candidate);
    setSaveUnknown(false);
    setCandidate(null);
    setReady(false);
    setMessage(
      normalized && sameProjectFields(candidate, normalized)
        ? '保存版との一致を確認しました。'
        : '手元の入力は保持しています。次の保存は確認した版を置き換えます。',
    );
  }
  async function preparation() {
    if (!saved) return;
    const source = saved;
    await run(async (signal, g) => {
      const [record, author] = await Promise.allSettled([
        client.receipt(source.id, signal),
        profiles.read(),
      ]);
      if (!current(g)) return;
      setReady(false);
      setProfile(author.status === 'fulfilled' ? author.value : null);
      if (record.status !== 'fulfilled') {
        setMessage('公開記録を確認できません。未公開とは判断せず、自動で再送しません。');
        return;
      }
      setReceipt(record.value.publication);
      if (record.value.publication) {
        const p = record.value.publication;
        const a = attempt.current;
        setPubUnknown(false);
        if (
          a &&
          p.sourceVersion === a.draft.version &&
          sameProjectFields(p.project, a.draft) &&
          p.author.id === a.profile.id &&
          p.author.name === a.profile.displayName &&
          p.author.department === a.profile.department &&
          p.author.year === a.profile.yearLabel &&
          p.author.bio === a.profile.bio &&
          p.author.initials === a.profile.initials
        ) {
          setPublished({ id: p.projectId, version: p.sourceVersion });
          setMessage('確認した保存版の公開を確認しました。手元の追加編集は含みません。');
        } else setMessage('既存の公開記録を表示しました。上書きや再公開は行いません。');
      } else {
        setPubUnknown(false);
        setReady(author.status === 'fulfilled' && author.value !== null);
        setMessage(
          author.status === 'fulfilled' && author.value
            ? '保存版・公開URL・プロフィールを確認して、公開操作を選んでください。'
            : '公開プロフィールが必要です。本人入力で準備してから、再び公開準備を確認してください。',
        );
      }
    });
  }
  async function publish() {
    if (
      !saved ||
      !publishable ||
      dirty ||
      !profile ||
      !ready ||
      receipt ||
      published ||
      pubUnknown ||
      saveUnknown
    )
      return;
    const source = saved;
    attempt.current = { draft: source, profile };
    setReady(false);
    await run(async (signal, g) => {
      try {
        const id = await client.publish(
          source.id,
          source.version,
          signal,
          referencedMediaIds(source.description),
        );
        if (current(g)) {
          setPublished({ id, version: source.version });
          setPubUnknown(false);
          setMessage(
            surface === 'ordinary'
              ? '確認した保存版を公開しました。手元の追加編集は含みません。'
              : '確認した保存版をローカルで公開しました。手元の追加編集は含みません。',
          );
        }
      } catch {
        if (current(g)) {
          setPubUnknown(true);
          setMessage(
            '公開結果を確認できませんでした。再送せず、公開準備・記録を確認してください。',
          );
        }
      }
    });
  }
  return (
    <section className="project-registration" aria-label="画像なし作品の登録">
      <h2>画像なしの作品を登録する</h2>
      {surface === 'lab' && (
        <p className="project-local">
          架空データによるローカル限定の試作です。実際の投稿利用ではありません。作品通報の受付・内容の読取確認はローカルで試せますが、実際の運営判断・連絡は未提供です。実サービスでの公開はできません。
        </p>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
      <div className="project-actions">
        <Button disabled={busy} onClick={reset}>
          新しい作品の入力
        </Button>
        <Button disabled={busy} onClick={() => void refresh()}>
          作品の保存一覧を更新
        </Button>
      </div>
      {listFailed && (
        <p role="alert">保存一覧を確認できません。入力や現在の保存版は残しています。</p>
      )}
      <h3>この画面で確認した保存記録</h3>
      <p>
        一覧で取得した記録に、その後この画面で確認した保存版を反映し、更新時刻順に最大20件表示します。他の画面で保存した変更は「作品の保存一覧を更新」で確認してください。
      </p>
      <ul className="project-draft-list" aria-label="確認済みの作品保存記録">
        {list.map((row) => (
          <li key={row.id}>
            <Button disabled={busy} onClick={() => void inspect(row.id)}>
              保存版を確認：{row.title}
            </Button>
            <small>版 {row.version}</small>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {(['title', 'description', 'githubUrl', 'demoUrl'] as const).map((key) => (
          <div key={key}>
            <label htmlFor={formId + key}>
              {key === 'title'
                ? '作品タイトル'
                : key === 'description'
                  ? '作品説明（プレーンテキスト）'
                  : key === 'githubUrl'
                    ? 'GitHub URL（任意）'
                    : 'デモ URL（任意）'}
            </label>
            {key === 'description' ? (
              <textarea
                id={formId + key}
                value={input[key]}
                maxLength={8000}
                onChange={(e) => {
                  setInput((v) => ({ ...v, [key]: e.target.value }));
                  setReady(false);
                }}
              />
            ) : (
              <input
                id={formId + key}
                value={input[key]}
                maxLength={key === 'title' ? 400 : 4096}
                onChange={(e) => {
                  setInput((v) => ({ ...v, [key]: e.target.value }));
                  setReady(false);
                }}
              />
            )}
          </div>
        ))}
        <p>
          HTTPSのURLだけを利用できます。URLのクエリやフラグメントも公開されます。認証情報や秘密のリンクは入力しないでください。画像や外部ページは自動取得しません。
        </p>
        {!normalized && dirty && (
          <p role="alert">
            タイトルの文字数、説明の容量、URLの形式を確認してください。入力は切り捨てず保持しています。
          </p>
        )}
        <Button
          type="submit"
          disabled={busy || !normalized || !dirty || createUnknown || saveUnknown || pubUnknown}
        >
          作品を保存
        </Button>
        <p>
          {dirty
            ? '手元に未保存の作品情報があります。'
            : saved
              ? '手元の入力と保存版は一致しています。'
              : '保存版はまだ選んでいません。'}{' '}
          自動保存はありません。
        </p>
      </form>
      {candidate && (
        <section className="project-comparison" aria-label="比較用の作品保存版">
          <h3>保存済みの版 {candidate.version}（比較用）</h3>
          <ProjectText value={candidate} privateMedia={{ fetcher, scopeKey: csrfToken }} />
          <Button disabled={busy} onClick={openCandidate}>
            この保存版を開く
          </Button>
          {saved?.id === candidate.id && (
            <Button disabled={busy} onClick={rebase}>
              確認した版を基準にする
            </Button>
          )}
        </section>
      )}
      {saved && (
        <section className="project-saved" aria-label="公開前の作品保存版">
          <h3>現在の保存版 {saved.version}</h3>
          <ProjectText value={saved} privateMedia={{ fetcher, scopeKey: csrfToken }} />
          {surface === 'ordinary' && (
            <MediaAttachments
              key={saved.id + csrfToken}
              kind="projects"
              draft={saved}
              csrfToken={csrfToken}
              fetcher={fetcher}
              disabled={workBusy}
              onBusy={setMediaBusy}
              onUncertain={setMediaUncertain}
              onInsert={(text) =>
                setInput((old) => ({ ...old, description: old.description + text }))
              }
            />
          )}
          <MediaPublicationPreview
            body={saved.description}
            fetcher={fetcher}
            scopeKey={csrfToken}
          />
          <Button disabled={busy} onClick={() => void inspect(saved.id)}>
            保存済みの作品を確認
          </Button>
          <Button disabled={busy} onClick={() => void preparation()}>
            作品の公開準備・記録を確認
          </Button>
          {profile && (
            <p>
              公開する投稿者：{profile.displayName} ／ {profile.department} {profile.yearLabel}
              <br />
              {profile.bio}
            </p>
          )}
          {!profile && (
            <p>
              公開プロフィールがまだ確認できていません。
              {surface === 'ordinary' ? (
                <a href="/account#profile">アカウントでプロフィールを作成</a>
              ) : (
                'この画面のプロフィール準備で本人入力を確認'
              )}
              してください。
            </p>
          )}
          <p>公開には空白だけではないタイトルと説明が必要です。</p>
          <p>
            保存した説明と上のURL、確認済みプロフィールが匿名の読者にも見える操作です。公開後の本文更新・削除・再公開は未提供です。
            {surface === 'ordinary' ? (
              <a href="/account#publications">自分の公開記録から公開停止を確認できます。</a>
            ) : (
              '「自分の公開記録」から、現在の公開を停止するローカル試作を利用できます。'
            )}
          </p>
          <Button
            disabled={
              busy ||
              !publishable ||
              dirty ||
              !ready ||
              !profile ||
              Boolean(receipt) ||
              Boolean(published) ||
              pubUnknown ||
              saveUnknown
            }
            onClick={() => void publish()}
          >
            確認した保存版の作品を{surface === 'ordinary' ? '' : 'ローカルで'}公開
          </Button>
          {pubUnknown && <p role="alert">公開結果は未確定です。自動で再送しません。</p>}
          {receipt && (
            <section aria-label="作品の公開記録">
              <h4>公開記録の版 {receipt.sourceVersion}</h4>
              <ProjectText value={receipt.project} />
            </section>
          )}
          {published && (
            <p>
              保存版 {published.version} の公開を確認しました。
              <a
                href={publicPaths(surface).project(published.id)}
                target="_blank"
                rel="noopener noreferrer"
              >
                ログインなしで作品を見る ↗
              </a>
            </p>
          )}
          {(published || receipt) && (
            <p>
              <a href={publicPaths(surface).works} target="_blank" rel="noopener noreferrer">
                公開作品の一覧を開く ↗
              </a>
            </p>
          )}
          {receipt && !published && (
            <a
              href={publicPaths(surface).project(receipt.projectId)}
              target="_blank"
              rel="noopener noreferrer"
            >
              既存の公開作品を見る ↗
            </a>
          )}
        </section>
      )}
    </section>
  );
}
