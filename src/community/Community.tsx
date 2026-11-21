import { formatDate } from '../shared/display';
import { usePublicRead, ReadFailure, ReadMissing } from './public-read';
import Projects from './Projects';
import Search from './Search';
import Home from './Home';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Button } from '@base-ui/react/button';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import MarkdownRenderer from '../MarkdownRenderer';
import type { Entry, Profile, PublicLikedArticles } from '../types';
import { createOrdinaryDiscoveryClient } from './discovery-client';
import RelatedReading from './RelatedReading';
import { RecordReadingHistory } from '../history/RecordReadingHistory';
import './discovery.css';
import { createPublicationClient } from '../editor/publication-client';
import StudentProfile from './StudentProfile';
import PublicArticleCard from '../editor/PublicArticleCard';
import ArticleLikeButton from './ArticleLikeButton';
import OrdinaryArticleReport from './OrdinaryArticleReport';
import { createPublicLikesClient } from '../editor/public-likes-client';
import { useUnsavedNavigation } from '../account/useUnsavedNavigation';
import '../editor/public-author.css';
import './article.css';

function StudentArticle({ id }: { id: string }) {
  const reportRisk = useUnsavedNavigation(
    '未送信の通報、または結果を確認中の操作があります。画面を離れると手元の入力は失われます。送信済みの操作は取り消せません。移動しますか？',
  );
  const client = useMemo(() => createPublicationClient('', fetch, 'ordinary'), []);
  const read = useMemo(() => (_signal: AbortSignal) => client.readArticle(id), [client, id]);
  const { value, failed, missing, retry } = usePublicRead<{ entry: Entry; author: Profile }>(
    id,
    read,
  );
  if (missing) return <ReadMissing subject="記事" back={{ to: '/', label: '記事一覧へ戻る' }} />;
  if (failed) return <ReadFailure subject="記事" retry={retry} />;
  if (!value)
    return (
      <p role="status" className="shell empty">
        記事を読み込んでいます…
      </p>
    );
  const { entry, author } = value;
  const readerContextFields = [
    ['想定読者', entry.audience],
    ['前提知識', entry.prerequisite],
    ['読んだあとに', entry.outcome],
  ] as const;
  const readerContext = {
    filled: readerContextFields.filter(([, text]) => text),
    missing: readerContextFields.filter(([, text]) => !text).map(([label]) => label),
  };
  return (
    <div className="shell detail-layout">
      <RecordReadingHistory kind="article" contentId={entry.id} />
      <article>
        <Link className="back" to="/">
          ← 記事一覧へ
        </Link>
        <div className="detail-header">
          <h1>{entry.title}</h1>
          <p className="detail-summary">{entry.summary}</p>
          <div className="detail-author">
            <Link className="author" to={`/students/${author.id}`}>
              <span className="avatar">{author.initials}</span>
              <span>
                {author.name}
                <small>{[author.department, author.year].filter(Boolean).join(' · ')}</small>
              </span>
            </Link>
            <span>
              <time dateTime={entry.updatedAt}>{formatDate(entry.updatedAt)}</time> 更新 · 約
              {entry.minutes}分
            </span>
          </div>
          <div className="tags">
            {entry.tags.map((tag) => (
              <Link key={tag} to={`/search?type=article&tag=${encodeURIComponent(tag)}`}>
                # {tag}
              </Link>
            ))}
          </div>
        </div>
        <section className="reader-context" aria-label="読む前の目安">
          <h2>この記事について</h2>
          {readerContext.filled.length > 0 && (
            <dl>
              {readerContext.filled.map(([label, text]) => (
                <Fragment key={label}>
                  <dt>{label}</dt>
                  <dd>{text}</dd>
                </Fragment>
              ))}
            </dl>
          )}
          {readerContext.missing.length > 0 && (
            // #172: empty optional fields share one short line instead of a row each,
            // so the reader still sees what is missing without pushing the body down.
            <p className="reader-context-missing">{readerContext.missing.join('・')}：記載なし</p>
          )}
        </section>
        <div className="prose">
          <MarkdownRenderer body={entry.body} />
        </div>
        <div className="article-end">
          <ArticleLikeButton key={`like-${entry.id}`} contentId={entry.id} />
          <Link className="article-end-author" to={`/students/${author.id}`}>
            <span className="mini-avatar" aria-hidden="true">
              {author.initials}
            </span>
            <span>
              <small>この記事を書いた人</small>
              {author.name}
            </span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>
        <OrdinaryArticleReport
          key={`report-${entry.id}`}
          contentId={entry.id}
          onNavigationRiskChange={reportRisk}
        />
        <RelatedReading key={`related-${entry.id}`} id={entry.id} />
      </article>
      <aside>
        <section className="side-box author-side">
          <h2>書いた学生</h2>
          <Link className="author-side-name" to={`/students/${author.id}`}>
            <span className="mini-avatar" aria-hidden="true">
              {author.initials}
            </span>
            <span>
              {author.name}
              <small>{[author.department, author.year].filter(Boolean).join(' · ')}</small>
            </span>
          </Link>
          {author.bio && <p>{author.bio}</p>}
          <Link className="author-side-more" to={`/students/${author.id}`}>
            ほかの記事・作品を見る →
          </Link>
        </section>
      </aside>
    </div>
  );
}

function PublicLikes({ id }: { id: string }) {
  const client = useMemo(() => createPublicLikesClient(fetch, 'ordinary'), []);
  const read = useMemo(() => (signal: AbortSignal) => client.read(id, signal), [client, id]);
  const { value, failed, missing, retry } = usePublicRead<PublicLikedArticles>(id, read);
  if (missing) return <ReadMissing subject="公開いいね" />;
  if (failed) return <ReadFailure subject="公開いいね" retry={retry} />;
  if (!value)
    return (
      <p role="status" className="shell empty">
        公開いいねを読み込んでいます…
      </p>
    );
  return (
    <section className="shell profile-page">
      <Link className="back" to={`/students/${id}`}>
        ← 投稿者へ
      </Link>
      <h1>{value.profile.name}の公開いいね</h1>
      <p>新しい公開いいねを最大20件表示しています。</p>
      {value.entries.length ? (
        <div className="author-lab-cards">
          {value.entries.map((entry) => (
            <PublicArticleCard key={entry.id} entry={entry} surface="ordinary" />
          ))}
        </div>
      ) : (
        <p>公開いいねはまだありません。</p>
      )}
    </section>
  );
}

export default function Community() {
  const { pathname } = useLocation();
  const [kind, id, section] = pathname.split('/').slice(1);
  if (kind === 'search') return <Search />;
  if (kind === 'projects' || kind === 'works') return <Projects />;
  return kind === 'articles' && id ? (
    <StudentArticle key={id} id={id} />
  ) : kind === 'students' && id && section === 'likes' ? (
    <PublicLikes key={id} id={id} />
  ) : kind === 'students' && id ? (
    <StudentProfile
      key={`${id}-${section ?? 'articles'}`}
      id={id}
      view={section === 'works' ? 'projects' : 'articles'}
    />
  ) : (
    <Home />
  );
}
