import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@base-ui/react/button';
import { createOrdinaryDiscoveryClient } from './discovery-client';
import { usePublicRead } from './public-read';
import PublicArticleCard from '../editor/PublicArticleCard';
import PublicProjectCard from '../editor/PublicProjectCard';
export default function RelatedReading({ id }: { id: string }) {
  const client = useMemo(() => createOrdinaryDiscoveryClient(), []);
  const read = useMemo(() => (signal: AbortSignal) => client.related(id, signal), [client, id]);
  const { value, failed, retry } = usePublicRead('related-' + id, read);
  return (
    <section className="related-reading" aria-label="関連する記事・作品">
      <h2>関連する記事・作品</h2>
      {failed ? (
        <>
          <p>関連する記事・作品を読み込めませんでした。</p>
          <Button onClick={retry}>もう一度読み込む</Button>
        </>
      ) : !value ? (
        <p role="status">関連する記事・作品を読み込んでいます…</p>
      ) : !value.articles.length && !value.projects.length && !value.linkedProjects.length ? (
        <p className="related-reading-empty">
          同じタグの記事・作品はまだありません。<Link to="/">ほかの記事を探す →</Link>
        </p>
      ) : (
        // #307: the same cards as the lists; the reason line above each card says why it is here.
        <ul className="related-reading-cards">
          {value.linkedProjects.map(({ project, author }) => (
            <li key={project.id}>
              <p className="related-reading-reason">この記事を紐づけた作品</p>
              <PublicProjectCard
                project={project}
                author={author}
                surface="ordinary"
                headingLevel={3}
              />
            </li>
          ))}
          {value.articles.map(({ entry, author, matchingTag }) => (
            <li key={entry.id}>
              <p className="related-reading-reason">同じタグ「{matchingTag}」の記事</p>
              <PublicArticleCard entry={entry} author={author} surface="ordinary" />
            </li>
          ))}
          {value.projects.map(({ project, author, matchingTag }) => (
            <li key={project.id}>
              <p className="related-reading-reason">タイトル・説明に「{matchingTag}」を含む作品</p>
              <PublicProjectCard
                project={project}
                author={author}
                surface="ordinary"
                headingLevel={3}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
