import { Fragment, useEffect, useMemo, useState } from 'react';
import { Button } from '@base-ui/react/button';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import MarkdownRenderer from '../MarkdownRenderer';
import type {
  Entry,
  Profile,
  PublicAuthorArticles,
  PublicDiscovery,
  PublicLikedArticles,
} from '../types';
import { createPublicDiscoveryClient } from '../editor/public-discovery-client';
import { createPublicationClient } from '../editor/publication-client';
import { createPublicAuthorClient } from '../editor/public-author-client';
import PublicArticleCard from '../editor/PublicArticleCard';
import LikePanel from '../editor/LikePanel';
import OrdinaryArticleReport from './OrdinaryArticleReport';
import { createPublicLikesClient } from '../editor/public-likes-client';
import { useUnsavedNavigation } from '../account/useUnsavedNavigation';
import '../editor/public-author.css';

/** Anonymous reading never creates an account or sends session credentials. */
function usePublicRead<T>(key: string, read: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<{ key: string; value: T | null; failed: boolean }>({
    key,
    value: null,
    failed: false,
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ key, value: null, failed: false });
    read(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setState({ key, value, failed: false });
      },
      () => {
        if (!controller.signal.aborted) setState({ key, value: null, failed: true });
      },
    );
    return () => controller.abort();
  }, [key, read, attempt]);
  return {
    value: state.key === key ? state.value : null,
    failed: state.key === key && state.failed,
    retry: () => setAttempt((value) => value + 1),
  };
}

function ReadFailure({ subject, retry }: { subject: string; retry: () => void }) {
  return (
    <section className="empty" role="alert">
      <h1>{subject}を表示できませんでした</h1>
      <p>接続を確認して、もう一度お試しください。非公開の記事は表示されません。</p>
      <Button className="primary" onClick={retry}>
        もう一度読み込む
      </Button>
    </section>
  );
}

function ArticleFeed() {
  const client = useMemo(() => createPublicDiscoveryClient(fetch, 'ordinary'), []);
  const read = useMemo(() => (signal: AbortSignal) => client.read(signal), [client]);
  const { value, failed, retry } = usePublicRead<PublicDiscovery>('feed', read);
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const [input, setInput] = useState(query);
  useEffect(() => setInput(query), [query]);
  const normalized = query.trim().normalize('NFKC').toLocaleLowerCase('ja');
  const cards = value?.cards.filter(
    ({ entry, author }) =>
      !normalized ||
      [entry.title, entry.summary, ...entry.tags, author.name].some((text) =>
        text.normalize('NFKC').toLocaleLowerCase('ja').includes(normalized),
      ),
  );
  return (
    <section className="shell community-feed">
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
          setParams(input.trim() ? { q: input.trim() } : {});
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
      {failed ? (
        <ReadFailure subject="記事一覧" retry={retry} />
      ) : !value ? (
        <p role="status">記事を読み込んでいます…</p>
      ) : !value.cards.length ? (
        <div className="empty">
          <h2>まだ記事がありません</h2>
          <p>公開した記事がここに並びます。</p>
          <Link to="/drafts">最初の記事を書く</Link>
        </div>
      ) : !cards?.length ? (
        <div className="empty">
          <h2>一致する記事がありません</h2>
          <Button onClick={() => setParams({})}>検索を解除</Button>
        </div>
      ) : (
        <>
          <p className="author-lab-limit">
            新しい公開記事を最大20件表示しています。検索はこの一覧が対象です。
          </p>
          <div className="author-lab-cards">
            {cards.map((card) => (
              <PublicArticleCard
                key={card.entry.id}
                entry={card.entry}
                author={card.author}
                surface="ordinary"
              />
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
              <Link key={tag} to={`/?q=${encodeURIComponent(tag)}`}>
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

function StudentProfile({ id }: { id: string }) {
  const client = useMemo(() => createPublicAuthorClient(fetch, 'ordinary'), []);
  const read = useMemo(() => (signal: AbortSignal) => client.read(id, signal), [client, id]);
  const { value, failed, retry } = usePublicRead<PublicAuthorArticles>(id, read);
  if (failed) return <ReadFailure subject="投稿者" retry={retry} />;
  if (!value)
    return (
      <p role="status" className="shell empty">
        投稿者を読み込んでいます…
      </p>
    );
  const { author, entries } = value;
  return (
    <section className="shell profile-page">
      <Link className="back" to="/">
        ← 記事一覧へ
      </Link>
      <div className="profile-header">
        <span className="avatar large">{author.initials}</span>
        <div>
          <h1>{author.name}</h1>
          <p>{[author.department, author.year].filter(Boolean).join(' · ')}</p>
          <p>{author.bio}</p>
        </div>
      </div>
      <p>
        <Link to={`/students/${id}/likes`}>公開いいねを見る</Link>
      </p>
      <h2>公開している記事</h2>
      <p>新しい公開記事を最大20件表示しています。</p>
      <div className="author-lab-cards">
        {entries.map((entry) => (
          <PublicArticleCard key={entry.id} entry={entry} surface="ordinary" />
        ))}
      </div>
    </section>
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
  return kind === 'articles' && id ? (
    <StudentArticle key={id} id={id} />
  ) : kind === 'students' && id && section === 'likes' ? (
    <PublicLikes key={id} id={id} />
  ) : kind === 'students' && id ? (
    <StudentProfile key={id} id={id} />
  ) : (
    <ArticleFeed />
  );
}
