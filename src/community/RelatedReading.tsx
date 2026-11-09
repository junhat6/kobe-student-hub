import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@base-ui/react/button';
import { createOrdinaryDiscoveryClient } from './discovery-client';
import { usePublicRead } from './public-read';
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
      ) : !value.articles.length && !value.projects.length ? (
        <p>同じタグに関連する公開記事・作品はまだありません。</p>
      ) : (
        <ul>
          {value.articles.map(({ entry, author, matchingTag }) => (
            <li key={entry.id}>
              <p className="related-reading-reason">同じタグ「{matchingTag}」の記事</p>
              <h3>
                <Link to={'/articles/' + entry.id}>{entry.title}</Link>
              </h3>
              <p>{entry.summary}</p>
              <Link to={'/students/' + author.id}>{author.name}</Link>
            </li>
          ))}
          {value.projects.map(({ project, author, matchingTag }) => (
            <li key={project.id}>
              <p className="related-reading-reason">タイトル・説明に「{matchingTag}」を含む作品</p>
              <h3>
                <Link to={'/projects/' + project.id}>{project.title}</Link>
              </h3>
              <p>{project.descriptionPreview}</p>
              <Link to={'/students/' + author.id + '/works'}>{author.name}</Link>
            </li>
          ))}
        </ul>
      )}
      <p className="related-reading-limit">
        記事は同じタグから最大4件、作品は記事のタグをタイトル・説明に含むものから最大3件、新しい公開順に表示します。
      </p>
    </section>
  );
}
