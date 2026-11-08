import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@base-ui/react/button';
import MarkdownRenderer from '../MarkdownRenderer';
import { createDraftClient, type EditorDraft, type DraftSummary } from './draft-client';
import './editor.css';
import PublicationComposer from './PublicationComposer';
import {
  formatMarkdown,
  textareaText,
  type MarkdownFormat,
  type MarkdownTool,
} from './markdown-format';
class PreviewBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p role="alert">
        プレビューを表示できませんでした。編集に戻っても、手元の文章は残っています。
      </p>
    ) : (
      this.props.children
    );
  }
}
const same = (a: { title: string; body: string }, b: { title: string; body: string }) =>
  a.title === b.title && a.body === b.body;
const stamp = (n: number) =>
  new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(n);
export default function DraftEditor({
  csrfToken,
  fetcher = fetch,
  variant = 'lab',
  onNavigationRiskChange,
}: {
  csrfToken: string;
  fetcher?: typeof fetch;
  variant?: 'lab' | 'ordinary';
  onNavigationRiskChange?: (value: boolean) => void;
}) {
  const ordinary = variant === 'ordinary';
  const EditorRegion = ordinary ? 'section' : 'main';
  const client = useMemo(() => createDraftClient(csrfToken, fetcher), [csrfToken, fetcher]);
  const [list, setList] = useState<DraftSummary[]>([]);
  const [listError, setListError] = useState(false);
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [text, setText] = useState({ title: '', body: '' });
  const [mutationPending, setMutationPending] = useState(false);
  const [preparationDirty, setPreparationDirty] = useState(false);
  const [publicationBusy, setPublicationBusy] = useState(false);
  const [publicationMutationPending, setPublicationMutationPending] = useState(false);
  const publicationLock = useRef(false);
  const preparationUnsaved = useRef(false);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  const [status, setStatus] = useState('下書きを読み込んでいます…');
  const [problem, setProblem] = useState(false);
  const [latest, setLatest] = useState<EditorDraft | null>(null);
  const [preview, setPreview] = useState(false);
  const [deletion, setDeletion] = useState<'idle' | 'confirm' | 'pending' | 'unknown'>('idle');
  const deleteButton = useRef<HTMLButtonElement>(null),
    deleteCancel = useRef<HTMLButtonElement>(null);
  const newDraftButton = useRef<HTMLButtonElement>(null),
    focusAfterDelete = useRef(false);
  const deletionOpen = ordinary && deletion !== 'idle',
    editingLocked = opening || (ordinary && (deletion === 'confirm' || deletion === 'pending'));
  useEffect(() => {
    if (deletion === 'confirm') deleteCancel.current?.focus();
  }, [deletion]);
  useEffect(() => {
    if (ordinary && !busy && !draft && focusAfterDelete.current) {
      focusAfterDelete.current = false;
      newDraftButton.current?.focus();
    }
  }, [ordinary, busy, draft]);
  const [composing, setComposing] = useState(false);
  const compositionRef = useRef(false);
  const pendingFormat = useRef<MarkdownFormat | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const currentText = useRef(text);
  currentText.current = text;
  const dirty = Boolean(draft && !same(text, draft));
  const bytes = useMemo(() => new TextEncoder().encode(text.body).byteLength, [text.body]);
  const invalid =
    Array.from(text.title).length > 200
      ? 'タイトルは200文字以内にしてください。'
      : bytes > 262144
        ? '本文の容量が上限の256 KiBを超えています。'
        : '';
  async function run(operation: () => Promise<void>, mutating = false) {
    if (lock.current || publicationLock.current) return;
    lock.current = true;
    setBusy(true);
    if (mutating) {
      setMutationPending(true);
      onNavigationRiskChange?.(true);
    }
    try {
      await operation();
    } finally {
      lock.current = false;
      if (mounted.current) {
        setBusy(false);
        if (mutating) setMutationPending(false);
      }
    }
  }
  const onPublicationPending = useCallback((value: boolean, mutating = false) => {
    publicationLock.current = value;
    setPublicationBusy(value);
    setPublicationMutationPending(value && mutating);
  }, []);
  const onUnsavedPreparation = useCallback((value: boolean) => {
    preparationUnsaved.current = value;
    setPreparationDirty(value);
  }, []);
  const canPublishStart = useCallback(
    () => !lock.current && !publicationLock.current && (!ordinary || (!problem && !deletionOpen)),
    [ordinary, problem, deletionOpen],
  );
  function remember(value: EditorDraft) {
    setList((rows) =>
      [
        { id: value.id, title: value.title, version: value.version, updatedAt: value.updatedAt },
        ...rows.filter((r) => r.id !== value.id),
      ]
        .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
        .slice(0, 20),
    );
  }
  async function refresh() {
    await run(async () => {
      try {
        const rows = await client.list();
        if (!mounted.current) return;
        setList(rows);
        setListError(false);
        if (!draft)
          setStatus(
            rows.length
              ? '左の一覧から下書きを開くか、新しく作成できます。'
              : '新しい下書きを作成して、書き始めましょう。',
          );
      } catch {
        if (mounted.current) {
          setListError(true);
          if (!draft) setStatus('一覧を読み込めませんでした。もう一度お試しください。');
        }
      }
    });
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [client]);
  const navigationRisk =
    dirty ||
    (ordinary &&
      (mutationPending || publicationMutationPending || preparationDirty || deletionOpen));
  useLayoutEffect(() => {
    onNavigationRiskChange?.(navigationRisk);
  }, [navigationRisk, onNavigationRiskChange]);
  useEffect(
    () => () => {
      onNavigationRiskChange?.(false);
    },
    [onNavigationRiskChange],
  );
  useEffect(() => {
    if (!navigationRisk) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [navigationRisk]);
  function maySwitch() {
    return (
      (!dirty && !preparationUnsaved.current) ||
      window.confirm(
        ordinary
          ? '未保存の編集があります。別の下書きへ移ると、この画面の変更は失われます。移動しますか？'
          : '未保存の編集・公開情報があります。別の下書きへ移ると、この画面の変更は失われます。移動しますか？',
      )
    );
  }
  function open(value: EditorDraft) {
    pendingFormat.current = null;
    compositionRef.current = false;
    setComposing(false);
    setDraft(value);
    setText({ title: value.title, body: value.body });
    setLatest(null);
    setProblem(false);
    setDeletion('idle');
    setPreview(false);
    setStatus(
      value.title
        ? '保存済みの下書きを開きました。'
        : '下書きを作成しました。タイトルや本文を書いてみましょう。',
    );
    requestAnimationFrame(() => titleRef.current?.focus());
  }
  async function choose(id: string) {
    if (lock.current || publicationLock.current || deletionOpen || !maySwitch()) return;
    await run(async () => {
      setOpening(true);
      try {
        const value = await client.read(id);
        if (mounted.current) open(value);
      } catch {
        if (mounted.current)
          setStatus('下書きを開けませんでした。現在の編集はこの画面に残っています。');
      } finally {
        if (mounted.current) setOpening(false);
      }
    });
  }
  async function create() {
    if (lock.current || publicationLock.current || deletionOpen || !maySwitch()) return;
    await run(async () => {
      setOpening(true);
      setStatus('新しい下書きを作成しています…');
      try {
        const value = await client.createEmpty();
        if (mounted.current) {
          remember(value);
          open(value);
        }
      } catch {
        if (mounted.current) {
          setListError(true);
          setStatus(
            '作成結果を確認できませんでした。一覧を更新して確認してください。現在の編集は残っています。',
          );
        }
      } finally {
        if (mounted.current) setOpening(false);
      }
    }, true);
  }
  async function save() {
    if (!draft || !dirty || invalid || deletionOpen) return;
    const snapshot = { ...draft, ...text };
    await run(async () => {
      setStatus('送信した内容を保存しています…');
      try {
        const value = await client.save(snapshot);
        if (!mounted.current) return;
        setDraft(value);
        remember(value);
        setLatest(null);
        setProblem(false);
        setStatus(
          same(currentText.current, snapshot)
            ? '下書きを保存しました。'
            : '送信した版を保存しました。新しい変更はまだ未保存です。',
        );
      } catch {
        if (mounted.current) {
          setProblem(true);
          setLatest(null);
          setStatus('保存結果を確認できませんでした。手元の編集はこの画面に残っています。');
        }
      }
    }, true);
  }
  async function inspect() {
    if (!draft) return;
    const id = draft.id;
    await run(async () => {
      setStatus('保存済みの版を確認しています…');
      try {
        const value = await client.read(id);
        if (mounted.current) {
          setLatest(value);
          setStatus('保存済みの版を表示しました。手元の編集と比べてください。');
        }
      } catch {
        if (mounted.current)
          setStatus(
            deletion === 'unknown'
              ? '保存済みの版を確認できませんでした。削除済みとは判断できません。手元の文章は残しています。'
              : '保存済みの版を確認できませんでした。手元の編集は残っています。接続やログイン状態を確認してください。',
          );
      }
    });
  }
  function rebase() {
    if (!latest || busy || publicationLock.current) return;
    setDraft(latest);
    remember(latest);
    setLatest(null);
    setProblem(false);
    setDeletion('idle');
    setStatus(
      deletion === 'unknown'
        ? '保存済みの版を基準にしました。手元の文章は保持しています。削除にはもう一度確認が必要です。'
        : same(currentText.current, latest)
          ? '保存済みの版と一致しています。保存を確認しました。'
          : '手元の編集を保持し、保存の基準を更新しました。次の保存で、確認した版を置き換えます。',
    );
  }
  function askDelete() {
    if (
      !ordinary ||
      !draft ||
      lock.current ||
      publicationLock.current ||
      compositionRef.current ||
      problem ||
      deletion !== 'idle'
    )
      return;
    setLatest(null);
    setDeletion('confirm');
  }
  function cancelDelete() {
    if (deletion !== 'confirm' || lock.current) return;
    setDeletion('idle');
    requestAnimationFrame(() => deleteButton.current?.focus());
  }
  async function remove() {
    if (!ordinary || !draft || deletion !== 'confirm' || lock.current || publicationLock.current)
      return;
    const snapshot = draft;
    await run(async () => {
      setDeletion('pending');
      setStatus('下書きの削除結果を確認しています…');
      try {
        await client.delete(snapshot.id, snapshot.version);
      } catch {
        if (mounted.current) {
          setDeletion('unknown');
          setLatest(null);
          setStatus(
            '削除結果を確認できませんでした。手元の文章は残しています。再削除せず、保存済みの版を確認してください。',
          );
        }
        return;
      }
      if (!mounted.current) return;
      focusAfterDelete.current = true;
      setDraft(null);
      setText({ title: '', body: '' });
      setLatest(null);
      setProblem(false);
      setPreview(false);
      setDeletion('idle');
      setList((rows) => rows.filter((row) => row.id !== snapshot.id));
      setStatus('下書きを削除しました。公開済みの記事は変更していません。');
      try {
        const rows = await client.list();
        if (!mounted.current) return;
        if (rows.some((row) => row.id === snapshot.id)) throw Error('Inconsistent draft list');
        setList(rows);
        setListError(false);
      } catch {
        if (mounted.current) setListError(true);
      }
    }, true);
  }
  function startComposition() {
    pendingFormat.current = null;
    compositionRef.current = true;
    setComposing(true);
  }
  function endComposition() {
    compositionRef.current = false;
    setComposing(false);
  }
  function format(tool: MarkdownTool) {
    const area = bodyRef.current;
    if (!area || editingLocked || preview || compositionRef.current) return;
    const source = currentText.current.body;
    if (area.value !== textareaText(source)) return;
    const result = formatMarkdown(source, tool, area.selectionStart, area.selectionEnd);
    if (!result) {
      setStatus('文字の選択位置を確認して、もう一度操作してください。');
      return;
    }
    pendingFormat.current = result;
    setText((t) => ({ ...t, body: result.body }));
  }
  useLayoutEffect(() => {
    const selection = pendingFormat.current;
    if (!selection) return;
    pendingFormat.current = null;
    const area = bodyRef.current;
    if (
      !area ||
      opening ||
      preview ||
      compositionRef.current ||
      text.body !== selection.body ||
      area.value !== textareaText(selection.body)
    )
      return;
    area.focus({ preventScroll: true });
    area.setSelectionRange(selection.start, selection.end);
  });
  return (
    <div className={'draft-editor' + (ordinary ? ' draft-editor--ordinary' : '')}>
      {!ordinary && (
        <>
          <a className="editor-skip" href="#editor-main">
            編集エリアへ移動
          </a>
          <header className="editor-header">
            <div className="editor-brand">
              <span aria-hidden="true">k.</span>
              <div>
                Kobe Student Hub<small>書きながら、経験を言葉に。</small>
              </div>
            </div>
            <span className="editor-local-badge">ローカル編集検証</span>
          </header>
          <div className="editor-local-notice">
            架空のアカウントを使ったローカル専用画面です。実際の学校ログイン・本番の投稿は利用できません。
          </div>
        </>
      )}
      <div className="editor-layout">
        <aside className="editor-sidebar" aria-label="自分の下書き">
          <div className="editor-side-heading">
            {ordinary ? <h2>自分の下書き</h2> : <h1>下書き</h1>}
            <span>本人だけに表示</span>
          </div>
          <Button
            ref={newDraftButton}
            aria-label="新しい下書き"
            className="editor-primary editor-new"
            disabled={busy || publicationBusy || deletionOpen}
            onClick={() => void create()}
          >
            ＋ 新しい下書き
          </Button>
          <div className="editor-list-heading">
            <h2>保存した下書き</h2>
            <Button
              className="editor-link-button"
              disabled={busy || publicationBusy || deletion === 'confirm'}
              onClick={() => void refresh()}
            >
              一覧を更新
            </Button>
          </div>
          {listError && (
            <p className="editor-list-error" role="alert">
              一覧を読み込めない、または更新が必要です。
              {ordinary && !draft ? '一覧を更新してください。' : '編集内容は消えていません。'}
            </p>
          )}
          <ul className="editor-draft-list">
            {list.map((item) => (
              <li key={item.id}>
                <Button
                  aria-label={item.title || '無題の下書き'}
                  disabled={busy || publicationBusy || deletionOpen}
                  aria-current={draft?.id === item.id ? 'true' : undefined}
                  onClick={() => void choose(item.id)}
                >
                  <span>{item.title || '無題の下書き'}</span>
                  <small>
                    {stamp(item.updatedAt)} · 版 {item.version}
                  </small>
                </Button>
              </li>
            ))}
          </ul>
          {!list.length && !busy && !listError && (
            <p className="editor-list-empty">保存した下書きはまだありません。</p>
          )}
          <p className="editor-list-limit">更新が新しい20件まで表示します。</p>
          <div className="editor-publish-note">
            <h2>公開について</h2>
            <p>
              {ordinary
                ? '下書きは本人だけに表示されます。公開するには、保存済みの版とプロフィールを確認してください。'
                : '確認した保存済みの版だけを、ローカル内で試験公開できます。本番への公開ではありません。'}
            </p>
          </div>
        </aside>
        <EditorRegion className="editor-main" id="editor-main" tabIndex={-1}>
          <div className="editor-main-heading">
            <div>
              {!ordinary && <p className="editor-eyebrow">YOUR WORDS, YOUR PACE</p>}
              <h2>{draft ? '経験を、書き残そう。' : 'まずは、ひとつの気づきから。'}</h2>
            </div>
            {draft && (
              <span className={'editor-save-state ' + (dirty ? 'is-dirty' : '')}>
                {dirty ? '未保存の変更あり' : '保存済み'}
              </span>
            )}
          </div>
          <div className="editor-status" role="status" aria-live="polite">
            {status}
          </div>
          {draft ? (
            <>
              <section className="editor-writing-card" aria-label="下書きの編集">
                <label className="editor-title-label" htmlFor="draft-title">
                  タイトル
                </label>
                <input
                  id="draft-title"
                  disabled={editingLocked}
                  ref={titleRef}
                  className="editor-title"
                  value={text.title}
                  maxLength={400}
                  placeholder="たとえば、初めてのチーム制作で学んだこと"
                  onCompositionStart={startComposition}
                  onCompositionEnd={endComposition}
                  onChange={(event) => {
                    pendingFormat.current = null;
                    setText((t) => ({ ...t, title: event.target.value }));
                  }}
                />
                <div className="editor-tabs" aria-label="表示の切り替え">
                  <Button
                    disabled={composing || (ordinary && editingLocked)}
                    aria-pressed={!preview}
                    onClick={() => {
                      if (compositionRef.current) return;
                      pendingFormat.current = null;
                      setPreview(false);
                    }}
                  >
                    編集
                  </Button>
                  <Button
                    disabled={composing || (ordinary && editingLocked)}
                    aria-pressed={preview}
                    onClick={() => {
                      if (compositionRef.current) return;
                      pendingFormat.current = null;
                      setPreview(true);
                    }}
                  >
                    プレビュー
                  </Button>
                </div>
                {preview ? (
                  <div className="editor-preview" aria-label="Markdownプレビュー">
                    <h3>{text.title || '無題の下書き'}</h3>
                    <PreviewBoundary>
                      <MarkdownRenderer body={text.body} />
                    </PreviewBoundary>
                    {!text.body && (
                      <p className="editor-muted">本文を書くと、ここに表示されます。</p>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="editor-format" aria-label="Markdown補助">
                      <Button
                        disabled={editingLocked || composing}
                        onPointerDown={(event) => {
                          if (compositionRef.current) event.preventDefault();
                        }}
                        onClick={() => format('heading')}
                      >
                        見出し
                      </Button>
                      <Button
                        disabled={editingLocked || composing}
                        onPointerDown={(event) => {
                          if (compositionRef.current) event.preventDefault();
                        }}
                        onClick={() => format('bold')}
                      >
                        太字
                      </Button>
                      <Button
                        disabled={editingLocked || composing}
                        onPointerDown={(event) => {
                          if (compositionRef.current) event.preventDefault();
                        }}
                        onClick={() => format('code')}
                      >
                        コード
                      </Button>
                      <span>
                        {composing
                          ? '文字の変換を確定してから操作してください'
                          : 'Markdownで書けます'}
                      </span>
                    </div>
                    <label className="editor-body-label" htmlFor="draft-body">
                      Markdown本文
                    </label>
                    <textarea
                      id="draft-body"
                      disabled={editingLocked}
                      ref={bodyRef}
                      value={text.body}
                      maxLength={262144}
                      placeholder={
                        '試したこと、うまくいかなかったこと、次にやってみたいこと。\n\nあなたの経験を、自分の言葉で。'
                      }
                      onCompositionStart={startComposition}
                      onCompositionEnd={endComposition}
                      onChange={(event) => {
                        pendingFormat.current = null;
                        setText((t) => ({ ...t, body: event.target.value }));
                      }}
                    />
                  </>
                )}
                <div className="editor-writing-footer">
                  <span>
                    {Array.from(text.title).length}/200文字 · 本文 {(bytes / 1024).toFixed(1)}/256
                    KiB
                  </span>
                  <span>画像・Mermaidは未対応</span>
                </div>
              </section>
              {invalid && (
                <p role="alert" className="editor-error">
                  {invalid}
                </p>
              )}
              <div className="editor-save-bar">
                <p>
                  自動保存はありません。変更後は保存してください。
                  <br />
                  <small>未保存の文章は、タブを閉じると失われる場合があります。</small>
                </p>
                <Button
                  className="editor-primary"
                  disabled={busy || publicationBusy || deletionOpen || !dirty || Boolean(invalid)}
                  onClick={() => void save()}
                >
                  下書きを保存
                </Button>
              </div>
              {ordinary && (
                <section className="editor-draft-management" aria-label="下書きの整理">
                  {deletion === 'idle' ? (
                    <>
                      <Button
                        ref={deleteButton}
                        className="editor-delete"
                        disabled={busy || publicationBusy || composing || problem}
                        onClick={askDelete}
                      >
                        この下書きを削除
                      </Button>
                      <p>下書きだけを削除します。公開済みの記事は残ります。</p>
                    </>
                  ) : deletion === 'unknown' ? (
                    <div role="alert" aria-label="削除結果の確認">
                      <h3>削除結果を確認できませんでした</h3>
                      <p>
                        保存・再削除は止めています。手元の文章はこの画面に残しています。保存済みの版を取得できた場合は、確認した版を明示的に基準にしてから操作してください。
                      </p>
                      <p>
                        一覧にない場合や保存版を取得できない場合も、削除済みとは判断できません。この画面を離れると、手元の文章は失われます。
                      </p>
                      <Button disabled={busy} onClick={() => void inspect()}>
                        保存済みの版を確認
                      </Button>
                    </div>
                  ) : (
                    <div
                      role="region"
                      aria-label="下書きの削除確認"
                      aria-busy={deletion === 'pending'}
                    >
                      <h3>この下書きを削除しますか？</h3>
                      <p className="editor-delete-target">
                        <strong>{draft.title || '無題の下書き'}</strong>
                        <span>保存版 {draft.version}</span>
                      </p>
                      <p>
                        保存版と、この画面の未保存の変更は失われます。元に戻せません。公開済みの記事は残ります。
                      </p>
                      <div className="editor-delete-actions">
                        <Button ref={deleteCancel} disabled={busy} onClick={cancelDelete}>
                          キャンセル
                        </Button>
                        <Button
                          className="editor-delete"
                          disabled={busy}
                          onClick={() => void remove()}
                        >
                          {deletion === 'pending'
                            ? '削除結果を確認中…'
                            : '保存版と手元の変更を削除'}
                        </Button>
                      </div>
                    </div>
                  )}
                </section>
              )}
              {
                <PublicationComposer
                  surface={ordinary ? 'ordinary' : 'lab'}
                  key={draft.id}
                  draft={draft}
                  csrfToken={csrfToken}
                  fetcher={fetcher}
                  dirty={dirty}
                  parentBusy={busy || opening || (ordinary && (deletionOpen || problem))}
                  canStart={canPublishStart}
                  onPending={onPublicationPending}
                  onUnsavedPreparation={onUnsavedPreparation}
                />
              }
              {problem && (
                <section className="editor-recovery" role="alert" aria-label="保存結果の確認">
                  <h3>手元の編集を残して、保存済みの版を確認</h3>
                  <p>
                    保存が完了している場合や、別の画面で更新された場合があります。確認せずに繰り返し保存しないでください。
                  </p>
                  <Button disabled={busy || publicationBusy} onClick={() => void inspect()}>
                    保存済みの版を確認
                  </Button>
                </section>
              )}
              {latest && (
                <section className="editor-comparison" aria-label="保存済みの版">
                  <div>
                    <h3>保存済みの版 {latest.version}</h3>
                    <p>{stamp(latest.updatedAt)} 更新 · 手元の文章は書き換えていません。</p>
                  </div>
                  <label htmlFor="saved-title">保存済みタイトル</label>
                  <input id="saved-title" readOnly value={latest.title} />
                  <label htmlFor="saved-body">保存済み本文</label>
                  <textarea id="saved-body" readOnly value={latest.body} />
                  <p>
                    {deletion === 'unknown'
                      ? '確認した版を基準にすると、手元の編集を保ったまま保存・削除の操作を再開できます。削除にはもう一度確認が必要です。'
                      : '確認した版を基準にすると、手元の編集を保ったまま再保存できます。次の保存で、この版を置き換えます。'}
                  </p>
                  <Button disabled={busy || publicationBusy} onClick={rebase}>
                    確認した版を基準にする
                  </Button>
                </section>
              )}
            </>
          ) : (
            <section className="editor-welcome">
              {!ordinary && <span aria-hidden="true">✎</span>}
              <h3>小さな経験も、次の誰かのヒントに。</h3>
              <p>
                新しい下書きを作成するか、保存した下書きを選んでください。
                <br />
                書くことと、読みやすさの確認を行き来できます。
              </p>
              <Button
                className="editor-primary"
                disabled={busy || publicationBusy || deletionOpen}
                onClick={() => void create()}
              >
                新しい下書きを作成
              </Button>
            </section>
          )}
        </EditorRegion>
      </div>
      {!ordinary && (
        <footer className="editor-footer">
          ローカル専用 · 実際のログイン、本番公開、学生による価値検証は未実施です。
        </footer>
      )}
    </div>
  );
}
