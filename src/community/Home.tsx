import { useEffect, useMemo, useState } from 'react';
import { Button } from '@base-ui/react/button';
import { Link, useSearchParams } from 'react-router-dom';
import { usePublicRead, ReadFailure } from './public-read';
import { createOrdinaryDiscoveryClient } from './discovery-client';
import { createPublicWorksClient } from '../editor/public-works-client';
import PublicArticleCard from '../editor/PublicArticleCard';
import PublicProjectCard from '../editor/PublicProjectCard';
import { useViewer } from '../shell/viewer';
import { AREA_ENTRANCE, areaEntranceCount, areaEntrancePath } from './area-entrance';
import './home.css';
import EmptySprout from '../shared/EmptySprout';
import LoadingSkeleton from '../shared/LoadingSkeleton';

type View = 'recent' | 'popular' | 'recommended';

/**
 * The top no longer opens with a hero (#309): a signed-in reader goes straight to the cards and
 * uses the header's 探す and 書く. A signed-out visitor still gets one line saying what this place
 * is and the way to join, so a first visit is not left guessing.
 */
function SignedOutBand() {
  return (
    <section className="home-band" aria-label="Kobe Student Hub について">
      <div className="shell home-band-inner">
        <p className="home-band-text">
          神戸電子の学生が、学びと制作の経験を記事と作品で共有する場所です。
        </p>
        <Link className="primary home-band-action" to="/signup">
          学校Googleで登録して書く
        </Link>
      </div>
    </section>
  );
}

function AreaEntrance({ count }: { count: number }) {
  if (count < AREA_ENTRANCE.minimum) return null;
  return (
    <section className="shell home-area" aria-labelledby="home-area-title">
      <Link className="home-area-link" to={areaEntrancePath}>
        <span className="home-area-text">
          <span id="home-area-title" className="home-area-title">
            {AREA_ENTRANCE.title}
          </span>
          <span className="home-area-description">{AREA_ENTRANCE.description}</span>
        </span>
        <span className="home-area-count">{count}件 →</span>
      </Link>
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
  const { viewer, session } = useViewer();
  // Nothing above the cards changes once shown: until the first session answer arrives the cards
  // wait as a skeleton, so the band never appears and then vanishes, nor pushes shown cards down.
  const settled = session !== null || viewer.status === 'unknown';
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
      <h1 className="sr-only">Kobe Student Hub</h1>
      {session === 'absent' && <SignedOutBand />}
      {value && settled && <AreaEntrance count={areaEntranceCount(value.recent)} />}
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
        {failed ? (
          <ReadFailure subject="記事一覧" retry={retry} />
        ) : !value || !settled ? (
          <LoadingSkeleton shape="cards" label="記事を読み込んでいます…" />
        ) : !value.recent.length ? (
          <div className="empty home-empty">
            <EmptySprout />
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
                likeCount={
                  view === 'popular' && 'likeCount' in card ? Number(card.likeCount) : undefined
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
