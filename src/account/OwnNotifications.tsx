import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@base-ui/react/button';
import { createModerationClient } from '../editor/moderation-client';
import type { OwnModerationNotice } from '../notification-types';
import './notifications.css';
import Icon from '../shared/Icon';
import { noticeLabel } from '../shared/notice-label';
import { markSeen } from '../shell/notice-seen';
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
      (value) => {
        if (!live) return;
        setItems(value);
        // Shown in full here, so the header bell stops marking them as new.
        markSeen(value);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [client, attempt]);
  if (!failed && !items?.length) return null;
  return (
    <section
      id="notifications"
      tabIndex={-1}
      aria-label="運営からのお知らせ"
      className="account-block account-notifications"
    >
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
                <h3>{noticeLabel(item)}</h3>
                <p>{item.title}</p>
                <time dateTime={new Date(item.createdAt).toISOString()}>
                  {new Date(item.createdAt).toLocaleDateString('ja-JP')}
                </time>
                <p className="notification-reason">{item.reason}</p>
                {item.kind !== 'avatar_removed' && (
                  <a href="#publications">自分の公開記録を確認する</a>
                )}
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
