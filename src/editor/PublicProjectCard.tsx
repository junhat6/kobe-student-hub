import type { ProjectDiscoverySummary, PublicProjectSummary } from '../project-types';
import type { PublicArticleAuthor } from '../types';
import { publicPaths, type PublicSurface } from '../shared/public-paths';
export default function PublicProjectCard({
  project,
  author,
  surface = 'lab',
}: {
  project: ProjectDiscoverySummary & Partial<Pick<PublicProjectSummary, 'githubUrl' | 'demoUrl'>>;
  author?: PublicArticleAuthor;
  surface?: PublicSurface;
}) {
  return (
    <article>
      <p>{project.publishedOn} 公開</p>
      <h2>
        <a href={publicPaths(surface).project(project.id)}>{project.title}</a>
      </h2>
      {author && (
        <a className="project-card-author" href={publicPaths(surface).projectAuthor(author.id)}>
          <span aria-hidden="true">{author.initials}</span>
          <span>
            {author.name}
            <small>{[author.department, author.year].filter(Boolean).join(' · ')}</small>
          </span>
        </a>
      )}
      <p className="project-description">{project.descriptionPreview}</p>
      {project.githubUrl && <p>GitHub URL：{project.githubUrl}</p>}
      {project.demoUrl && <p>デモ URL：{project.demoUrl}</p>}
    </article>
  );
}
