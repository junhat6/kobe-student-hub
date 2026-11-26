import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { createPublicStudentClient } from './student-client';
import { AuthorAvatar } from '../shared/public-avatars';
import ProfileLinks from '../shared/ProfileLinks';
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
        <p className="author-card-counts">
          公開中の記事 <strong>{card.articles}</strong>
          <span aria-hidden="true"> · </span>
          作品 <strong>{card.projects}</strong>
        </p>
      )}
      {others.length > 0 && (
        <div className="author-card-others">
          <h3>ほかの記事・作品</h3>
          <ul>
            {others.map((item) => (
              <li key={item.kind + item.id}>
                <span className={'author-card-kind ' + item.kind}>
                  {item.kind === 'article' ? '記事' : '作品'}
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
