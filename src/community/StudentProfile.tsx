import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { createPublicStudentClient } from './student-client';
import { usePublicRead, ReadFailure, ReadMissing } from './public-read';
import PublicArticleCard from '../editor/PublicArticleCard';
import PublicProjectCard from '../editor/PublicProjectCard';
import ProfileReport from './ProfileReport';
import { useViewer } from '../shell/viewer';
import { useUnsavedNavigation } from '../account/useUnsavedNavigation';

export default function StudentProfile({
  id,
  view = 'articles',
}: {
  id: string;
  view?: 'articles' | 'projects';
}) {
  const client = useMemo(() => createPublicStudentClient(), []);
  const read = useMemo(() => (signal: AbortSignal) => client.read(id, signal), [client, id]);
  const { value, failed, missing, retry } = usePublicRead(id, read);
  const { viewer } = useViewer();
  const reportRisk = useUnsavedNavigation(
    '未送信の通報、または結果を確認中の操作があります。画面を離れると手元の入力は失われます。移動しますか？',
  );
  if (missing) return <ReadMissing subject="投稿者" />;
  if (failed) return <ReadFailure subject="投稿者" retry={retry} />;
  if (!value)
    return (
      <p role="status" className="shell empty">
        投稿者を読み込んでいます…
      </p>
    );
  const { author, avatar, entries, projects } = value;
  const articles = view === 'articles';
  return (
    <section className="shell profile-page">
      <Link className="back" to={articles ? '/' : '/works'}>
        {articles ? '← 記事一覧へ' : '← 作品一覧へ'}
      </Link>
      <div className="profile-header">
        <span className={'avatar large' + (avatar ? ' has-image' : '')}>
          {avatar ? <img src={avatar} alt="" width={64} height={64} /> : author.initials}
        </span>
        <div>
          <h1>{author.name}</h1>
          <p className="profile-meta">
            {[author.department, author.year].filter(Boolean).join(' · ')}
          </p>
          {author.bio && <p className="profile-bio">{author.bio}</p>}
        </div>
      </div>
      <nav aria-label="投稿者の活動" className="profile-tabs">
        <Link to={`/students/${id}`} aria-current={articles ? 'page' : undefined}>
          記事 <span aria-hidden="true">{entries.length}</span>
        </Link>
        <Link to={`/students/${id}/works`} aria-current={articles ? undefined : 'page'}>
          作品 <span aria-hidden="true">{projects.length}</span>
        </Link>
        <Link to={`/students/${id}/likes`}>公開いいねを見る</Link>
      </nav>
      <h2 className="sr-only">{articles ? '公開している記事' : '公開している作品'}</h2>
      {articles ? (
        entries.length ? (
          <div className="author-lab-cards">
            {entries.map((entry) => (
              <PublicArticleCard key={entry.id} entry={entry} surface="ordinary" />
            ))}
          </div>
        ) : (
          <p className="profile-empty">公開している記事はまだありません。</p>
        )
      ) : projects.length ? (
        <div className="author-lab-cards">
          {projects.map((project) => (
            <PublicProjectCard key={project.id} project={project} surface="ordinary" />
          ))}
        </div>
      ) : (
        <p className="profile-empty">公開している作品はまだありません。</p>
      )}
      {/* Display-only hint: the server independently refuses reports on the reader's own profile. */}
      {!(viewer.status === 'signed-in' && viewer.profile?.id === author.id) && (
        <ProfileReport key={author.id} profileId={author.id} onNavigationRiskChange={reportRisk} />
      )}
    </section>
  );
}
