import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { createPublicStudentClient } from './student-client';
import { AuthorAvatar } from '../shared/public-avatars';
import ProfileLinks from '../shared/ProfileLinks';
import Icon from '../shared/Icon';
import type { Profile } from '../types';
import type { PublicAuthorCard } from '../public-student-types';

function useAuthorCard(id: string) {
  const client = useMemo(() => createPublicStudentClient(), []);
  const [value, setValue] = useState<{ id: string; card: PublicAuthorCard } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    // The counts and titles are on top of the card: a failed read leaves the plain card.
    client.readCard(id, controller.signal).then(
      (card) => setValue({ id, card }),
      () => {},
    );
    return () => controller.abort();
  }, [client, id]);
  return value && value.id === id ? value.card : null;
}

/**
 * 「書いた学生」「つくった学生」: one card for articles and projects (#312), so a reader can go
 * from what they just read to what else the person made. Only public counts and titles; no
 * follower, view or like totals (they would turn the card into a popularity score).
 */
export default function AuthorCard({
  author,
  heading,
  current,
  profilePath,
}: {
  author: Profile;
  heading: string;
  /** The article or project on this page, left out of 「ほかの記事・作品」. */
  current: { kind: 'article' | 'project'; id: string };
  profilePath: string;
}) {
  const card = useAuthorCard(author.id);
  const others = card
    ? card.recent
        .filter((item) => !(item.kind === current.kind && item.id === current.id))
        .slice(0, 3)
    : [];
  return (
    <section className="side-box author-side author-card" aria-label={heading}>
      <h2>{heading}</h2>
      <Link className="author-side-name" to={profilePath}>
        <AuthorAvatar id={author.id} initials={author.initials} className="mini-avatar" size={44} />
        <span>
          {author.name}
          <small>{[author.department, author.year].filter(Boolean).join(' · ')}</small>
        </span>
      </Link>
      {author.bio && <p className="author-card-bio">{author.bio}</p>}
      {card && <ProfileLinks links={card.links} name={author.name} />}
      {card && (
        // A kind with nothing public is left out: 「記事 0」 says nothing a reader can act on.
        <p className="author-card-counts">
          公開中の
          {(
            [
              ['記事', card.articles],
              ['作品', card.projects],
            ] as const
          )
            .filter(([, count]) => count > 0)
            .map(([label, count], index) => (
              <Fragment key={label}>
                {index > 0 && <span aria-hidden="true"> · </span>}
                {label} <strong>{count}</strong>
              </Fragment>
            ))}
        </p>
      )}
      {others.length > 0 && (
        <div className="author-card-others">
          <h3>ほかの記事・作品</h3>
          <ul>
            {others.map((item) => (
              <li key={item.kind + item.id}>
                {/* 原則2: 種類はマイページ・履歴と同じアイコン（記事＝doc、作品＝cube）、読み上げは文字で。 */}
                <span
                  className={'author-card-kind ' + item.kind}
                  title={item.kind === 'article' ? '記事' : '作品'}
                >
                  <Icon name={item.kind === 'article' ? 'doc' : 'cube'} size={14} />
                  <span className="sr-only">{item.kind === 'article' ? '記事' : '作品'}</span>
                </span>
                <Link
                  to={(item.kind === 'article' ? '/articles/' : '/projects/') + item.id}
                  title={item.title}
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Link className="author-side-more" to={profilePath}>
        プロフィールを見る →
      </Link>
    </section>
  );
}
