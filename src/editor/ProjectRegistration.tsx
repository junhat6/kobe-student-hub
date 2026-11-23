import { mergeConfirmedProject } from './project-list';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { createOwnPublicationsClient } from './own-publications-client';
import './project.css';
import MarkdownRenderer from '../MarkdownRenderer';
import MediaAttachments from './MediaAttachments';
import MediaPublicationPreview from './MediaPublicationPreview';
import { MEDIA_PER_DRAFT, referencedMediaIds } from '../shared/media';
import type { RescueChannel } from '../account/AccountSessionBoundary';
import Celebration from '../shared/Celebration';
const empty: ProjectFields = {
  title: '',
  description: '',
  githubUrl: '',
  demoUrl: '',
  technologies: '',
};
/** Display-only split of the one-line technologies text; the stored snapshot stays the exact text. */
const technologyNames = (value: string) =>
  value
    .split(/[,、，]/)
    .map((name) => name.trim())
    .filter(Boolean);
export function ProjectText({
  value,
  showTitle = true,
  privateMedia,
  surface = 'lab',
}: {
  value: ProjectFields;
  showTitle?: boolean;
  privateMedia?: { fetcher: typeof fetch; scopeKey: string };
  surface?: PublicSurface;
}) {
  return (
    <div className="project-text">
      {showTitle && <h3>{value.title}</h3>}
      {technologyNames(value.technologies).length > 0 && (
        <div className="project-technologies">
          <strong>使った技術</strong>
          <ul aria-label="使った技術">
            {technologyNames(value.technologies).map((name, index) => (
              <li key={index + name}>{name}</li>
            ))}
          </ul>
        </div>
      )}
      {surface === 'ordinary' ? (
        <div className="project-description">
          <MarkdownRenderer body={value.description} privateMedia={privateMedia} />
        </div>
      ) : (
        <p className="project-description">{value.description}</p>
      )}
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
/** Routine progress and success are announced only; failures and warnings stay visible (原則6). */
const QUIET_STATUS = new Set([
  '新しい作品の入力です。まだ保存していません。',
  '作品を保存しています…',
  '確認した入力を保存しました。後から入力した変更は保存結果と別に保持しています。',
  '保存した作品を開いています…',
  '保存した作品を開きました。続きを編集できます。',
]);
export default function ProjectRegistration({
  csrfToken,
  fetcher = fetch,
  surface = 'lab',
  onNavigationRiskChange,
  rescue,
  writable = true,
}: {
  csrfToken: string;
  fetcher?: typeof fetch;
  surface?: PublicSurface;
  onNavigationRiskChange?: (risk: boolean) => void;
  rescue?: RescueChannel;
  /** False only for a server-confirmed period outside participation: saved drafts stay readable. */
  writable?: boolean;
}) {
  const ordinary = surface === 'ordinary';
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
  const [composing, setComposing] = useState(false);
  const composition = useRef(false);
  const [autosavePaused, setAutosavePaused] = useState(false);
  const autosaveTimer = useRef<number | undefined>(undefined);
  function cancelAutosave() {
    window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = undefined;
  }
  const onMediaBusy = useCallback((value: boolean) => {
    if (value) cancelAutosave();
    setMediaBusy(value);
  }, []);
  const onMediaUncertain = useCallback((value: boolean) => {
    if (value) cancelAutosave();
    setMediaUncertain(value);
  }, []);
  const busy = workBusy || mediaBusy;
  const [createUnknown, setCreateUnknown] = useState(false),
    [saveUnknown, setSaveUnknown] = useState(false),
    [pubUnknown, setPubUnknown] = useState(false),
    [ready, setReady] = useState(false),
    [profile, setProfile] = useState<PublicProfile | null>(null),
    // 'pending' until a preparation read returns, so the absence of a profile is never claimed early.
    [profileState, setProfileState] = useState<'pending' | 'loaded' | 'failed'>('pending'),
    [receipt, setReceipt] = useState<ProjectReceipt['publication']>(null),
    [published, setPublished] = useState<{ id: string; version: number } | null>(null);
  /** Bumped only by a publication made here, never by reading an existing record. */
  const [celebration, setCelebration] = useState(0);
  // Ordinary surface only: own currently published articles that may be linked (null = not loaded / failed).
  const [ownArticles, setOwnArticles] = useState<{ id: string; title: string }[] | null>(null),
    [linked, setLinked] = useState<string[]>([]);
  const ownPublications = useMemo(() => createOwnPublicationsClient(fetcher), [fetcher]);
  const attempt = useRef<{ draft: ProjectDraft; profile: PublicProfile } | null>(null);
  const normalized = normalizeProjectFields(input);
  const dirty = saved
    ? !normalized || !sameProjectFields(saved, normalized)
    : Object.values(input).some(Boolean);
  const publishable = Boolean(
    saved?.title.trim() &&
    saved?.description.trim() &&
    referencedMediaIds(saved.description).length <= MEDIA_PER_DRAFT,
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
    cancelAutosave();
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
  const inputRef = useRef(input),
    savedRef = useRef(saved);
  inputRef.current = input;
  savedRef.current = saved;
  const provideRescue = rescue?.provide;
  // Lets the session boundary keep unsaved input in memory when the session expires.
  useLayoutEffect(() => {
    if (!provideRescue) return;
    provideRescue(() => {
      const value = inputRef.current,
        source = savedRef.current;
      const unchanged = source
        ? sameProjectFields(value, source)
        : !Object.values(value).some(Boolean);
      return unchanged
        ? null
        : { kind: 'project', projectId: source?.id ?? null, fields: { ...value } };
    });
    return () => provideRescue(null);
  }, [provideRescue]);
  const pendingRescue = useRef(rescue?.pending ?? null);
  const rescueRestored = rescue?.restored;
  // The server decides whether the new session owns the project; input is applied only after it opens.
  // A project that was never saved stays in the boundary's copy box and is not applied here.
  async function restoreRescue() {
    const value = pendingRescue.current;
    pendingRescue.current = null;
    if (value?.kind !== 'project' || !value.projectId) return;
    const id = value.projectId;
    await run(async (signal, g) => {
      setMessage('保存できなかった入力を作品に戻しています…');
      try {
        const opened = await client.read(id, signal);
        if (!current(g)) return;
        if (opened.id !== id) throw Error('Unexpected project');
        setList((rows) => mergeConfirmedProject(rows, opened));
        load(
          opened,
          sameProjectFields(opened, value.fields)
            ? '保存できなかった入力は、すでに保存済みの版と同じでした。'
            : 'ログインが切れる前の入力を作品に戻しました。まだ保存されていません。',
        );
        setInput({ ...value.fields });
        rescueRestored?.();
      } catch {
        if (current(g))
          setMessage(
            '保存できなかった入力を、このアカウントの作品として開けませんでした。上に残した入力をコピーして使ってください。',
          );
      }
    });
  }
  useEffect(() => {
    mounted.current = true;
    void refresh().then(() => {
      if (mounted.current) return restoreRescue();
    });
    return () => {
      cancelAutosave();
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
    cancelAutosave();
    setInput({ ...empty });
    setSaved(null);
    setCandidate(null);
    setCreateUnknown(false);
    setSaveUnknown(false);
    setPubUnknown(false);
    setReady(false);
    setReceipt(null);
    setPublished(null);
    setAutosavePaused(false);
    composition.current = false;
    setComposing(false);
    attempt.current = null;
    setMessage('新しい作品の入力です。まだ保存していません。');
  }
  async function save(automatic = false) {
    if (
      !writable ||
      !mounted.current ||
      !normalized ||
      createUnknown ||
      saveUnknown ||
      pubUnknown ||
      !dirty ||
      (ordinary && composition.current) ||
      (automatic &&
        (!ordinary ||
          autosavePaused ||
          busy ||
          mediaUncertain ||
          ready ||
          candidate ||
          receipt ||
          published))
    )
      return;
    const snapshot = normalized;
    const source = saved;
    await run(async (signal, g) => {
      setMessage('作品を保存しています…');
      try {
        const result = await client.save(source?.id ?? null, snapshot, source?.version, signal);
        if (current(g)) {
          setList((rows) => mergeConfirmedProject(rows, result));
          setSaved(result);
          setCandidate(null);
          setReady(false);
          setReceipt(null);
          setAutosavePaused(false);
          setMessage(
            '確認した入力を保存しました。後から入力した変更は保存結果と別に保持しています。',
          );
        }
      } catch {
        if (current(g)) {
          if (source) setSaveUnknown(true);
          else setCreateUnknown(true);
          setAutosavePaused(true);
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
  useEffect(() => {
    if (
      !ordinary ||
      !dirty ||
      !normalized ||
      composing ||
      busy ||
      mediaUncertain ||
      createUnknown ||
      saveUnknown ||
      pubUnknown ||
      autosavePaused ||
      !writable ||
      ready ||
      candidate ||
      receipt ||
      published
    )
      return;
    const timer = window.setTimeout(() => {
      if (autosaveTimer.current !== timer) return;
      autosaveTimer.current = undefined;
      if (!mounted.current || lock.current || composition.current) return;
      void save(true);
    }, 2000);
    autosaveTimer.current = timer;
    return cancelAutosave;
  }, [
    ordinary,
    input,
    saved,
    dirty,
    composing,
    busy,
    mediaUncertain,
    createUnknown,
    saveUnknown,
    pubUnknown,
    autosavePaused,
    writable,
    ready,
    candidate,
    receipt,
    published,
    client,
  ]);
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
  function load(value: ProjectDraft, notice: string) {
    cancelAutosave();
    setInput({
      title: value.title,
      description: value.description,
      githubUrl: value.githubUrl,
      demoUrl: value.demoUrl,
      technologies: value.technologies,
    });
    setSaved(value);
    setCandidate(null);
    setCreateUnknown(false);
    setSaveUnknown(false);
    setPubUnknown(false);
    setReady(false);
    setReceipt(null);
    setPublished(null);
    setAutosavePaused(false);
    composition.current = false;
    setComposing(false);
    attempt.current = null;
    setMessage(notice);
  }
  function openCandidate() {
    if (!candidate) return;
    if (hasUnsaved && !window.confirm('手元の作品情報を、表示した保存版で置き換えますか？')) return;
    load(candidate, '確認した保存版を開きました。');
  }
  // Ordinary authors resume a saved project in one step, like the article draft list.
  async function resume(id: string) {
    if (
      hasUnsaved &&
      !window.confirm('手元の未保存の作品情報を破棄して、選んだ作品の続きを開きますか？')
    )
      return;
    await run(async (signal, g) => {
      setMessage('保存した作品を開いています…');
      try {
        const value = await client.read(id, signal);
        if (current(g)) {
          setList((rows) => mergeConfirmedProject(rows, value));
          load(value, '保存した作品を開きました。続きを編集できます。');
        }
      } catch {
        if (current(g)) setMessage('保存した作品を開けませんでした。手元の入力は残しています。');
      }
    });
  }
  function rebase() {
    if (!candidate || !saved || candidate.id !== saved.id) return;
    cancelAutosave();
    setSaved(candidate);
    setSaveUnknown(false);
    setCandidate(null);
    setReady(false);
    // Readback alone must not overwrite the inspected version automatically.
    setAutosavePaused(true);
    setMessage(
      normalized && sameProjectFields(candidate, normalized)
        ? '保存版との一致を確認しました。'
        : '手元の入力は保持しています。次の保存は確認した版を置き換えます。',
    );
  }
  const readPreparation = (source: ProjectDraft, signal: AbortSignal) =>
    Promise.allSettled([
      client.receipt(source.id, signal),
      profiles.read(),
      ordinary ? ownPublications.read(signal) : Promise.resolve(null),
    ]);
  async function preparation() {
    if (!saved) return;
    const source = saved;
    await run(async (signal, g) => {
      const result = await readPreparation(source, signal);
      if (current(g)) applyPreparation(source, result, false);
    });
  }
  function applyPreparation(
    source: ProjectDraft,
    [record, author, own]: Awaited<ReturnType<typeof readPreparation>>,
    automatic: boolean,
  ) {
    setReady(false);
    const articles =
      own.status === 'fulfilled' && own.value
        ? own.value.publications
            .filter((row) => row.kind === 'article' && row.status === 'published')
            .map((row) => ({ id: row.publicId, title: row.title }))
        : null;
    setOwnArticles(articles);
    setLinked((old) => old.filter((id) => articles?.some((a) => a.id === id)));
    setProfile(author.status === 'fulfilled' ? author.value : null);
    setProfileState(author.status === 'fulfilled' ? 'loaded' : 'failed');
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
      } else if (!automatic)
        setMessage('既存の公開記録を表示しました。上書きや再公開は行いません。');
    } else {
      setPubUnknown(false);
      // Input typed while this read was in flight must not be frozen out of autosave by `ready`.
      const typed = normalizeProjectFields(inputRef.current);
      setReady(
        author.status === 'fulfilled' &&
          author.value !== null &&
          Boolean(typed && sameProjectFields(source, typed)),
      );
      // The automatic read keeps the save announcement; the panel below shows the outcome.
      if (automatic) return;
      setMessage(
        author.status === 'fulfilled' && author.value
          ? ordinary
            ? '公開の準備ができました。内容を確かめて公開してください。'
            : '保存版・公開URL・プロフィールを確認して、公開操作を選んでください。'
          : ordinary
            ? '公開にはプロフィールが必要です。アカウントでプロフィールを作成してから戻ってください。'
            : '公開プロフィールが必要です。本人入力で準備してから、再び公開準備を確認してください。',
      );
    }
  }
  // Ordinary authors should not have to press a check button to learn whether they can publish
  // (#216): read the profile/receipt once per saved version, when the input matches it.
  const autoPrepared = useRef<string | null>(null);
  useEffect(() => {
    if (
      !ordinary ||
      !writable ||
      !saved ||
      dirty ||
      busy ||
      composing ||
      ready ||
      receipt ||
      published ||
      candidate ||
      createUnknown ||
      saveUnknown ||
      pubUnknown ||
      mediaUncertain
    )
      return;
    const key = saved.id + ':' + saved.version;
    if (autoPrepared.current === key) return;
    autoPrepared.current = key;
    // Not run through run(): holding the work lock would briefly disable media and save buttons.
    // Never aborted: aborting a guarded request mid-check reads as an unverified session, so a
    // superseded read is ignored instead.
    const source = saved;
    let stale = false,
      done = false;
    void readPreparation(source, new AbortController().signal).then((result) => {
      done = true;
      // Another action or edit owns the screen now; let the effect retry once it settles.
      if (stale || !mounted.current || lock.current || savedRef.current !== source) {
        if (autoPrepared.current === key) autoPrepared.current = null;
        return;
      }
      applyPreparation(source, result, true);
    });
    return () => {
      stale = true;
      // A superseded read in flight may be retried by the next run of this effect.
      if (!done && autoPrepared.current === key) autoPrepared.current = null;
    };
  }, [
    ordinary,
    writable,
    saved,
    dirty,
    busy,
    composing,
    ready,
    receipt,
    published,
    candidate,
    createUnknown,
    saveUnknown,
    pubUnknown,
    mediaUncertain,
  ]);
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
          ordinary ? linked : [],
        );
        if (current(g)) {
          setPublished({ id, version: source.version });
          setCelebration((n) => n + 1);
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
    <section
      className="project-registration"
      aria-label={ordinary ? '作品の登録' : '画像なし作品の登録'}
    >
      <h2>{ordinary ? '作品を登録する' : '画像なしの作品を登録する'}</h2>
      {surface === 'lab' && (
        <p className="project-local">
          架空データによるローカル限定の試作です。実際の投稿利用ではありません。作品通報の受付・内容の読取確認はローカルで試せますが、実際の運営判断・連絡は未提供です。実サービスでの公開はできません。
        </p>
      )}
      <p
        className={ordinary && QUIET_STATUS.has(message) ? 'sr-only' : undefined}
        role="status"
        aria-live="polite"
      >
        {message}
      </p>
      {ordinary && celebration > 0 && <Celebration key={celebration} />}
      <div className="project-actions">
        <Button disabled={busy} onClick={reset}>
          新しい作品の入力
        </Button>
        <Button disabled={busy} onClick={() => void refresh()}>
          作品の保存一覧を更新
        </Button>
      </div>
      {listFailed && (
        <p role="alert">
          {ordinary
            ? '保存した作品の一覧を読み込めませんでした。入力中の内容は残っています。'
            : '保存一覧を確認できません。入力や現在の保存版は残しています。'}
        </p>
      )}
      <h3>{ordinary ? '保存した作品' : 'この画面で確認した保存記録'}</h3>
      {/* The 「続きを編集」 buttons explain themselves; the limit matters only once it is reached (原則1). */}
      {ordinary ? (
        list.length >= 20 && <p>更新が新しい20件まで表示します。</p>
      ) : (
        <p>
          一覧で取得した記録に、その後この画面で確認した保存版を反映し、更新時刻順に最大20件表示します。他の画面で保存した変更は「作品の保存一覧を更新」で確認してください。
        </p>
      )}
      <ul className="project-draft-list" aria-label="確認済みの作品保存記録">
        {list.map((row) => (
          <li key={row.id} aria-current={ordinary && saved?.id === row.id ? 'true' : undefined}>
            {ordinary ? (
              <Button disabled={busy} onClick={() => void resume(row.id)}>
                続きを編集：{row.title}
              </Button>
            ) : (
              <Button disabled={busy} onClick={() => void inspect(row.id)}>
                保存版を確認：{row.title}
              </Button>
            )}
            <small>
              {ordinary && saved?.id === row.id ? '編集中 · ' : ''}版 {row.version}
            </small>
          </li>
        ))}
      </ul>
      <form
        onCompositionStartCapture={() => {
          cancelAutosave();
          composition.current = true;
          setComposing(true);
        }}
        onCompositionEndCapture={() => {
          cancelAutosave();
          composition.current = false;
          setComposing(false);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {(['title', 'description', 'technologies', 'githubUrl', 'demoUrl'] as const).map((key) => (
          <div key={key}>
            <label htmlFor={formId + key}>
              {key === 'title'
                ? '作品タイトル'
                : key === 'description'
                  ? ordinary
                    ? '作品の説明'
                    : '作品説明（プレーンテキスト）'
                  : key === 'technologies'
                    ? '使った技術（任意・読点かカンマ区切り・100文字まで）'
                    : key === 'githubUrl'
                      ? 'GitHub URL（任意）'
                      : 'デモ URL（任意）'}
            </label>
            {key === 'description' ? (
              <textarea
                id={formId + key}
                value={input[key]}
                readOnly={!writable}
                maxLength={8000}
                onChange={(e) => {
                  cancelAutosave();
                  setInput((v) => ({ ...v, [key]: e.target.value }));
                  setReady(false);
                }}
              />
            ) : (
              <input
                id={formId + key}
                value={input[key]}
                readOnly={!writable}
                maxLength={key === 'title' ? 400 : key === 'technologies' ? 200 : 4096}
                placeholder={
                  key === 'technologies' ? '例：React、TypeScript、Cloudflare Workers' : undefined
                }
                onChange={(e) => {
                  cancelAutosave();
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
            タイトルの文字数、説明の容量、使った技術の文字数、URLの形式を確認してください。入力は切り捨てず保持しています。
          </p>
        )}
        <Button
          type="submit"
          disabled={
            busy || !writable || !normalized || !dirty || createUnknown || saveUnknown || pubUnknown
          }
        >
          作品を保存
        </Button>
        <p>
          {dirty
            ? '手元に未保存の作品情報があります。'
            : saved
              ? ordinary
                ? '保存済みです。'
                : '手元の入力と保存版は一致しています。'
              : ordinary
                ? 'まだ保存していません。'
                : '保存版はまだ選んでいません。'}{' '}
          {!writable
            ? '年度の登録により、いまは保存できません。'
            : ordinary
              ? autosavePaused || createUnknown || saveUnknown || pubUnknown
                ? '自動保存を停止しています。内容を確かめて「作品を保存」で保存してください。'
                : candidate || ready || receipt || published
                  ? candidate
                    ? '以前の保存と見比べている間は自動保存しません。'
                    : '公開の確認中は自動保存しません。'
                  : '' /* Autosave is the normal case; speak only when it stops (原則1・3). */
              : '自動保存はありません。'}
        </p>
      </form>
      {candidate && (
        <section className="project-comparison" aria-label="比較用の作品保存版">
          <h3>保存済みの版 {candidate.version}（比較用）</h3>
          <ProjectText
            value={candidate}
            surface={surface}
            privateMedia={{ fetcher, scopeKey: csrfToken }}
          />
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
          <h3>{ordinary ? '保存した内容' : '現在の保存版 ' + saved.version}</h3>
          <ProjectText
            value={saved}
            surface={surface}
            privateMedia={{ fetcher, scopeKey: csrfToken }}
          />
          {surface === 'ordinary' && writable && (
            <MediaAttachments
              key={saved.id + csrfToken}
              kind="projects"
              draft={saved}
              csrfToken={csrfToken}
              fetcher={fetcher}
              disabled={workBusy}
              onBusy={onMediaBusy}
              onUncertain={onMediaUncertain}
              onInsert={(text) => {
                setInput((old) => ({ ...old, description: old.description + text }));
                setReady(false);
              }}
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
          {!profile &&
            (!ordinary ? (
              <p>
                公開プロフィールがまだ確認できていません。この画面のプロフィール準備で本人入力を確認してください。
              </p>
            ) : profileState === 'loaded' ? (
              <p>
                公開にはプロフィールが必要です。
                <a href="/account#profile">アカウントでプロフィールを作成</a>
                してから、この画面に戻ってください。
              </p>
            ) : profileState === 'failed' ? (
              <p role="alert">
                公開プロフィールを読み込めませんでした。「作品の公開準備・記録を確認」でもう一度確かめてください。
              </p>
            ) : null)}
          {ordinary && ready && !receipt && !published && (
            <fieldset className="project-article-links">
              <legend>この作品の記事（任意・3件まで）</legend>
              {ownArticles === null ? (
                <p>
                  自分の公開記事を確認できませんでした。記事を紐づけずに公開できます。紐づけたい場合は公開準備をもう一度確認してください。
                </p>
              ) : !ownArticles.length ? (
                <p>公開中の自分の記事はまだありません。作品だけでも公開できます。</p>
              ) : (
                <>
                  <p>
                    選んだ記事へのリンクが作品ページに表示され、記事ページにもこの作品が表示されます。公開後は変更できません。
                  </p>
                  {ownArticles.map((article) => {
                    const checked = linked.includes(article.id);
                    return (
                      <label key={article.id}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={busy || (!checked && linked.length >= 3)}
                          onChange={(event) => {
                            const on = event.currentTarget.checked;
                            setLinked((old) =>
                              on
                                ? old.includes(article.id) || old.length >= 3
                                  ? old
                                  : [...old, article.id]
                                : old.filter((id) => id !== article.id),
                            );
                          }}
                        />
                        {article.title}
                      </label>
                    );
                  })}
                </>
              )}
            </fieldset>
          )}
          <p>公開には空白だけではないタイトルと説明が必要です。</p>
          <p>
            {surface === 'ordinary' ? (
              <>
                保存した説明とURL、プロフィールが誰でも見られるようになります。公開した後は内容を直せません。
                <a href="/account#publications">マイページから公開を止められます。</a>
              </>
            ) : (
              '保存した説明と上のURL、確認済みプロフィールが匿名の読者にも見える操作です。公開後の本文更新・削除・再公開は未提供です。「自分の公開記録」から、現在の公開を停止するローカル試作を利用できます。'
            )}
          </p>
          <Button
            disabled={
              busy ||
              !writable ||
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
              <ProjectText value={receipt.project} surface={surface} />
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
