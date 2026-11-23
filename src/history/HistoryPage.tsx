import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@base-ui/react/button';
import AccountSessionBoundary from '../account/AccountSessionBoundary';
import Icon from '../shared/Icon';
import { createReadingHistoryClient } from './client';
import type { ReadingHistoryEntry, ReadingReference, ReadingHistoryPage } from './types';
import '../account/account.css';
import './history.css';

const PAGE = 20;
/** Show the cap only once the owner's total is this close to it (YouTube・Chrome never mention one). */
const NEAR_CAPACITY = 480;

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** 今日・昨日・11月20日（年が違えば 2025年11月20日）— YouTube・Chrome の履歴の見出し。 */
export function dayLabel(at: number, now = Date.now()) {
  const d = new Date(at),
    today = new Date(now),
    yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return '今日';
  if (dayKey(d) === dayKey(yesterday)) return '昨日';
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.getFullYear() === today.getFullYear() ? md : `${d.getFullYear()}年${md}`;
}

/** Entries arrive newest first, so consecutive runs of one day form that day's group. */
function byDay(entries: ReadingHistoryEntry[], now: number) {
  const groups: { label: string; entries: ReadingHistoryEntry[] }[] = [];
  for (const entry of entries) {
    const label = dayLabel(entry.lastViewedAt, now),
      last = groups[groups.length - 1];
    if (last?.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }
  return groups;
}

function OwnHistory({ csrfToken, fetcher }: { csrfToken: string; fetcher: typeof fetch }) {
  const client = useMemo(
    () => createReadingHistoryClient(csrfToken, fetcher),
    [csrfToken, fetcher],
  );
  const [value, setValue] = useState<ReadingHistoryPage | null>(null),
    [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [failed, setFailed] = useState(false);
  const mounted = useRef(true),
    lock = useRef(false);
  const load = useCallback(
    async (at = 0, signal?: AbortSignal) => {
      const result = await client.read(at, signal);
      if (mounted.current && !signal?.aborted) {
        setValue(result);
        setOffset(at);
        setFailed(false);
      }
    },
    [client],
  );
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    load(0, controller.signal).catch(() => {
      if (mounted.current && !controller.signal.aborted) {
        setFailed(true);
        setMessage('履歴を読み込めませんでした。');
      }
    });
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [load]);
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
        // The result of a write is unknown, so drop the stale list instead of showing it.
        setValue(null);
        setFailed(true);
        setMessage('結果を確認できませんでした。');
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
  const now = Date.now();
  return (
    <section aria-label="自分の閲覧履歴" className="reading-history">
      <div className="history-bar">
        <p className="history-private">
          <Icon name="lock" size={16} />
          自分だけに表示
        </p>
        {value && (
          <label className="history-switch">
            <input
              type="checkbox"
              role="switch"
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
            履歴を残す
          </label>
        )}
        {value && (
          <Button
            className="history-clear"
            disabled={busy || !value.entries.length}
            onClick={() => void remove()}
          >
            <Icon name="trash" size={18} />
            履歴をすべて削除
          </Button>
        )}
      </div>
      <p role="status" className="history-status">
        {message}
      </p>
      {failed && (
        <Button disabled={busy} onClick={() => void act(() => load(value ? offset : 0), '', null)}>
          もう一度
        </Button>
      )}
      {value && value.total >= NEAR_CAPACITY && (
        <p className="history-capacity">
          <Icon name="alert" size={16} />
          上限の{value.capacity}件に達すると、削除するまで新しい記事・作品を記録しません。
        </p>
      )}
      {value ? (
        value.entries.length ? (
          byDay(value.entries, now).map((group) => (
            <section
              key={group.label}
              className="history-day"
              aria-labelledby={'history-day-' + group.label}
            >
              <h2 id={'history-day-' + group.label}>{group.label}</h2>
              <ul className="history-list">
                {group.entries.map((entry) => (
                  <li key={entry.kind + ':' + entry.contentId}>
                    <div className="history-entry">
                      <span>
                        {entry.kind === 'article' ? '記事' : '作品'}
                        {entry.isSample === true && ' · 架空サンプル'}
                      </span>
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
                        {new Date(entry.lastViewedAt).toLocaleTimeString('ja-JP', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    </div>
                    <Button
                      className="history-remove"
                      disabled={busy}
                      aria-label={`${entry.title ?? '公開されていない記事・作品'}を履歴から削除`}
                      onClick={() => void remove({ kind: entry.kind, contentId: entry.contentId })}
                    >
                      <Icon name="close" size={18} />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        ) : (
          <p className="history-empty">閲覧履歴はまだありません。</p>
        )
      ) : (
        !failed && <p role="status">履歴を読み込んでいます…</p>
      )}
      {value && (offset > 0 || value.nextOffset !== null) && (
        <nav className="history-pages" aria-label="履歴のページ">
          <Button
            disabled={busy || offset === 0}
            onClick={() => void act(() => load(Math.max(0, offset - PAGE)), '', null)}
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
        title="閲覧履歴"
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
