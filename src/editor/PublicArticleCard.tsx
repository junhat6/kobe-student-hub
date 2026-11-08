import type { PublishedArticleSummary, PublicArticleAuthor } from '../types';
export default function PublicArticleCard({
  entry,
  author,
}: {
  entry: PublishedArticleSummary;
  author?: PublicArticleAuthor;
}) {
  return (
    <article className="author-lab-card">
      <div className="author-lab-card-meta">
        <span>{entry.minutes}分の目安</span>
        <time dateTime={entry.updatedAt}>{entry.updatedAt}</time>
      </div>
      <h3>
        <a href={'/lab/articles/' + entry.id}>{entry.title}</a>
      </h3>
      {author && (
        <a className="discovery-author" href={'/lab/authors/' + author.id}>
          {author.name}
          {(author.department || author.year) && (
            <span>{[author.department, author.year].filter(Boolean).join(' · ')}</span>
          )}
        </a>
      )}
      {entry.summary && <p className="author-lab-summary">{entry.summary}</p>}
      <div className="author-lab-tags">
        {entry.tags.map((tag) => (
          <span key={tag}># {tag}</span>
        ))}
      </div>
      {(entry.audience || entry.prerequisite || entry.outcome) && (
        <dl>
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
    </article>
  );
}
