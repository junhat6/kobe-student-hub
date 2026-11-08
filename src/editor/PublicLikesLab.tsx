import { useEffect, useMemo, useState } from 'react';
import { Button } from '@base-ui/react/button';
import type { PublicLikedArticles } from '../types';
import { createPublicLikesClient } from './public-likes-client';
import PublicArticleCard from './PublicArticleCard';
import './public-author.css';
import './likes.css';
export default function PublicLikesLab({ profileId }: { profileId: string }) {
  const client = useMemo(() => createPublicLikesClient(), []);
  const [state, setState] = useState<{
    id: string;
    value: PublicLikedArticles | null;
    failed: boolean;
  }>({ id: profileId, value: null, failed: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ id: profileId, value: null, failed: false });
    client
      .read(profileId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setState({ id: profileId, value, failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ id: profileId, value: null, failed: true });
      });
    return () => controller.abort();
  }, [client, profileId, attempt]);
  const value = state.id === profileId ? state.value : null;
  const failed = state.id === profileId && state.failed;
  return (
    <div className="author-lab">
      <header>
        <span>Kobe Student Hub</span>
        <strong>ローカルの公開いいね</strong>
      </header>
      <p className="author-lab-notice">
        架空データによるローカル検証です。実際の学校ログインや一般投稿は利用できません。
      </p>
      <main>
        <nav className="public-feed-nav">
          <a href="/lab/discover">新しい公開記事を探す</a>
        </nav>
        {failed ? (
          <section className="author-lab-unavailable">
            <h1>公開いいねを表示できません</h1>
            <p>公開状態や接続を確認できません。いいねがないとは判断できません。</p>
            <Button onClick={() => setAttempt((v) => v + 1)}>もう一度確認</Button>
          </section>
        ) : !value ? (
          <p role="status">公開いいねを読み込んでいます…</p>
        ) : (
          <>
            <h1>{value.profile.name}の公開いいね</h1>
            <p className="author-lab-meta">
              {[value.profile.department, value.profile.year].filter(Boolean).join(' · ')}
            </p>
            <p className="author-lab-limit">
              この人がいいねした公開中の記事を、新しくいいねした順に最大20件表示します。読んだ履歴やおすすめ順位ではありません。
            </p>
            {value.entries.length ? (
              <section aria-label="公開いいねの記事">
                <div className="author-lab-cards">
                  {value.entries.map((entry) => (
                    <PublicArticleCard key={entry.id} entry={entry} />
                  ))}
                </div>
              </section>
            ) : (
              <section className="author-lab-unavailable">
                <h2>表示できる公開いいねはありません</h2>
                <p>公開中の対象記事がない状態です。</p>
              </section>
            )}
          </>
        )}
      </main>
      <footer>ローカル専用 · 学生による価値検証は未実施です。</footer>
    </div>
  );
}
