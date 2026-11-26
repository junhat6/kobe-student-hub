import { RecordReadingHistory } from '../history/RecordReadingHistory';
import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { createPublicProjectClient } from '../editor/public-project-client';
import { createPublicWorksClient } from '../editor/public-works-client';
import PublicProjectCard from '../editor/PublicProjectCard';
import { ProjectText } from '../editor/ProjectRegistration';
import OrdinaryProjectReport from './OrdinaryProjectReport';
import { usePublicRead, ReadFailure, ReadMissing } from './public-read';
import { useUnsavedNavigation } from '../account/useUnsavedNavigation';
import './discovery.css';
import { AuthorAvatar } from '../shared/public-avatars';
import EmptySprout from '../shared/EmptySprout';
import ProjectStageMark from '../shared/ProjectStageMark';
import LoadingSkeleton from '../shared/LoadingSkeleton';
import Icon from '../shared/Icon';
import { useViewer } from '../shell/viewer';
import { PublicTime } from '../shared/PublicTime';

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
        <LoadingSkeleton shape="cards" label="作品を読み込んでいます…" />
      ) : !value.cards.length ? (
        <div className="empty">
          <EmptySprout />
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
  const { viewer } = useViewer();
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
    return <LoadingSkeleton shape="detail" label="作品を読み込んでいます…" className="shell" />;
  const { project, author } = value;
  // Display-only, as on the author page: the editor opens the draft only from the owner's own
  // server list, and every write is refused by the server unless the session owns it (#289).
  const own = viewer.status === 'signed-in' && viewer.profile?.id === author.id;
  const articles = value.articles ?? [],
    journal = value.journal ?? [];
  return (
    <div className="shell detail-layout">
      <RecordReadingHistory kind="project" contentId={project.id} />
      <article>
        <Link className="back" to="/works">
          ← 作品一覧へ
        </Link>
        <div className="detail-header">
          <div className="detail-title-row">
            <h1>
              {project.title} <ProjectStageMark stage={project.stage} />
            </h1>
            {own && (
              <Link
                className="detail-edit"
                to="/works/new"
                state={{ editProject: project.id }}
                aria-label="作品を編集"
                title="作品を編集"
              >
                <Icon name="pencil" size={18} />
              </Link>
            )}
          </div>
          <div className="detail-author">
            <Link className="author" to={`/students/${author.id}/works`}>
              <AuthorAvatar
                id={author.id}
                initials={author.initials}
                className="avatar"
                size={44}
              />
              <span>
                {author.name}
                <small>{[author.department, author.year].filter(Boolean).join(' · ')}</small>
              </span>
            </Link>
            <div className="detail-author-end">
              <span>
                <PublicTime day={project.publishedOn} at={project.publishedAt} /> 公開
              </span>
              {!own && (
                <OrdinaryProjectReport
                  key={project.id}
                  projectId={project.id}
                  onNavigationRiskChange={reportRisk}
                />
              )}
            </div>
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
        {journal.length > 0 && (
          // #273: articles the author added after publishing, oldest first, to follow how it was made.
          <section
            className="related-reading project-articles project-journal"
            aria-label="制作日誌"
          >
            <h2>制作日誌</h2>
            <ol>
              {journal.map((entry) => (
                <li key={entry.id}>
                  <PublicTime day={entry.publishedOn} at={entry.publishedAt} />
                  <Link to={'/articles/' + entry.id}>{entry.title}</Link>
                </li>
              ))}
            </ol>
          </section>
        )}
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
