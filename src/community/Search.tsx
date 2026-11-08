import { useEffect, useMemo, useState } from 'react';
import { Button } from '@base-ui/react/button';
import { useSearchParams } from 'react-router-dom';
import { createPublicDiscoveryClient } from '../editor/public-discovery-client';
import { createPublicWorksClient } from '../editor/public-works-client';
import PublicArticleCard from '../editor/PublicArticleCard';
import PublicProjectCard from '../editor/PublicProjectCard';
import { usePublicRead } from './public-read';
import './search.css';

const normalized = (text: string) => text.normalize('NFKC').toLocaleLowerCase('ja');
const matches = (query: string, texts: string[]) =>
  !query || texts.some((text) => normalized(text).includes(query));

function FailedResults({ kind, retry }: { kind: string; retry: () => void }) {
  return (
    <section className="search-read-failure" role="alert">
      <h2>{kind}の検索結果を確認できません</h2>
      <p>一覧の取得に失敗しました。もう一度読み込んでください。</p>
      <Button onClick={retry}>{kind}を再読み込み</Button>
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
  const tags = [
    ...new Set([
      ...(articleRead.value?.cards.flatMap(({ entry }) => entry.tags) ?? []),
      ...(tag ? [tag] : []),
    ]),
  ].sort((a, b) => a.localeCompare(b, 'ja'));
  const showArticles = type !== 'project';
  const showProjects = type !== 'article' && !tag;
  const status = [
    ...(showArticles
      ? [
          articleRead.failed
            ? '記事：取得失敗'
            : !articleRead.value
              ? '記事：読み込み中'
              : `記事 ${articleCards.length}件`,
        ]
      : []),
    ...(showProjects
      ? [
          projectRead.failed
            ? '作品：取得失敗'
            : !projectRead.value
              ? '作品：読み込み中'
              : `作品 ${projectCards.length}件`,
        ]
      : []),
  ];
  const complete =
    (!showArticles || articleRead.value !== null) && (!showProjects || projectRead.value !== null);
  const empty =
    complete && (!showArticles || !articleCards.length) && (!showProjects || !projectCards.length);

  return (
    <section className="shell community-search">
      <div className="community-search-heading">
        <h1>記事・作品を探す</h1>
        <p>気になる言葉や投稿者名から、学生の知識と制作を探せます。</p>
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
          <legend>種類</legend>
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
        <label className="search-tag" htmlFor="ordinary-search-tag">
          タグ（記事）
          <select
            id="ordinary-search-tag"
            value={tag}
            onChange={(event) => update('tag', event.target.value)}
          >
            <option value="">すべてのタグ</option>
            {tags.map((value) => (
              <option key={value} value={value}>
                # {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      {tag && (
        <p className="search-tag-note">
          タグは記事が対象です。<Button onClick={() => update('tag', '')}>タグを解除</Button>
        </p>
      )}
      <p className="search-limit">
        新しい公開記事・作品それぞれ最大20件のタイトル・紹介・記事タグ・投稿者名が検索対象です。
      </p>
      <p className="search-result-count" role="status" aria-live="polite">
        {status.join(' · ') || 'タグを解除すると作品を検索できます。'}
      </p>
      {empty ? (
        <div className="empty">
          <h2>一致する記事・作品はありません</h2>
          <p>キーワードや絞り込みを変えて探してみてください。</p>
          <Button onClick={() => setParams({}, { flushSync: true })}>検索条件を解除</Button>
        </div>
      ) : (
        <div className="search-result-groups">
          {showArticles &&
            (articleRead.failed ? (
              <FailedResults kind="記事" retry={articleRead.retry} />
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
              <FailedResults kind="作品" retry={projectRead.retry} />
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
        </div>
      )}
    </section>
  );
}
