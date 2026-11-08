import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@base-ui/react/button';
import { createModerationClient } from '../editor/moderation-client';
import type { OwnModerationNotice } from '../notification-types';
import './notifications.css';
const label = {
  temporarily_hidden: '記事が一時非公開になりました',
  restored: '記事が復元されました',
  deleted: '記事が公開表示から削除されました',
};
export default function OwnNotifications({ fetcher }: { fetcher: typeof fetch }) {
  const client = useMemo(() => createModerationClient(fetcher), [fetcher]);
  const mounted = useRef(true),
    lock = useRef(false);
  const [items, setItems] = useState<OwnModerationNotice[] | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('自分の記事に対する判断と、その理由を確認できます。');
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function load() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setItems(null);
    setMessage('お知らせを確認しています…');
    try {
      const value = await client.ownNotifications();
      if (mounted.current) {
        setItems(value);
        setMessage(
          value.length ? '新しいお知らせから20件まで表示しています。' : 'お知らせはありません。',
        );
      }
    } catch {
      if (mounted.current) setMessage('お知らせを確認できませんでした。もう一度確認してください。');
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section aria-label="運営からのお知らせ" className="account-notifications">
      <h2>運営からのお知らせ</h2>
      <p role="status">{message}</p>
      <Button disabled={busy} onClick={() => void load()}>
        お知らせを確認
      </Button>
      {items && (
        <ul className="notification-list">
          {items.map((item) => (
            <li key={item.id}>
              <h3>{label[item.kind]}</h3>
              <p>{item.title}</p>
              <time dateTime={new Date(item.createdAt).toISOString()}>
                {new Date(item.createdAt).toLocaleDateString('ja-JP')}
              </time>
              <p className="notification-reason">{item.reason}</p>
              <Link to="/account#publications">自分の公開記録を確認する</Link>
            </li>
          ))}
        </ul>
      )}
      <p className="moderation-limit">判断についての相談・異議申立ての窓口は未設定です。</p>
    </section>
  );
}
