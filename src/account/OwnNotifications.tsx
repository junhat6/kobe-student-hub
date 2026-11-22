import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@base-ui/react/button';
import { createModerationClient } from '../editor/moderation-client';
import type { OwnModerationNotice } from '../notification-types';
import './notifications.css';
import Icon from '../shared/Icon';
const label = {
  temporarily_hidden: '記事が一時非公開になりました',
  restored: '記事が復元されました',
  deleted: '記事が公開表示から削除されました',
};
/** Loads by itself and stays out of the way when there is nothing to tell. */
export default function OwnNotifications({ fetcher }: { fetcher: typeof fetch }) {
  const client = useMemo(() => createModerationClient(fetcher), [fetcher]);
  const [items, setItems] = useState<OwnModerationNotice[] | null>(null),
    [failed, setFailed] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setFailed(false);
    client.ownNotifications().then(
      (value) => live && setItems(value),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [client, attempt]);
  if (!failed && !items?.length) return null;
  return (
    <section aria-label="運営からのお知らせ" className="account-block account-notifications">
      <h2 className="account-notifications-title">
        <Icon name="bell" size={18} />
        運営からのお知らせ
      </h2>
      {failed ? (
        <p role="alert">
          読み込めませんでした。
          <Button className="text-button" onClick={() => setAttempt((n) => n + 1)}>
            もう一度
          </Button>
        </p>
      ) : (
        <>
          <ul className="notification-list">
            {items!.map((item) => (
              <li key={item.id}>
                <h3>
                  {/^project(?:-report)?\./.test(item.id)
                    ? label[item.kind].replace('記事', '作品')
                    : label[item.kind]}
                </h3>
                <p>{item.title}</p>
                <time dateTime={new Date(item.createdAt).toISOString()}>
                  {new Date(item.createdAt).toLocaleDateString('ja-JP')}
                </time>
                <p className="notification-reason">{item.reason}</p>
                <a href="#publications">自分の公開記録を確認する</a>
              </li>
            ))}
          </ul>
          <p className="moderation-limit">
            <Link
              to="/guide#contact"
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
            >
              判断についての相談・異議申立ての案内（別のタブ）
            </Link>
          </p>
        </>
      )}
    </section>
  );
}
