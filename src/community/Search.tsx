import { useEffect, useMemo, useState } from 'react';
import { Button } from '@base-ui/react/button';
import { Link, useSearchParams } from 'react-router-dom';
import { createPublicDiscoveryClient } from '../editor/public-discovery-client';
import { createPublicWorksClient } from '../editor/public-works-client';
import PublicArticleCard from '../editor/PublicArticleCard';
import PublicProjectCard from '../editor/PublicProjectCard';
import Icon from '../shared/Icon';
import { usePublicRead } from './public-read';
import './search.css';
import EmptySprout from '../shared/EmptySprout';
import LoadingSkeleton from '../shared/LoadingSkeleton';

const normalized = (text: string) => text.normalize('NFKC').toLocaleLowerCase('ja');
const matches = (query: string, texts: string[]) =>
  !query || texts.some((text) => normalized(text).includes(query));

/** Say a failed read once, where its results would have been, with one way to try again. */
function FailedResults({ subject, retry }: { subject: string; retry: () => void }) {
  return (
    <section className="search-read-failure" role="alert">
      <p>{subject}を読み込めませんでした。</p>
      <Button onClick={retry}>もう一度読み込む</Button>
    </section>
  );
}

export default function Search() {
  const articles = useMemo(() => createPublicDiscoveryClient(fetch, 'ordinary'), []);
  const works = useMemo(() => createPublicWorksClient(fetch, 'ordinary'), []);
  const readArticles = useMemo(() => (signal: AbortSignal) => articles.read(signal), [articles]);
  const readWorks = useMemo(() => (signal: AbortSignal) => works.read(signal), [works]);
  const articleRead = usePublicRead('search-articles', readArticles);
  const projectRead = usePublicRead('search-projects', readWorks);
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const type = ['article', 'project'].includes(params.get('type') ?? '')
    ? params.get('type')!
    : 'all';
  const tag = params.get('tag') ?? '';
  const [input, setInput] = useState(query);
  useEffect(() => setInput(query), [query]);
  const update = (key: string, value: string) => {
    // The URL can advance before a router transition has rendered its new controls.
    const next = new URLSearchParams(window.location.search);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { flushSync: true });
  };
  const q = normalized(query.trim());
  const articleCards = (articleRead.value?.cards ?? []).filter(
    ({ entry, author }) =>
      (!tag || entry.tags.some((value) => normalized(value) === normalized(tag))) &&
      matches(q, [entry.title, entry.summary, ...entry.tags, author.name]),
  );
  const projectCards = (projectRead.value?.cards ?? []).filter(({ project, author }) =>
    matches(q, [project.title, project.descriptionPreview, author.name]),
  );
  const hasCondition = Boolean(query || tag || type !== 'all');
  // Count article tags once: the chip row and the "other words" suggestions both rank by frequency.
  const tagCounts = new Map<string, number>();
  for (const { entry } of articleRead.value?.cards ?? [])
    for (const value of new Set(entry.tags)) tagCounts.set(value, (tagCounts.get(value) ?? 0) + 1);
  const rankedTags = [...tagCounts]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b, 'ja'))
    .map(([value]) => value);
  const isTag = (value: string) => Boolean(tag) && normalized(value) === normalized(tag);
  // The selected tag leads the row even when no loaded article carries it any more.
  const chips = type === 'project' ? [] : rankedTags.filter((value) => !isTag(value));
  // Offer frequent article tags as other words to try; the current tag is the one that failed.
  const suggestions = rankedTags.filter((value) => !isTag(value)).slice(0, 5);
  const showArticles = type !== 'project';
  const showProjects = type !== 'article' && !tag;
  // A failed read is said once in its own alert, so the count line only reports what loaded.
  const status = [
    ...(showArticles && !articleRead.failed
      ? [articleRead.value ? `記事 ${articleCards.length}件` : '記事：読み込み中']
      : []),
    ...(showProjects && !projectRead.failed
      ? [projectRead.value ? `作品 ${projectCards.length}件` : '作品：読み込み中']
      : []),
  ];
  const articlesFailed = showArticles && articleRead.failed;
  const projectsFailed = showProjects && projectRead.failed;
  // When every shown list failed, one message and one retry cover them all.
  const allFailed = (articlesFailed || projectsFailed) && !status.length;
  // The public APIs return at most 20 cards; say so only once a list is actually cut off.
  const atLimit =
    (showArticles && articleRead.value?.cards.length === 20) ||
    (showProjects && projectRead.value?.cards.length === 20);
  const complete =
    (!showArticles || articleRead.value !== null) && (!showProjects || projectRead.value !== null);
  const empty =
    complete && (!showArticles || !articleCards.length) && (!showProjects || !projectCards.length);

  return (
    <section className="shell community-search">
      <div className="community-search-heading">
        <h1>記事・作品を探す</h1>
      </div>
      <form
        className="searchbox"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          update('q', input.trim());
        }}
      >
        <label className="sr-only" htmlFor="ordinary-search">
          記事・作品・投稿者名を検索
        </label>
        <input
          id="ordinary-search"
          type="search"
          value={input}
          maxLength={200}
          placeholder="記事、作品、投稿者名で探す"
          onChange={(event) => setInput(event.target.value)}
        />
        <Button type="submit">検索</Button>
      </form>
      <div className="community-search-filters">
        <fieldset>
          <legend className="sr-only">種類</legend>
          <div className="search-types">
            {(
              [
                ['all', 'すべて'],
                ['article', '記事'],
                ['project', '作品'],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                aria-pressed={type === value}
                onClick={() => update('type', value === 'all' ? '' : value)}
              >
                {label}
              </Button>
            ))}
          </div>
        </fieldset>
      </div>
      {(tag || chips.length > 0) && (
        <div className="search-tag-chips" role="group" aria-label="記事のタグ">
          {tag && (
            <Button
              className="search-tag-chip"
              aria-label={`タグ「# ${tag}」を解除`}
              title={`タグ「# ${tag}」を解除`}
              onClick={() => update('tag', '')}
            >
              # {tag}
              <Icon name="close" size={16} />
            </Button>
          )}
          {chips.map((value) => (
            <Button key={value} onClick={() => update('tag', value)}>
              # {value}
            </Button>
          ))}
        </div>
      )}
      <p className="search-result-count" role="status" aria-live="polite">
        {status.join(' · ') ||
          (showArticles || showProjects ? '' : 'タグを解除すると作品を検索できます。')}
      </p>
      {empty ? (
        <div className="empty search-empty">
          {hasCondition ? (
            <>
              <h2>一致する記事・作品はありません</h2>
              <div className="search-empty-actions">
                {query && (
                  <Button onClick={() => update('q', '')}>キーワード「{query}」を外す</Button>
                )}
                {tag && <Button onClick={() => update('tag', '')}>タグ「# {tag}」を外す</Button>}
                {type !== 'all' && (
                  <Button onClick={() => update('type', '')}>種類を「すべて」にする</Button>
                )}
                {[query, tag, type !== 'all'].filter(Boolean).length > 1 && (
                  <Button onClick={() => setParams({}, { flushSync: true })}>検索条件を解除</Button>
                )}
              </div>
              {suggestions.length > 0 && (
                <nav className="search-suggestions" aria-label="ほかの言葉で探す">
                  <span>ほかの言葉で探す</span>
                  {suggestions.map((value) => (
                    <Link key={value} to={`/search?tag=${encodeURIComponent(value)}`}>
                      # {value}
                    </Link>
                  ))}
                </nav>
              )}
            </>
          ) : (
            <>
              <EmptySprout />
              <h2>公開中の記事・作品はまだありません</h2>
              <p>記事や作品が公開されると、ここから探せるようになります。</p>
            </>
          )}
        </div>
      ) : allFailed ? (
        <FailedResults
          subject={
            articlesFailed && projectsFailed ? '記事・作品' : articlesFailed ? '記事' : '作品'
          }
          retry={() => {
            if (articlesFailed) articleRead.retry();
            if (projectsFailed) projectRead.retry();
          }}
        />
      ) : (
        <div className="search-result-groups">
          {showArticles &&
            (articleRead.failed ? (
              <FailedResults subject="記事" retry={articleRead.retry} />
            ) : articleRead.value && articleCards.length > 0 ? (
              <section aria-label="記事の検索結果">
                <h2>記事</h2>
                <div className="author-lab-cards">
                  {articleCards.map(({ entry, author }) => (
                    <PublicArticleCard
                      key={entry.id}
                      entry={entry}
                      author={author}
                      surface="ordinary"
                    />
                  ))}
                </div>
              </section>
            ) : null)}
          {showProjects &&
            (projectRead.failed ? (
              <FailedResults subject="作品" retry={projectRead.retry} />
            ) : projectRead.value && projectCards.length > 0 ? (
              <section aria-label="作品の検索結果" className="search-project-results">
                <h2>作品</h2>
                <div className="author-lab-cards">
                  {projectCards.map(({ project, author }) => (
                    <PublicProjectCard
                      key={project.id}
                      project={project}
                      author={author}
                      surface="ordinary"
                    />
                  ))}
                </div>
              </section>
            ) : null)}
          {/* The count line above already says what is still loading, so this stays silent. */}
          {!complete && <LoadingSkeleton shape="cards" label="" announce={false} />}
        </div>
      )}
      {atLimit && (
        <p className="search-limit">新しい公開記事・作品それぞれ20件までが検索対象です。</p>
      )}
    </section>
  );
}
