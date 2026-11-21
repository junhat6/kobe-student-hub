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
  const correction =
    place === 'account' ? (
      <a href="#enrollment">下の「入学年度と卒業予定年度」で訂正してください。</a>
    ) : (
      <Link to="/account#enrollment">マイページで訂正してください。</Link>
    );
  return (
    <section className="participation-notice" role="note" aria-label="新しい投稿について">
      <h2>{ended ? '卒業予定年度を過ぎています' : '入学年度より前です'}</h2>
      <p>
        {ended
          ? '登録した卒業予定年度を過ぎているため、新しい記事・作品の作成、下書きの保存、公開はできません。'
          : '登録した入学年度より前のため、まだ新しい記事・作品の作成、下書きの保存、公開はできません。'}
      </p>
      <p>
        公開済みの記事・作品は自動では消えず、
        {place === 'account' ? (
          <a href="#publications">「自分の公開記録」</a>
        ) : (
          <Link to="/account#publications">マイページの「自分の公開記録」</Link>
        )}
        から公開停止できます。保存した記事の下書きは
        {place === 'drafts' ? 'この画面' : <Link to="/drafts">下書きの画面</Link>}
        から削除できます。
      </p>
      <p>年度の登録に誤りがあれば、{correction}</p>
    </section>
  );
}
