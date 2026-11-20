import { useEffect, useMemo, useState } from 'react';
import { Button } from '@base-ui/react/button';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { usePublicRead, ReadFailure } from './public-read';
import { createOrdinaryDiscoveryClient } from './discovery-client';
import { createPublicWorksClient } from '../editor/public-works-client';
import PublicArticleCard from '../editor/PublicArticleCard';
import PublicProjectCard from '../editor/PublicProjectCard';
import { useViewer } from '../shell/viewer';
import './home.css';

type View = 'recent' | 'popular' | 'recommended';

function Hero() {
  const navigate = useNavigate();
  const { viewer } = useViewer();
  const [input, setInput] = useState('');
  const signedIn = viewer.status === 'signed-in';
  return (
    <section className="home-hero">
      <div className="shell home-hero-inner">
        <p className="home-eyebrow">神戸電子の学生がつくる、学びと制作の記録</p>
        <h1>
          少し先を行く誰かの経験が、
          <br />
          自分の<em>次の一歩</em>になる。
        </h1>
        <p className="home-lead">
          授業で気づいたこと、制作で試したこと、つくったもの。同じ学校の学生の記事と作品から、次にやってみることを見つけよう。
        </p>
        <form
          className="searchbox home-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            navigate(
              '/search' + (input.trim() ? '?' + new URLSearchParams({ q: input.trim() }) : ''),
            );
          }}
        >
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <label className="sr-only" htmlFor="community-search">
            記事・タグ・投稿者を検索
          </label>
          <input
            id="community-search"
            type="search"
            value={input}
            placeholder="キーワード、タグ、投稿者で探す"
            onChange={(event) => setInput(event.target.value)}
          />
          <Button type="submit">検索</Button>
        </form>
        <div className="home-hero-actions">
          {signedIn ? (
            <>
              <Link className="primary" to="/drafts">
                記事を書く
              </Link>
              <Link className="secondary" to="/works/new">
                作品を登録する
              </Link>
            </>
          ) : viewer.status === 'loading' ? null : (
            <>
              <Link className="primary" to="/signup">
                学校Googleで登録して書く
              </Link>
              <span className="home-hero-note">読むだけならログインは不要です</span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function LatestWorks() {
  const client = useMemo(() => createPublicWorksClient(fetch, 'ordinary'), []);
  const read = useMemo(() => (signal: AbortSignal) => client.read(signal), [client]);
  const { value } = usePublicRead('home-works', read);
  if (!value?.cards.length) return null;
  return (
    <section className="shell home-section" aria-labelledby="home-works-title">
      <div className="home-section-head">
        <h2 id="home-works-title">新しい作品</h2>
        <Link to="/works">すべての作品 →</Link>
      </div>
      <div className="card-grid">
        {value.cards.slice(0, 3).map(({ project, author }) => (
          <PublicProjectCard
            key={project.id}
            project={project}
            author={author}
            surface="ordinary"
          />
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  const client = useMemo(() => createOrdinaryDiscoveryClient(fetch), []);
  const read = useMemo(() => (signal: AbortSignal) => client.home(signal), [client]);
  const { value, failed, retry } = usePublicRead('feed', read);
  const { viewer } = useViewer();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const normalized = query.trim().normalize('NFKC').toLocaleLowerCase('ja');
  const [view, setView] = useState<View>('recent');
  const [selectedTag, setSelectedTag] = useState('');
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { entry } of value?.recent ?? [])
      for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
  }, [value]);
  const tag = tags.includes(selectedTag) ? selectedTag : (tags[0] ?? '');
  useEffect(() => {
    if (view === 'recommended' && !selectedTag && tags[0]) setSelectedTag(tags[0]);
  }, [view, selectedTag, tags]);
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
    <div className="home community-feed">
      <Hero />
      <section className="shell home-section" aria-labelledby="home-articles-title">
        <div className="home-section-head">
          <h2 id="home-articles-title">記事</h2>
          <div className="segmented discovery-views" aria-label="記事の並び方">
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
        </div>
        {view === 'recommended' && tags.length > 0 && (
          <div className="chip-row discovery-tags" aria-label="おすすめのタグ">
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
        )}
        {view === 'recommended' && value && tag && (
          <p className="home-view-note">
            「{tag}」の新着記事です。閲覧履歴はおすすめに使いません。
          </p>
        )}
        {view === 'popular' && value && (
          <p className="home-view-note">公開いいねが多い記事です。</p>
        )}
        {failed ? (
          <ReadFailure subject="記事一覧" retry={retry} />
        ) : !value ? (
          <div className="card-grid" role="status" aria-label="記事を読み込んでいます…">
            {[0, 1, 2].map((key) => (
              <div key={key} className="skeleton-card" />
            ))}
          </div>
        ) : !value.recent.length ? (
          <div className="empty home-empty">
            <h2>まだ記事がありません</h2>
            <p>最初の1本を書いてみませんか。短いメモでも、誰かのヒントになります。</p>
            <Link className="primary" to={viewer.status === 'signed-in' ? '/drafts' : '/signup'}>
              最初の記事を書く
            </Link>
          </div>
        ) : !cards?.length ? (
          <div className="empty home-empty">
            <h2>
              {view === 'popular' && !value.popular.length
                ? '公開いいねのある記事はまだありません'
                : view === 'recommended' && !tag
                  ? 'タグの付いた記事はまだありません'
                  : '一致する記事がありません'}
            </h2>
            {view === 'popular' && !value.popular.length && (
              <>
                <p>いいねが付くとここに並びます。今は新しく公開された記事から読めます。</p>
                <Button onClick={() => setView('recent')}>新着の記事を見る</Button>
              </>
            )}
            {query && <Button onClick={() => setParams({})}>検索を解除</Button>}
          </div>
        ) : (
          <div className="card-grid">
            {cards.map((card) => (
              <PublicArticleCard
                key={card.entry.id}
                entry={card.entry}
                author={card.author}
                surface="ordinary"
                badge={
                  view === 'popular' && 'likeCount' in card
                    ? `公開いいね ${String(card.likeCount)}件`
                    : undefined
                }
              />
            ))}
          </div>
        )}
        {view === 'recent' && tags.length > 0 && (
          <div className="home-topics">
            <h3>テーマから探す</h3>
            <div className="chip-row">
              {tags.slice(0, 12).map((value) => (
                <Link key={value} to={`/search?type=article&tag=${encodeURIComponent(value)}`}>
                  # {value}
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>
      <LatestWorks />
    </div>
  );
}
