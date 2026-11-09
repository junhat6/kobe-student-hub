import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@base-ui/react/button';
import AccountSessionBoundary from '../account/AccountSessionBoundary';
import { createReadingHistoryClient } from './client';
import type { ReadingReference, ReadingHistoryPage } from './types';
import '../account/account.css';
import './history.css';
function OwnHistory({ csrfToken, fetcher }: { csrfToken: string; fetcher: typeof fetch }) {
  const client = useMemo(
    () => createReadingHistoryClient(csrfToken, fetcher),
    [csrfToken, fetcher],
  );
  const [value, setValue] = useState<ReadingHistoryPage | null>(null),
    [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const mounted = useRef(true),
    lock = useRef(false);
  async function load(at = 0) {
    const result = await client.read(at);
    if (mounted.current) {
      setValue(result);
      setOffset(at);
    }
  }
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void client
      .read(0, controller.signal)
      .then((result) => {
        if (mounted.current && !controller.signal.aborted) {
          setValue(result);
          setOffset(0);
          setMessage('');
        }
      })
      .catch(() => {
        if (mounted.current && !controller.signal.aborted)
          setMessage('履歴を読み込めませんでした。再読み込みしてください。');
      });
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [client]);
  async function act(run: () => Promise<unknown>, success: string, at: number | null = offset) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      await run();
      if (mounted.current) {
        setMessage(success);
        if (at !== null) await load(at);
      }
    } catch {
      if (mounted.current) {
        setValue(null);
        setMessage('結果を確認できませんでした。履歴を再読み込みして確認してください。');
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function remove(ref?: ReadingReference) {
    if (!ref && !window.confirm('自分の閲覧履歴をすべて削除しますか？')) return;
    await act(
      () => client.remove(ref),
      ref ? '履歴から削除しました。' : '閲覧履歴をすべて削除しました。',
      0,
    );
  }
  return (
    <section aria-label="自分の閲覧履歴" className="reading-history">
      <h2>閲覧履歴</h2>
      <p>
        自分だけに表示されます。最後に読んだ日時と記事・作品への参照を保存します。本文や画像は保存しません。
      </p>
      <p>
        自動削除は行いません。履歴はここから削除できます。上限の500件に達したら、削除するまで新しい記事・作品を記録しません。
      </p>
      {value && (
        <label className="history-setting">
          <input
            type="checkbox"
            checked={value.enabled}
            disabled={busy}
            onChange={(e) => {
              const enabled = e.target.checked;
              setValue((current) => (current ? { ...current, enabled } : current));
              void act(
                () => client.setEnabled(enabled),
                enabled
                  ? '履歴の記録を有効にしました。'
                  : 'これからの履歴の記録を停止しました。既存の履歴は残ります。',
              );
            }}
          />
          これから読む記事・作品を履歴に残す
        </label>
      )}
      <p role="status">{message}</p>
      <div className="history-actions">
        <Button disabled={busy} onClick={() => void act(() => load(offset), '', null)}>
          履歴を再読み込み
        </Button>
        <Button disabled={busy || !value?.entries.length} onClick={() => void remove()}>
          履歴をすべて削除
        </Button>
      </div>
      {value ? (
        value.entries.length ? (
          <ul className="history-list">
            {value.entries.map((entry) => (
              <li key={entry.kind + ':' + entry.contentId}>
                <div>
                  <span>{entry.kind === 'article' ? '記事' : '作品'}</span>
                  <h3>
                    {entry.title ? (
                      <Link
                        to={`/${entry.kind === 'article' ? 'articles' : 'projects'}/${entry.contentId}`}
                      >
                        {entry.title}
                      </Link>
                    ) : (
                      '現在は公開されていません'
                    )}
                  </h3>
                  <time dateTime={new Date(entry.lastViewedAt).toISOString()}>
                    {new Date(entry.lastViewedAt).toLocaleString('ja-JP')}
                  </time>
                </div>
                <Button
                  disabled={busy}
                  aria-label={`${entry.title ?? '公開されていない記事・作品'}を履歴から削除`}
                  onClick={() => void remove({ kind: entry.kind, contentId: entry.contentId })}
                >
                  履歴から削除
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p>閲覧履歴はまだありません。</p>
        )
      ) : (
        !message && <p role="status">履歴を読み込んでいます…</p>
      )}
      {value && (
        <nav className="history-actions" aria-label="履歴のページ">
          <Button
            disabled={busy || offset === 0}
            onClick={() => void act(() => load(Math.max(0, offset - 20)), '', null)}
          >
            前の20件
          </Button>
          <Button
            disabled={busy || value.nextOffset === null}
            onClick={() => void act(() => load(value.nextOffset!), '', null)}
          >
            次の20件
          </Button>
        </nav>
      )}
    </section>
  );
}
export default function HistoryPage() {
  return (
    <section className="account-page">
      <AccountSessionBoundary
        signedOutContent={
          <p>
            <Link to="/login">ログインして履歴を見る</Link>
          </p>
        }
      >
        {(session) => <OwnHistory {...session} />}
      </AccountSessionBoundary>
      <p>
        <Link to="/account">アカウントへ戻る</Link> · <Link to="/">記事・作品を読む</Link>
      </p>
    </section>
  );
}
