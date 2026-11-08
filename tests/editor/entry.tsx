import PublicWorksLab from '../../src/editor/PublicWorksLab';
import ProjectModerationLab from '../../src/editor/ProjectModerationLab';
import PublicProjectLab from '../../src/editor/PublicProjectLab';
import ProjectAuthorLab from '../../src/editor/ProjectAuthorLab';
import PublicLikesLab from '../../src/editor/PublicLikesLab';
import React from 'react';
import { createRoot } from 'react-dom/client';
import DraftEditor from '../../src/editor/DraftEditor';
import PublicProfileSetup from '../../src/editor/PublicProfileSetup';
import PublishedArticleLab from '../../src/editor/PublishedArticleLab';
import PublicAuthorLab from '../../src/editor/PublicAuthorLab';
import PublicDiscoveryLab from '../../src/editor/PublicDiscoveryLab';
import ModerationLab from '../../src/editor/ModerationLab';
import AccountSessionLab from '../../src/editor/AccountSessionLab';
import ModerationPage from '../../src/account/ModerationPage';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
const root = createRoot(document.getElementById('root')!);
root.render(<p>ローカル専用の実験環境を準備しています。</p>);
if (location.origin !== 'https://127.0.0.1:8788')
  root.render(<p>この実験環境は指定のローカルURLでのみ動きます。</p>);
else if (location.pathname === '/moderation')
  root.render(
    <RouterProvider
      router={createBrowserRouter([{ path: '/moderation', element: <ModerationPage /> }])}
    />,
  );
else if (location.pathname === '/lab/account') root.render(<AccountSessionLab />);
else if (location.pathname.startsWith('/lab/account'))
  root.render(<p>この検証画面を表示できません。</p>);
else if (location.pathname === '/lab/project-moderation') root.render(<ProjectModerationLab />);
else if (location.pathname.startsWith('/lab/project-moderation'))
  root.render(<p>この作品通報画面を表示できません。</p>);
else if (location.pathname === '/lab/moderation') root.render(<ModerationLab />);
else if (location.pathname.startsWith('/lab/moderation'))
  root.render(<p>この検証画面を表示できません。</p>);
else if (location.pathname === '/lab/works') root.render(<PublicWorksLab />);
else if (location.pathname.startsWith('/lab/works'))
  root.render(<p>この作品一覧を表示できません。</p>);
else if (location.pathname === '/lab/discover') root.render(<PublicDiscoveryLab />);
else if (location.pathname.startsWith('/lab/discover'))
  root.render(<p>この新着一覧を表示できません。</p>);
else if (location.pathname.startsWith('/lab/projects/'))
  root.render(
    <PublicProjectLab
      key={location.pathname}
      projectId={location.pathname.slice('/lab/projects/'.length)}
    />,
  );
else if (location.pathname.startsWith('/lab/projects'))
  root.render(<p>この作品を表示できません。</p>);
else if (location.pathname.startsWith('/lab/project-authors/'))
  root.render(
    <ProjectAuthorLab
      key={location.pathname}
      profileId={location.pathname.slice('/lab/project-authors/'.length)}
    />,
  );
else if (location.pathname.startsWith('/lab/project-authors'))
  root.render(<p>この投稿者の作品を表示できません。</p>);
else if (location.pathname.startsWith('/lab/likes/'))
  root.render(
    <PublicLikesLab
      key={location.pathname}
      profileId={location.pathname.slice('/lab/likes/'.length)}
    />,
  );
else if (location.pathname.startsWith('/lab/likes'))
  root.render(<p>この公開いいねを表示できません。</p>);
else if (location.pathname.startsWith('/lab/authors/'))
  root.render(
    <PublicAuthorLab
      key={location.pathname}
      authorId={location.pathname.slice('/lab/authors/'.length)}
    />,
  );
else if (location.pathname.startsWith('/lab/authors'))
  root.render(<p>この投稿者を表示できません。</p>);
else if (location.pathname.startsWith('/lab/articles/'))
  root.render(<PublishedArticleLab contentId={location.pathname.slice('/lab/articles/'.length)} />);
else
  fetch('/__fixture/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'a' }),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error();
      const value = (await response.json()) as { csrfToken: string };
      root.render(
        <>
          <DraftEditor csrfToken={value.csrfToken} />
          <PublicProfileSetup csrfToken={value.csrfToken} />
        </>,
      );
    })
    .catch(() => root.render(<p>ローカル実験環境を準備できませんでした。</p>));
