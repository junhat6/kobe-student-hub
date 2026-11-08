import type { ProjectDiscoverySummary, PublicProjectSummary } from '../project-types';
import type { PublicArticleAuthor } from '../types';
export default function PublicProjectCard({
  project,
  author,
}: {
  project: ProjectDiscoverySummary & Partial<Pick<PublicProjectSummary, 'githubUrl' | 'demoUrl'>>;
  author?: PublicArticleAuthor;
}) {
  return (
    <article>
      <p>{project.publishedOn} 公開</p>
      <h2>
        <a href={'/lab/projects/' + project.id}>{project.title}</a>
      </h2>
      {author && (
        <a className="project-card-author" href={'/lab/project-authors/' + author.id}>
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
