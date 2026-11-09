import { RecordReadingHistory } from '../history/RecordReadingHistory';
import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { createPublicProjectClient } from '../editor/public-project-client';
import { createPublicWorksClient } from '../editor/public-works-client';
import PublicProjectCard from '../editor/PublicProjectCard';
import { ProjectText } from '../editor/ProjectRegistration';
import ProjectReport from '../editor/ProjectReport';
import { usePublicRead, ReadFailure } from './public-read';
import { useUnsavedNavigation } from '../account/useUnsavedNavigation';

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
      <p>
        <Link to="/">記事を読む</Link> · 作品を探す
      </p>
      {failed ? (
        <ReadFailure subject="作品一覧" retry={retry} />
      ) : !value ? (
        <p role="status">作品を読み込んでいます…</p>
      ) : !value.cards.length ? (
        <div className="empty">
          <h2>まだ作品がありません</h2>
          <p>公開した作品がここに並びます。</p>
        </div>
      ) : (
        <>
          <p>新しい公開作品を最大20件表示しています。</p>
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
  const { value, failed, retry } = usePublicRead(id, read);
  const reportRisk = useUnsavedNavigation(
    '未送信の通報、または結果を確認中の操作があります。画面を離れると手元の入力は失われます。移動しますか？',
  );
  if (failed) return <ReadFailure subject="作品" retry={retry} />;
  if (!value)
    return (
      <p role="status" className="shell empty">
        作品を読み込んでいます…
      </p>
    );
  const { project, author } = value;
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
            <span>{project.publishedOn} 公開</span>
          </div>
        </div>
        <ProjectText value={project} showTitle={false} surface="ordinary" />
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
