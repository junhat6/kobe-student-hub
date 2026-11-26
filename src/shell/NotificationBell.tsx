import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Popover } from '@base-ui/react/popover';
import { createModerationClient } from '../editor/moderation-client';
import type { OwnModerationNotice } from '../notification-types';
import { noticeLabel } from '../shared/notice-label';
import Icon from '../shared/Icon';
import { hasUnseen, markSeen, onSeenChange, readSeenAt } from './notice-seen';
import { NoticeTime } from '../shared/PublicTime';

const shown = 5;

/**
 * Header bell for the signed-in reader's own notices (moderation results). It reads the same
 * owner-only API as the account page, once per session token and again when opened. The dot
 * only says "something new"; counts and push/email nudges are deliberately not offered.
 */
export default function NotificationBell({ session }: { session: string }) {
  const client = useMemo(() => createModerationClient(), []);
  const [items, setItems] = useState<OwnModerationNotice[] | null>(null),
    [failed, setFailed] = useState(false),
    [attempt, setAttempt] = useState(0),
    [open, setOpen] = useState(false),
    [seenAt, setSeenAt] = useState(readSeenAt),
    // What was already seen when the panel opened, so the new rows stay marked while it is open.
    [highlightFrom, setHighlightFrom] = useState(0);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => onSeenChange(() => setSeenAt(readSeenAt())), []);
  useEffect(() => {
    let live = true;
    setFailed(false);
    client.ownNotifications().then(
      (value) => {
        if (!live) return;
        setItems(value);
        if (openRef.current) markSeen(value);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [client, session, attempt]);
  const unseen = !!items && hasUnseen(items, seenAt);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) return;
        setHighlightFrom(readSeenAt());
        if (items) markSeen(items);
        setAttempt((n) => n + 1);
      }}
    >
      <Popover.Trigger
        className="header-bell"
        aria-label={unseen ? 'お知らせ（新しいお知らせがあります）' : 'お知らせ'}
      >
        <Icon name="bell" size={20} />
        {unseen && <span className="header-bell-dot" aria-hidden="true" />}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end" className="menu-positioner">
          <Popover.Popup className="menu-popup bell-popup" aria-label="お知らせ">
            <Popover.Title className="bell-title">お知らせ</Popover.Title>
            {failed && !items ? (
              <p className="bell-empty" role="alert">
                読み込めませんでした。
                <button
                  type="button"
                  className="bell-retry"
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  もう一度
                </button>
              </p>
            ) : !items ? (
              <p className="bell-empty">読み込み中…</p>
            ) : items.length === 0 ? (
              <p className="bell-empty">お知らせはまだありません</p>
            ) : (
              <ul className="bell-list">
                {items.slice(0, shown).map((item) => (
                  <li
                    key={item.id}
                    className={item.createdAt > highlightFrom ? 'is-new' : undefined}
                  >
                    <b>
                      {item.createdAt > highlightFrom && <span className="sr-only">新着 </span>}
                      {noticeLabel(item)}
                    </b>
                    <span className="bell-item-title">{item.title}</span>
                    <NoticeTime at={item.createdAt} />
                  </li>
                ))}
              </ul>
            )}
            {!!items?.length && (
              <Popover.Close
                className="menu-item bell-more"
                render={<Link to="/account#notifications" />}
              >
                理由と相談先をマイページで見る
              </Popover.Close>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
