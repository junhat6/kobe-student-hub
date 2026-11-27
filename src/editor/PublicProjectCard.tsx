import type { ProjectDiscoverySummary, PublicProjectSummary } from '../project-types';
import type { PublicArticleAuthor } from '../types';
import { publicPaths, type PublicSurface } from '../shared/public-paths';
import SurfaceLink from '../shared/SurfaceLink';
import { tagHue } from '../shared/display';
import '../shared/cards.css';
import { AuthorAvatar } from '../shared/public-avatars';
import ProjectStageMark from '../shared/ProjectStageMark';
import { PublicTime } from '../shared/PublicTime';
import ContentKindMark from '../shared/ContentKindMark';
import CardPicture from '../shared/CardPicture';

/**
 * Work card (#307): the same shape as the article card — picture frame, kind, title, author and
 * public time. The description preview and the GitHub/demo notes stay on the project page. The
 * 制作中 mark (#275) stays: it is a single small labelled mark, not text to read.
 */
export default function PublicProjectCard({
  project,
  author,
  surface = 'lab',
  inTypedList = false,
  headingLevel = 2,
}: {
  project: ProjectDiscoverySummary & Partial<Pick<PublicProjectSummary, 'stage'>>;
  author?: PublicArticleAuthor;
  surface?: PublicSurface;
  /** The surrounding tab already says these are works: no frame, no kind label (#236). */
  inTypedList?: boolean;
  headingLevel?: 2 | 3;
}) {
  const paths = publicPaths(surface);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  // In a profile tab there is no author, so the date moves to the meta line and the footer goes.
  const compactDate = inTypedList && !author;
  // Time only, like the article card: 「たった今 公開」 repeated what every public card already is.
  const published = <PublicTime day={project.publishedOn} at={project.publishedAt} />;
  const showMeta = !inTypedList || compactDate || project.stage === 'in_progress';
  return (
    <article
      className="content-card content-card-project"
      style={{ '--card-hue': tagHue(project.id) } as React.CSSProperties}
    >
      {!inTypedList && (
        <div className="content-card-band" aria-hidden="true">
          <CardPicture kind="project" id={project.id} image={project.image} />
        </div>
      )}
      <div className="content-card-body">
        {showMeta && (
          <div className="content-card-meta">
            {!inTypedList && <ContentKindMark kind="project" />}
            <ProjectStageMark stage={project.stage} />
            {compactDate && published}
          </div>
        )}
        <Heading>
          <SurfaceLink
            surface={surface}
            className="content-card-link"
            to={paths.project(project.id)}
          >
            {project.title}
          </SurfaceLink>
        </Heading>
        {!compactDate && (
          <div className="content-card-foot">
            {author ? (
              <SurfaceLink
                surface={surface}
                className="content-card-author project-card-author"
                to={paths.projectAuthor(author.id)}
              >
                <AuthorAvatar
                  id={author.id}
                  initials={author.initials}
                  className="mini-avatar"
                  size={28}
                />
                <span>
                  {author.name}
                  <small>{[author.department, author.year].filter(Boolean).join(' · ')}</small>
                </span>
              </SurfaceLink>
            ) : (
              <span />
            )}
            {published}
          </div>
        )}
      </div>
    </article>
  );
}
