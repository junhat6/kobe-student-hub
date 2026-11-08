import PublicProjectCard from './PublicProjectCard';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@base-ui/react/button';
import type { PublicAuthorProjects } from '../project-types';
import { createPublicProjectClient } from './public-project-client';
import './project.css';
export default function ProjectAuthorLab({ profileId }: { profileId: string }) {
  const client = useMemo(() => createPublicProjectClient(), []);
  const [state, setState] = useState<{
      id: string;
      value: PublicAuthorProjects | null;
      failed: boolean;
    }>({ id: profileId, value: null, failed: false }),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ id: profileId, value: null, failed: false });
    client
      .author(profileId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setState({ id: profileId, value, failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ id: profileId, value: null, failed: true });
      });
    return () => controller.abort();
  }, [client, profileId, attempt]);
  const value = state.id === profileId ? state.value : null,
    failed = state.id === profileId && state.failed;
  return (
    <div className="project-public">
      <header>Kobe Student Hub · ローカル公開作品</header>
      <main>
        <nav className="project-public-nav" aria-label="公開内容のナビゲーション">
          <a href="/lab/discover">公開記事を探す</a>
          <a href="/lab/works">公開作品を探す</a>
        </nav>
        <p className="project-local">
          架空の画像なし作品の検証です。通報の受付・内容の読取確認はローカルで試せますが、実際の運営判断・一般投稿は利用できません。
        </p>
        {failed ? (
          <section>
            <h1>この投稿者の作品を表示できません</h1>
            <p>公開作品や接続状態を確認できません。対象がない場合もこの画面になります。</p>
            <Button onClick={() => setAttempt((v) => v + 1)}>もう一度確認</Button>
          </section>
        ) : !value ? (
          <p role="status">作品を読み込んでいます…</p>
        ) : (
          <>
            <h1>{value.author.name}の公開作品</h1>
            <p>{[value.author.department, value.author.year].filter(Boolean).join(' · ')}</p>
            <p className="project-description">{value.author.bio}</p>
            <p>
              新しく公開した作品を最大20件表示します。記事の読了時間やいいね順位とは別の一覧です。
            </p>
            <section aria-label="投稿者の公開作品" className="project-cards">
              {value.projects.map((project) => (
                <PublicProjectCard key={project.id} project={project} />
              ))}
            </section>
          </>
        )}
      </main>
      <footer>ローカル専用 · 学生による価値検証は未実施です。</footer>
    </div>
  );
}
