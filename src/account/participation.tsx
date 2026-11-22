import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EnrollmentParticipation } from '../shared/enrollment';
import { createEnrollmentClient } from '../editor/enrollment-client';
import './participation.css';

/** 'checking' = not read yet, 'unknown' = read failed. Neither blocks writing: the server decides. */
export type ParticipationState = EnrollmentParticipation | 'checking' | 'unknown';

/** Only a server-confirmed period outside the participation window turns new writes off. */
export const writesClosed = (value: ParticipationState) =>
  value === 'ended' || value === 'upcoming';

export function useOwnParticipation(csrfToken: string, fetcher: typeof fetch): ParticipationState {
  const client = useMemo(() => createEnrollmentClient(csrfToken, fetcher), [csrfToken, fetcher]);
  const [value, setValue] = useState<ParticipationState>('checking');
  useEffect(() => {
    const controller = new AbortController();
    setValue('checking');
    client.read(controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setValue(result.participation);
      },
      () => {
        if (!controller.signal.aborted) setValue('unknown');
      },
    );
    return () => controller.abort();
  }, [client]);
  return value;
}

/** Explains why new posts are unavailable and which own-management actions still work. */
export function ParticipationNotice({
  participation,
  place,
}: {
  participation: ParticipationState;
  place: 'account' | 'drafts' | 'works';
}) {
  if (!writesClosed(participation)) return null;
  const ended = participation === 'ended';
  const fix =
    place === 'account' ? (
      <a href="#enrollment">在学期間を直す</a>
    ) : (
      <Link to="/account#enrollment">在学期間を直す</Link>
    );
  return (
    <section className="participation-notice" role="note" aria-label="新しい投稿について">
      <h2>{ended ? '卒業予定を過ぎています' : '入学前です'}</h2>
      <p>
        新しい記事・作品は作れません。公開中のものの
        {place === 'account' ? (
          <a href="#publications">停止</a>
        ) : (
          <Link to="/account#publications">停止</Link>
        )}
        と、
        {place === 'drafts' ? '下書きの削除' : <Link to="/drafts">下書きの削除</Link>}
        はできます。
      </p>
      <p>{fix}</p>
    </section>
  );
}
