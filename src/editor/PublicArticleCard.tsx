import SurfaceLink from '../shared/SurfaceLink';
import { publicPaths, type PublicSurface } from '../shared/public-paths';
import type { PublishedArticleSummary, PublicArticleAuthor } from '../types';
import { tagHue } from '../shared/display';
import '../shared/cards.css';
import { AuthorAvatar } from '../shared/public-avatars';
import Icon from '../shared/Icon';
import { PublicTime } from '../shared/PublicTime';
import ContentKindMark from '../shared/ContentKindMark';
import CardPicture from '../shared/CardPicture';

/**
 * What a card needs: the id and title, plus the public day/time when the list has them. The project
 * page's 「この作品の記事」 links carry only id and title, so their cards show no time (#307).
 */
export type ArticleCardEntry = Pick<PublishedArticleSummary, 'id' | 'title'> &
  Partial<Pick<PublishedArticleSummary, 'tags' | 'updatedAt' | 'publishedAt' | 'image'>>;

/**
 * Article card (#307): picture frame, kind, title, author and public time only. Reading time,
 * summary, reader context and tags stay on the article page and the search chips, so a list reads
 * by title. The title stays the only link name for assistive technology; a stretched
 * pseudo-element makes the whole card a click target.
 */
export default function PublicArticleCard({
  entry,
  author,
  surface = 'lab',
  badge,
  likeCount,
  inTypedList = false,
  headingLevel = 3,
}: {
  entry: ArticleCardEntry;
  author?: PublicArticleAuthor;
  surface?: PublicSurface;
  badge?: string;
  /** Public like count shown as a heart and a number (note・Zenn); the full phrase stays in the name. */
  likeCount?: number;
  /**
   * The list around the card already says these are articles (a profile tab). Drop the picture
   * frame and the kind label so the title sits at the top and the type is not repeated (#236).
   */
  inTypedList?: boolean;
  headingLevel?: 2 | 3;
}) {
  const paths = publicPaths(surface);
  // #310: the colour and the pattern follow the id, so a card keeps its look through edits.
  const hue = tagHue(entry.id);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const time = entry.updatedAt ? <PublicTime day={entry.updatedAt} at={entry.publishedAt} /> : null;
  // In a profile tab there is no author to show, so a footer row would hold only the date.
  // Put the date on the meta line instead of spending a separated row on it (原則1).
  const compactDate = inTypedList && !author;
  const showMeta = !inTypedList || Boolean(badge) || likeCount !== undefined || compactDate;
  return (
    <article
      className="content-card content-card-article author-lab-card"
      style={{ '--card-hue': hue } as React.CSSProperties}
    >
      {!inTypedList && (
        <div className="content-card-band" aria-hidden="true">
          <CardPicture kind="article" id={entry.id} tag={entry.tags?.[0]} image={entry.image} />
        </div>
      )}
      <div className="content-card-body">
        {showMeta && (
          <div className="content-card-meta">
            {!inTypedList && <ContentKindMark kind="article" />}
            {badge && <span className="content-card-badge">{badge}</span>}
            {likeCount !== undefined && (
              <span
                className="content-card-badge content-card-likes"
                title={`公開いいね ${String(likeCount)}件`}
              >
                <Icon name="heart" size={13} />
                <span aria-hidden="true">{likeCount}</span>
                <span className="sr-only">{`公開いいね ${String(likeCount)}件`}</span>
              </span>
            )}
            {compactDate && time}
          </div>
        )}
        <Heading>
          <SurfaceLink surface={surface} className="content-card-link" to={paths.article(entry.id)}>
            {entry.title}
          </SurfaceLink>
        </Heading>
        {!compactDate && (author || time) && (
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
            {time}
          </div>
        )}
      </div>
    </article>
  );
}
