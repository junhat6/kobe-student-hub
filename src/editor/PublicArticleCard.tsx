import SurfaceLink from '../shared/SurfaceLink';
import { publicPaths, type PublicSurface } from '../shared/public-paths';
import type { PublishedArticleSummary, PublicArticleAuthor } from '../types';
import { formatDate, tagHue } from '../shared/display';
import '../shared/cards.css';
import { AuthorAvatar } from '../shared/public-avatars';

/**
 * Article card. The title stays the only link name for assistive technology;
 * a stretched pseudo-element makes the whole card a click target.
 */
export default function PublicArticleCard({
  entry,
  author,
  surface = 'lab',
  badge,
  inTypedList = false,
}: {
  entry: PublishedArticleSummary;
  author?: PublicArticleAuthor;
  surface?: PublicSurface;
  badge?: string;
  /**
   * The list around the card already says these are articles (a profile tab). Drop the colour band
   * and the kind label so the title sits at the top and the type is not repeated (#236).
   */
  inTypedList?: boolean;
}) {
  const paths = publicPaths(surface);
  const hue = tagHue(entry.tags[0] ?? entry.title);
  return (
    <article
      className="content-card author-lab-card"
      style={{ '--card-hue': hue } as React.CSSProperties}
    >
      {!inTypedList && (
        <div className="content-card-band" aria-hidden="true">
          <span>{entry.tags[0] ? '# ' + entry.tags[0] : '記事'}</span>
        </div>
      )}
      <div className="content-card-body">
        <div className="content-card-meta">
          {!inTypedList && <span className="content-card-kind">記事</span>}
          {badge && <span className="content-card-badge">{badge}</span>}
          <span>{entry.minutes}分で読める</span>
        </div>
        <h3>
          <SurfaceLink surface={surface} className="content-card-link" to={paths.article(entry.id)}>
            {entry.title}
          </SurfaceLink>
        </h3>
        {entry.summary && <p className="content-card-summary">{entry.summary}</p>}
        {entry.tags.length > 0 && (
          <div className="content-card-tags">
            {entry.tags.map((tag) =>
              surface === 'ordinary' ? (
                <SurfaceLink
                  surface={surface}
                  key={tag}
                  to={`/search?type=article&tag=${encodeURIComponent(tag)}`}
                >
                  # {tag}
                </SurfaceLink>
              ) : (
                <span key={tag}># {tag}</span>
              ),
            )}
          </div>
        )}
        {(entry.audience || entry.prerequisite || entry.outcome) && (
          <dl className="content-card-context">
            {(
              [
                ['想定読者', entry.audience],
                ['前提知識', entry.prerequisite],
                ['読んだあとにできること', entry.outcome],
              ] as const
            )
              .filter(([, text]) => text)
              .map(([label, text]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{text}</dd>
                </div>
              ))}
          </dl>
        )}
        <div className="content-card-foot">
          {author ? (
            <SurfaceLink
              surface={surface}
              className="content-card-author discovery-author"
              to={paths.author(author.id)}
            >
              <AuthorAvatar
                id={author.id}
                initials={author.initials}
                className="mini-avatar"
                size={28}
              />
              <span>
                {author.name}
                {(author.department || author.year) && (
                  <small>{[author.department, author.year].filter(Boolean).join(' · ')}</small>
                )}
              </span>
            </SurfaceLink>
          ) : (
            <span />
          )}
          <time dateTime={entry.updatedAt}>{formatDate(entry.updatedAt)}</time>
        </div>
      </div>
    </article>
  );
}
