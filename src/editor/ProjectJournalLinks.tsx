import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@base-ui/react/button';
import { PROJECT_JOURNAL_LIMIT, type ProjectJournal } from '../project-types';
import type { createProjectClient } from './project-client';

type Client = Pick<ReturnType<typeof createProjectClient>, 'journal' | 'setJournalLink'>;

/**
 * 制作日誌 (#273): after a project is published, its owner adds or removes their own public articles
 * as journal entries. The server confirms every change; an unconfirmed change is never resent.
 */
export default function ProjectJournalLinks({
  client,
  draftId,
  ownArticles,
  writable,
}: {
  client: Client;
  draftId: string;
  /** Own currently published articles; null when they could not be read. */
  ownArticles: { id: string; title: string }[] | null;
  writable: boolean;
}) {
  const [journal, setJournal] = useState<ProjectJournal | null>(null),
    [failed, setFailed] = useState(false),
    [pending, setPending] = useState<string | null>(null),
    [unknown, setUnknown] = useState(false),
    [message, setMessage] = useState('');
  const generation = useRef(0);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const g = ++generation.current;
      setFailed(false);
      try {
        const value = await client.journal(draftId, signal);
        if (g === generation.current) setJournal(value);
      } catch {
        if (g === generation.current && !signal?.aborted) setFailed(true);
      }
    },
    [client, draftId],
  );
  useEffect(() => {
    const controller = new AbortController();
    setJournal(null);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  async function toggle(articleId: string, linked: boolean, title: string) {
    if (!journal || pending) return;
    setPending(articleId);
    setUnknown(false);
    const g = ++generation.current;
    try {
      const value = await client.setJournalLink(draftId, articleId, linked);
      if (g !== generation.current) return;
      setJournal(value);
      setMessage(
        linked ? `「${title}」を制作日誌に足しました。` : `「${title}」を制作日誌から外しました。`,
      );
    } catch {
      if (g !== generation.current) return;
      setUnknown(true);
      setMessage('');
      // Read the confirmed links again instead of resending the change.
      await load();
    } finally {
      setPending(null);
    }
  }
  const candidates = journal
    ? (ownArticles ?? []).filter((article) => !journal.fixedArticleIds.includes(article.id))
    : [];
  const full = (journal?.articleIds.length ?? 0) >= PROJECT_JOURNAL_LIMIT;
  return (
    <fieldset className="project-article-links project-journal-links">
      <legend>制作日誌</legend>
      <p className="sr-only" role="status" aria-live="polite">
        {message}
      </p>
      {failed ? (
        <p role="alert">
          制作日誌を読み込めませんでした。{' '}
          <Button onClick={() => void load()}>もう一度読み込む</Button>
        </p>
      ) : !journal ? (
        <p>制作日誌を読み込んでいます…</p>
      ) : ownArticles === null ? (
        <p>自分の公開記事を確認できませんでした。「公開の確認をもう一度」を押してください。</p>
      ) : !candidates.length ? (
        <p>
          日誌にできる公開中の記事はまだありません。
          <a href="/drafts">記事を公開</a>
          すると、ここから作品の制作日誌に足せます。
        </p>
      ) : (
        <>
          <p>
            選んだ記事は作品ページに公開日の順で並びます。あとから足したり外したりできます（
            {PROJECT_JOURNAL_LIMIT}件まで）。
          </p>
          {candidates.map((article) => {
            const checked = journal.articleIds.includes(article.id);
            return (
              <label key={article.id}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!writable || pending !== null || (!checked && full)}
                  onChange={(event) =>
                    void toggle(article.id, event.currentTarget.checked, article.title)
                  }
                />
                {article.title}
              </label>
            );
          })}
        </>
      )}
      {unknown && <p role="alert">日誌の変更を確かめられませんでした。自動で再送しません。</p>}
    </fieldset>
  );
}
