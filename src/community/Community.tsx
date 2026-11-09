import { usePublicRead, ReadFailure } from './public-read';
import Projects from './Projects';
import Search from './Search';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Button } from '@base-ui/react/button';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import MarkdownRenderer from '../MarkdownRenderer';
import type { Entry, Profile, PublicLikedArticles } from '../types';
import { createOrdinaryDiscoveryClient } from './discovery-client';
import RelatedReading from './RelatedReading';
import './discovery.css';
import { createPublicationClient } from '../editor/publication-client';
import StudentProfile from './StudentProfile';
import PublicArticleCard from '../editor/PublicArticleCard';
import LikePanel from '../editor/LikePanel';
import OrdinaryArticleReport from './OrdinaryArticleReport';
import { createPublicLikesClient } from '../editor/public-likes-client';
import { useUnsavedNavigation } from '../account/useUnsavedNavigation';
import '../editor/public-author.css';

function ArticleFeed() {
  const navigate = useNavigate();
  const client = useMemo(() => createOrdinaryDiscoveryClient(fetch), []);
  const read = useMemo(() => (signal: AbortSignal) => client.home(signal), [client]);
  const { value, failed, retry } = usePublicRead('feed', read);
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const [input, setInput] = useState(query);
  useEffect(() => setInput(query), [query]);
  const normalized = query.trim().normalize('NFKC').toLocaleLowerCase('ja');
  const [view, setView] = useState<'recent' | 'popular' | 'recommended'>('recent');
  const [selectedTag, setSelectedTag] = useState('');
  const tags = [...new Set(value?.recent.flatMap(({ entry }) => entry.tags) ?? [])];
  const tag = tags.includes(selectedTag) ? selectedTag : (tags[0] ?? '');
  const sourceCards =
    view === 'popular'
      ? value?.popular
      : view === 'recommended'
        ? value?.recent.filter(({ entry }) => entry.tags.includes(tag))
        : value?.recent;
  const cards = sourceCards?.filter(
    ({ entry, author }) =>
      !normalized ||
      [entry.title, entry.summary, ...entry.tags, author.name].some((text) =>
        text.normalize('NFKC').toLocaleLowerCase('ja').includes(normalized),
      ),
  );
  return (
    <section className="shell community-feed">
      <p>
        <Link to="/works">学生の作品を探す</Link>
      </p>
      <div className="section-top">
        <div>
          <h1>学生の知識と経験</h1>
          <p>制作で試したこと、学んだこと、つくったもの。</p>
        </div>
        <Link className="primary" to="/drafts">
          記事を書く
        </Link>
      </div>
      <form
        className="searchbox"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          navigate(
            '/search' + (input.trim() ? '?' + new URLSearchParams({ q: input.trim() }) : ''),
          );
        }}
      >
        <label className="sr-only" htmlFor="community-search">
          記事・タグ・投稿者を検索
        </label>
        <input
          id="community-search"
          type="search"
          value={input}
          placeholder="記事、タグ、投稿者で探す"
          onChange={(event) => setInput(event.target.value)}
        />
        <Button type="submit">検索</Button>
      </form>
      <div className="discovery-views" aria-label="記事の並び方">
        {(
          [
            ['recent', '新着'],
            ['popular', '人気'],
            ['recommended', 'タグからおすすめ'],
          ] as const
        ).map(([key, label]) => (
          <Button key={key} aria-pressed={view === key} onClick={() => setView(key)}>
            {label}
          </Button>
        ))}
      </div>
      {view === 'recommended' && (
        <>
          <p>新着20件のタグから選べます。同じタグの記事を新しい公開順に表示します。</p>
          <div className="discovery-tags" aria-label="おすすめのタグ">
            {tags.map((value) => (
              <Button
                key={value}
                aria-pressed={tag === value}
                onClick={() => setSelectedTag(value)}
              >
                # {value}
              </Button>
            ))}
          </div>
        </>
      )}
      {failed ? (
        <ReadFailure subject="記事一覧" retry={retry} />
      ) : !value ? (
        <p role="status">記事を読み込んでいます…</p>
      ) : !value.recent.length ? (
        <div className="empty">
          <h2>まだ記事がありません</h2>
          <p>公開した記事がここに並びます。</p>
          <Link to="/drafts">最初の記事を書く</Link>
        </div>
      ) : !cards?.length ? (
        <div className="empty">
          <h2>
            {view === 'popular'
              ? '公開いいねのある記事はまだありません'
              : view === 'recommended' && !tag
                ? 'タグの付いた記事はまだありません'
                : '一致する記事がありません'}
          </h2>
          {query && <Button onClick={() => setParams({})}>検索を解除</Button>}
        </div>
      ) : (
        <>
          <p className="author-lab-limit">
            {view === 'popular'
              ? '有効なアカウントの公開いいね数が多い順に最大6件表示します。同数なら新しい公開順です。'
              : view === 'recommended'
                ? `「${tag}」の新着記事です。閲覧履歴はおすすめに使いません。`
                : '新しい公開記事を最大20件表示しています。'}
          </p>
          <div className="author-lab-cards">
            {cards.map((card) => (
              <div key={card.entry.id}>
                {view === 'popular' && 'likeCount' in card && (
                  <p className="discovery-like-count">公開いいね {String(card.likeCount)}件</p>
                )}
                <PublicArticleCard entry={card.entry} author={card.author} surface="ordinary" />
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function StudentArticle({ id }: { id: string }) {
  const reportRisk = useUnsavedNavigation(
    '未送信の通報、または結果を確認中の操作があります。画面を離れると手元の入力は失われます。送信済みの操作は取り消せません。移動しますか？',
  );
  const client = useMemo(() => createPublicationClient('', fetch, 'ordinary'), []);
  const read = useMemo(() => (_signal: AbortSignal) => client.readArticle(id), [client, id]);
  const { value, failed, retry } = usePublicRead<{ entry: Entry; author: Profile }>(id, read);
  if (failed) return <ReadFailure subject="記事" retry={retry} />;
  if (!value)
    return (
      <p role="status" className="shell empty">
        記事を読み込んでいます…
      </p>
    );
  const { entry, author } = value;
  return (
    <div className="shell detail-layout">
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
              {entry.updatedAt} 更新 · 約{entry.minutes}分
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
        {(entry.audience || entry.prerequisite || entry.outcome) && (
          <section className="reader-context" aria-label="読む前の目安">
            <h2>この記事について</h2>
            <dl>
              {(
                [
                  ['想定読者', entry.audience],
                  ['前提知識', entry.prerequisite],
                  ['読んだあとに', entry.outcome],
                ] as const
              )
                .filter(([, text]) => text)
                .map(([label, text]) => (
                  <Fragment key={label}>
                    <dt>{label}</dt>
                    <dd>{text}</dd>
                  </Fragment>
                ))}
            </dl>
          </section>
        )}
        <div className="prose">
          <MarkdownRenderer body={entry.body} />
        </div>
        <LikePanel key={`like-${entry.id}`} contentId={entry.id} surface="ordinary" />
        <OrdinaryArticleReport
          key={`report-${entry.id}`}
          contentId={entry.id}
          onNavigationRiskChange={reportRisk}
        />
        <RelatedReading key={`related-${entry.id}`} id={entry.id} />
      </article>
      <aside>
        <section className="side-box">
          <h2>書いた学生</h2>
          <Link to={`/students/${author.id}`}>{author.name}</Link>
          <p>{author.bio}</p>
        </section>
      </aside>
    </div>
  );
}

function PublicLikes({ id }: { id: string }) {
  const client = useMemo(() => createPublicLikesClient(fetch, 'ordinary'), []);
  const read = useMemo(() => (signal: AbortSignal) => client.read(id, signal), [client, id]);
  const { value, failed, retry } = usePublicRead<PublicLikedArticles>(id, read);
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
    <ArticleFeed />
  );
}
