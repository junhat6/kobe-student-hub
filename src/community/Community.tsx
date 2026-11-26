import { usePublicRead, ReadFailure, ReadMissing } from './public-read';
import Projects from './Projects';
import Search from './Search';
import Home from './Home';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Button } from '@base-ui/react/button';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import MarkdownRenderer from '../MarkdownRenderer';
import type { Entry, Profile, PublishedArticleDetail } from '../types';
import { createOrdinaryDiscoveryClient } from './discovery-client';
import RelatedReading from './RelatedReading';
import AuthorCard from './AuthorCard';
import { RecordReadingHistory } from '../history/RecordReadingHistory';
import './discovery.css';
import { createPublicationClient } from '../editor/publication-client';
import StudentProfile from './StudentProfile';
import PublicArticleCard from '../editor/PublicArticleCard';
import ArticleLikeButton from './ArticleLikeButton';
import ArticleShare from './ArticleShare';
import OrdinaryArticleReport from './OrdinaryArticleReport';
import ArticleHandoff from '../agent/ArticleHandoff';
import EditorialReview from './EditorialReview';
import { useUnsavedNavigation } from '../account/useUnsavedNavigation';
import '../editor/public-author.css';
import './article.css';
import { AuthorAvatar } from '../shared/public-avatars';
import LoadingSkeleton from '../shared/LoadingSkeleton';
import { PublicTime } from '../shared/PublicTime';

/**
 * A first publication reads 「公開」; only a later revision adds 「更新」, so readers can tell a new
 * article from a rewritten one. Each part stays on one line on narrow screens.
 */
function ArticleDates({
  updatedAt,
  publishedAt,
  publication,
  minutes,
}: {
  updatedAt: string;
  publishedAt?: string;
  publication?: PublishedArticleDetail['publication'];
  minutes: number;
}) {
  const parts = publication
    ? [
        <>
          <PublicTime day={publication.publishedOn} at={publication.publishedAt} /> 公開
        </>,
        ...(publication.revised
          ? [
              <>
                <PublicTime day={updatedAt} at={publishedAt} /> 更新
              </>,
            ]
          : []),
      ]
    : [
        <>
          <PublicTime day={updatedAt} at={publishedAt} /> 更新
        </>,
      ];
  return (
    <span className="detail-dates">
      {[...parts, <>約{minutes}分</>].map((part, index) => (
        <Fragment key={index}>
          {index > 0 && ' · '}
          <span className="nowrap">{part}</span>
        </Fragment>
      ))}
    </span>
  );
}

function StudentArticle({ id }: { id: string }) {
  const reportRisk = useUnsavedNavigation(
    '未送信の通報、または結果を確認中の操作があります。画面を離れると手元の入力は失われます。送信済みの操作は取り消せません。移動しますか？',
  );
  const client = useMemo(() => createPublicationClient('', fetch, 'ordinary'), []);
  const read = useMemo(() => (_signal: AbortSignal) => client.readArticle(id), [client, id]);
  const { value, failed, missing, retry } = usePublicRead<PublishedArticleDetail>(id, read);
  if (missing) return <ReadMissing subject="記事" back={{ to: '/', label: '記事一覧へ戻る' }} />;
  if (failed) return <ReadFailure subject="記事" retry={retry} />;
  if (!value)
    return <LoadingSkeleton shape="detail" label="記事を読み込んでいます…" className="shell" />;
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
            <ArticleDates
              updatedAt={entry.updatedAt}
              publishedAt={entry.publishedAt}
              publication={value.publication}
              minutes={entry.minutes}
            />
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
        <ArticleHandoff
          key={`handoff-${entry.id}`}
          title={entry.title}
          summary={entry.summary}
          tags={entry.tags}
          audience={entry.audience}
          prerequisite={entry.prerequisite}
          outcome={entry.outcome}
          body={entry.body}
          authorName={author.name}
        />
        <div className="article-end">
          <ArticleLikeButton
            key={`like-${entry.id}`}
            contentId={entry.id}
            actions={
              <>
                <ArticleShare id={entry.id} title={entry.title} />
                <OrdinaryArticleReport
                  key={`report-${entry.id}`}
                  contentId={entry.id}
                  onNavigationRiskChange={reportRisk}
                />
              </>
            }
          />
        </div>
        <EditorialReview key={`editorial-${entry.id}`} contentId={entry.id} />
        <RelatedReading key={`related-${entry.id}`} id={entry.id} />
      </article>
      <aside>
        <AuthorCard
          author={author}
          heading="書いた学生"
          current={{ kind: 'article', id: entry.id }}
          profilePath={`/students/${author.id}`}
        />
      </aside>
    </div>
  );
}

export default function Community() {
  const { pathname } = useLocation();
  const [kind, id, section] = pathname.split('/').slice(1);
  if (kind === 'search') return <Search />;
  if (kind === 'projects' || kind === 'works') return <Projects />;
  return kind === 'articles' && id ? (
    <StudentArticle key={id} id={id} />
  ) : kind === 'students' && id ? (
    <StudentProfile
      key={id}
      id={id}
      view={section === 'works' ? 'projects' : section === 'likes' ? 'likes' : 'articles'}
    />
  ) : (
    <Home />
  );
}
