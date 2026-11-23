import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { createPublicStudentClient } from './student-client';
import { readSeenLikes, receivedLikes, writeSeenLikes } from './received-likes';
import Icon from '../shared/Icon';
import './received-likes.css';

/**
 * #222: likes one's own public articles have received, returned to the author on their own page
 * (with what arrived since the last visit on this device). Not shown on the public profile, no
 * view counts, no ranking. Nothing is shown until there is at least one like, and a failed read
 * shows nothing: it is a bonus on top of the page, not something to wait for.
 */
export default function ReceivedLikes({ id }: { id?: string }) {
  const client = useMemo(() => createPublicStudentClient(), []);
  const [value, setValue] = useState<{
    id: string;
    view: ReturnType<typeof receivedLikes>;
  } | null>(null);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    client.readReceivedLikes(id, controller.signal).then(
      (received) => {
        // Compare with the previous visit once, then remember this one as the new baseline.
        setValue({ id, view: receivedLikes(received, readSeenLikes(id)) });
        writeSeenLikes(id, received);
      },
      () => {},
    );
    return () => controller.abort();
  }, [client, id]);
  if (!value || value.id !== id || value.view.total === 0) return null;
  const { rows, total, added } = value.view;
  return (
    <section className="received-likes" aria-label="届いたいいね（自分だけに見えます）">
      <p
        className="received-total"
        role="img"
        aria-label={`届いたいいね ${total}` + (added ? `、前回から +${added}` : '')}
      >
        <Icon name="heart" size={16} />
        {total}
        {added > 0 && <span className="received-added">+{added}</span>}
      </p>
      <ul className="received-list">
        {rows.map((row) => (
          <li key={row.id}>
            <Link to={'/articles/' + row.id}>{row.title}</Link>
            <span
              className="received-count"
              role="img"
              aria-label={`いいね ${row.likes}` + (row.added ? `、前回から +${row.added}` : '')}
            >
              <Icon name="heart" size={14} />
              {row.likes}
              {row.added > 0 && <span className="received-added">+{row.added}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
