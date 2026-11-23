import type { ProjectDiscoverySummary, PublicProjectSummary } from '../project-types';
import type { PublicArticleAuthor } from '../types';
import { publicPaths, type PublicSurface } from '../shared/public-paths';
import SurfaceLink from '../shared/SurfaceLink';
import { formatDate, tagHue } from '../shared/display';
import '../shared/cards.css';
import { AuthorAvatar } from '../shared/public-avatars';

export default function PublicProjectCard({
  project,
  author,
  surface = 'lab',
  inTypedList = false,
}: {
  project: ProjectDiscoverySummary & Partial<Pick<PublicProjectSummary, 'githubUrl' | 'demoUrl'>>;
  author?: PublicArticleAuthor;
  surface?: PublicSurface;
  /** The surrounding tab already says these are works: no band, no kind label (#236). */
  inTypedList?: boolean;
}) {
  const paths = publicPaths(surface);
  const showMeta = !inTypedList || Boolean(project.githubUrl || project.demoUrl);
  return (
    <article
      className="content-card content-card-project"
      style={{ '--card-hue': tagHue(project.title) } as React.CSSProperties}
    >
      {!inTypedList && (
        <div className="content-card-band" aria-hidden="true">
          <span>{project.title.slice(0, 1)}</span>
        </div>
      )}
      <div className="content-card-body">
        {showMeta && (
          <div className="content-card-meta">
            {!inTypedList && <span className="content-card-kind">作品</span>}
            {project.githubUrl && <span>GitHub</span>}
            {project.demoUrl && <span>デモあり</span>}
          </div>
        )}
        <h2>
          <SurfaceLink
            surface={surface}
            className="content-card-link"
            to={paths.project(project.id)}
          >
            {project.title}
          </SurfaceLink>
        </h2>
        <p className="content-card-summary project-description">{project.descriptionPreview}</p>
        {project.githubUrl && <p className="sr-only">GitHub URL：{project.githubUrl}</p>}
        {project.demoUrl && <p className="sr-only">デモ URL：{project.demoUrl}</p>}
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
          <time dateTime={project.publishedOn}>{formatDate(project.publishedOn)} 公開</time>
        </div>
      </div>
    </article>
  );
}
