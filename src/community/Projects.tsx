import { formatDate } from '../shared/display';
import { RecordReadingHistory } from '../history/RecordReadingHistory';
import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { createPublicProjectClient } from '../editor/public-project-client';
import { createPublicWorksClient } from '../editor/public-works-client';
import PublicProjectCard from '../editor/PublicProjectCard';
import { ProjectText } from '../editor/ProjectRegistration';
import ProjectReport from '../editor/ProjectReport';
import { usePublicRead, ReadFailure, ReadMissing } from './public-read';
import { useUnsavedNavigation } from '../account/useUnsavedNavigation';
import './discovery.css';

function Works() {
  const client = useMemo(() => createPublicWorksClient(fetch, 'ordinary'), []);
  const read = useMemo(() => (signal: AbortSignal) => client.read(signal), [client]);
  const { value, failed, retry } = usePublicRead('works', read);
  return (
    <section className="shell profile-page">
      <div className="section-top">
        <h1>学生の作品</h1>
        <Link className="primary" to="/works/new">
          作品を登録する
        </Link>
      </div>
      {failed ? (
        <ReadFailure subject="作品一覧" retry={retry} />
      ) : !value ? (
        <p role="status">作品を読み込んでいます…</p>
      ) : !value.cards.length ? (
        <div className="empty">
          <h2>まだ作品がありません</h2>
          <p>つくったものを紹介してみませんか。完成していなくても大丈夫です。</p>
          <Link className="primary" to="/works/new">
            作品を登録する
          </Link>
        </div>
      ) : (
        <>
          <div className="author-lab-cards">
            {value.cards.map(({ project, author }) => (
              <PublicProjectCard
                key={project.id}
                project={project}
                author={author}
                surface="ordinary"
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Project({ id }: { id: string }) {
  const client = useMemo(() => createPublicProjectClient(fetch, 'ordinary'), []);
  const read = useMemo(() => (signal: AbortSignal) => client.read(id, signal), [client, id]);
  const { value, failed, missing, retry } = usePublicRead(id, read);
  const reportRisk = useUnsavedNavigation(
    '未送信の通報、または結果を確認中の操作があります。画面を離れると手元の入力は失われます。移動しますか？',
  );
  if (missing)
    return <ReadMissing subject="作品" back={{ to: '/works', label: '作品一覧へ戻る' }} />;
  if (failed) return <ReadFailure subject="作品" retry={retry} />;
  if (!value)
    return (
      <p role="status" className="shell empty">
        作品を読み込んでいます…
      </p>
    );
  const { project, author } = value;
  const articles = value.articles ?? [];
  return (
    <div className="shell detail-layout">
      <RecordReadingHistory kind="project" contentId={project.id} />
      <article>
        <Link className="back" to="/works">
          ← 作品一覧へ
        </Link>
        <div className="detail-header">
          <h1>{project.title}</h1>
          <div className="detail-author">
            <Link className="author" to={`/students/${author.id}/works`}>
              <span className="avatar">{author.initials}</span>
              <span>
                {author.name}
                <small>{[author.department, author.year].filter(Boolean).join(' · ')}</small>
              </span>
            </Link>
            <span>
              <time dateTime={project.publishedOn}>{formatDate(project.publishedOn)}</time> 公開
            </span>
          </div>
        </div>
        <ProjectText value={project} showTitle={false} surface="ordinary" />
        {articles.length > 0 && (
          <section className="related-reading project-articles" aria-label="この作品の記事">
            <h2>この作品の記事</h2>
            <ul>
              {articles.map((article) => (
                <li key={article.id}>
                  <Link to={'/articles/' + article.id}>{article.title}</Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        <ProjectReport
          key={project.id}
          projectId={project.id}
          surface="ordinary"
          onNavigationRiskChange={reportRisk}
        />
      </article>
      <aside>
        <section className="side-box">
          <h2>つくった学生</h2>
          <Link to={`/students/${author.id}/works`}>{author.name}</Link>
          <p>{author.bio}</p>
        </section>
      </aside>
    </div>
  );
}

export default function Projects() {
  const { pathname } = useLocation();
  const [kind, id] = pathname.split('/').slice(1);
  return kind === 'projects' && id ? <Project key={id} id={id} /> : <Works />;
}
