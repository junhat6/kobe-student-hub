import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { createPublicStudentClient } from './student-client';
import { usePublicRead, ReadFailure, ReadMissing } from './public-read';
import PublicArticleCard from '../editor/PublicArticleCard';
import PublicProjectCard from '../editor/PublicProjectCard';
import ProfileReport from './ProfileReport';
import { useViewer } from '../shell/viewer';
import { useUnsavedNavigation } from '../account/useUnsavedNavigation';
import { createPublicLikesClient } from '../editor/public-likes-client';
import type { PublicLikedArticles } from '../types';
import Icon from '../shared/Icon';
import ActivityGrass from './ActivityGrass';

export type StudentProfileView = 'articles' | 'projects' | 'likes';

type Person = {
  id: string;
  name: string;
  initials: string;
  department: string;
  year: string;
  bio?: string;
};

/**
 * A public author page laid out like the profile pages students already use (GitHub, Zenn):
 * the person on the left, their activity in tabs on the right. Nothing here is new UI to learn.
 */
function ProfileLayout({
  id,
  view,
  person,
  avatar,
  counts,
  children,
}: {
  id: string;
  view: StudentProfileView;
  person: Person;
  avatar: string | null;
  /** null: the person has no public articles or works, so only the likes tab exists. */
  counts: { articles: number; projects: number } | null;
  children: ReactNode;
}) {
  const { viewer } = useViewer();
  const reportRisk = useUnsavedNavigation(
    '未送信の通報、または結果を確認中の操作があります。画面を離れると手元の入力は失われます。移動しますか？',
  );
  // Display-only: the server independently refuses edits and reports that are not allowed.
  const own = viewer.status === 'signed-in' && viewer.profile?.id === person.id;
  const tabs = [
    ...(counts
      ? ([
          {
            view: 'articles',
            to: `/students/${id}`,
            label: '記事',
            icon: 'doc',
            count: counts.articles,
          },
          {
            view: 'projects',
            to: `/students/${id}/works`,
            label: '作品',
            icon: 'cube',
            count: counts.projects,
          },
        ] as const)
      : []),
    { view: 'likes', to: `/students/${id}/likes`, label: 'いいね', icon: 'heart', count: null },
  ] as const;
  return (
    <div className="shell student-profile">
      <aside className="profile-side" aria-label="投稿者">
        <div className="profile-vcard">
          <span className={'avatar profile-avatar' + (avatar ? ' has-image' : '')}>
            {avatar ? <img src={avatar} alt="" width={256} height={256} /> : person.initials}
          </span>
          <h1>{person.name}</h1>
        </div>
        {own && (
          <Link className="profile-edit-button" to="/account#profile" state={{ editProfile: true }}>
            プロフィールを編集
          </Link>
        )}
        {person.bio && <p className="profile-bio">{person.bio}</p>}
        {(person.department || person.year) && (
          <ul className="profile-details">
            {person.department && (
              <li>
                <Icon name="school" size={16} />
                <span>{person.department}</span>
              </li>
            )}
            {person.year && (
              <li>
                <Icon name="calendar" size={16} />
                <span>{person.year}</span>
              </li>
            )}
          </ul>
        )}
      </aside>
      {!own && (
        <div className="profile-report-slot">
          <ProfileReport
            key={person.id}
            profileId={person.id}
            onNavigationRiskChange={reportRisk}
          />
        </div>
      )}
      <div className="profile-main">
        {counts && <ActivityGrass id={person.id} />}
        <nav aria-label="投稿者の活動" className="profile-tabs">
          {tabs.map((tab) => (
            <Link key={tab.view} to={tab.to} aria-current={view === tab.view ? 'page' : undefined}>
              <Icon name={tab.icon} size={16} />
              {tab.label}
              {tab.count !== null && (
                <span className="profile-tab-count" aria-hidden="true">
                  {tab.count}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <h2 className="sr-only">
          {view === 'articles'
            ? '公開している記事'
            : view === 'projects'
              ? '公開している作品'
              : 'いいねした記事'}
        </h2>
        {children}
      </div>
    </div>
  );
}

function LikeList({ entries }: { entries: PublicLikedArticles['entries'] }) {
  return entries.length ? (
    <div className="author-lab-cards">
      {entries.map((entry) => (
        <PublicArticleCard key={entry.id} entry={entry} surface="ordinary" inTypedList />
      ))}
    </div>
  ) : (
    <p className="profile-empty">いいねした記事はまだありません。</p>
  );
}

/** The liked articles load only when their tab is open; the person column stays as it is. */
function LikedArticles({ id }: { id: string }) {
  const client = useMemo(() => createPublicLikesClient(fetch, 'ordinary'), []);
  const read = useMemo(() => (signal: AbortSignal) => client.read(id, signal), [client, id]);
  const { value, failed, retry } = usePublicRead<PublicLikedArticles>(id, read);
  if (failed) return <ReadFailure subject="いいねした記事" retry={retry} />;
  if (!value)
    return (
      <p role="status" className="profile-empty">
        読み込んでいます…
      </p>
    );
  return <LikeList entries={value.entries} />;
}

/**
 * A reader who only likes (no public articles or works) has no author page, but their likes are
 * public. Show the same layout from the likes read, with the likes tab alone.
 */
function LikerOnly({ id }: { id: string }) {
  const client = useMemo(() => createPublicLikesClient(fetch, 'ordinary'), []);
  const read = useMemo(() => (signal: AbortSignal) => client.read(id, signal), [client, id]);
  const { value, failed, missing, retry } = usePublicRead<PublicLikedArticles>(id, read);
  if (missing) return <ReadMissing subject="投稿者" />;
  if (failed) return <ReadFailure subject="投稿者" retry={retry} />;
  if (!value)
    return (
      <p role="status" className="shell empty">
        投稿者を読み込んでいます…
      </p>
    );
  return (
    <ProfileLayout id={id} view="likes" person={value.profile} avatar={null} counts={null}>
      <LikeList entries={value.entries} />
    </ProfileLayout>
  );
}

export default function StudentProfile({
  id,
  view = 'articles',
}: {
  id: string;
  view?: StudentProfileView;
}) {
  const client = useMemo(() => createPublicStudentClient(), []);
  const read = useMemo(() => (signal: AbortSignal) => client.read(id, signal), [client, id]);
  const { value, failed, missing, retry } = usePublicRead(id, read);
  if (missing) return view === 'likes' ? <LikerOnly id={id} /> : <ReadMissing subject="投稿者" />;
  if (failed) return <ReadFailure subject="投稿者" retry={retry} />;
  if (!value)
    return (
      <p role="status" className="shell empty">
        投稿者を読み込んでいます…
      </p>
    );
  const { author, avatar, entries, projects } = value;
  return (
    <ProfileLayout
      id={id}
      view={view}
      person={author}
      avatar={avatar}
      counts={{ articles: entries.length, projects: projects.length }}
    >
      {view === 'likes' ? (
        <LikedArticles id={id} />
      ) : view === 'articles' ? (
        entries.length ? (
          <div className="author-lab-cards">
            {entries.map((entry) => (
              <PublicArticleCard key={entry.id} entry={entry} surface="ordinary" inTypedList />
            ))}
          </div>
        ) : (
          <p className="profile-empty">公開している記事はまだありません。</p>
        )
      ) : projects.length ? (
        <div className="author-lab-cards">
          {projects.map((project) => (
            <PublicProjectCard key={project.id} project={project} surface="ordinary" inTypedList />
          ))}
        </div>
      ) : (
        <p className="profile-empty">公開している作品はまだありません。</p>
      )}
    </ProfileLayout>
  );
}
