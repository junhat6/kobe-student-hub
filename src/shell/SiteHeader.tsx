import { Link, useLocation } from 'react-router-dom';
import { Menu } from '@base-ui/react/menu';
import { accountUiEnabled, authoringUiEnabled } from '../account/routes';
import { useViewer } from './viewer';
import './shell.css';

const sections = (authoring: boolean) =>
  [
    { to: '/', label: 'ホーム', match: (p: string) => p === '/' },
    { to: '/search', label: '探す', match: (p: string) => p === '/search' },
    ...(authoring
      ? [
          {
            to: '/works',
            label: '作品',
            match: (p: string) => p === '/works' || p.startsWith('/projects/'),
          },
        ]
      : []),
  ] as const;

function MenuLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Menu.LinkItem className="menu-item" closeOnClick render={<Link to={to} />}>
      {children}
    </Menu.LinkItem>
  );
}

function WriteMenu() {
  return (
    <Menu.Root>
      <Menu.Trigger className="header-write">
        <span aria-hidden="true">✎</span> 書く
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={8} align="end" className="menu-positioner">
          <Menu.Popup className="menu-popup">
            <MenuLink to="/drafts">
              <b>記事を書く</b>
              <small>学んだこと・試したことを書く</small>
            </MenuLink>
            <MenuLink to="/works/new">
              <b>作品を登録する</b>
              <small>つくったものを紹介する</small>
            </MenuLink>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function AccountMenu() {
  const { viewer, logout } = useViewer();
  if (viewer.status !== 'signed-in') return null;
  const profile = viewer.profile;
  return (
    <Menu.Root>
      <Menu.Trigger className="header-avatar" aria-label="アカウントメニュー">
        {profile ? (
          <span aria-hidden="true">{profile.initials}</span>
        ) : (
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5z" />
          </svg>
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={8} align="end" className="menu-positioner">
          <Menu.Popup className="menu-popup">
            <div className="menu-identity">
              <b>
                {profile
                  ? profile.name
                  : profile === null
                    ? 'プロフィール未作成'
                    : 'プロフィールを読み込めませんでした'}
              </b>
              <small>ログイン中</small>
            </div>
            <MenuLink to="/account">マイページ</MenuLink>
            {profile && <MenuLink to={`/students/${profile.id}`}>公開プロフィールを見る</MenuLink>}
            <MenuLink to="/drafts">下書き</MenuLink>
            <MenuLink to="/history">閲覧履歴</MenuLink>
            <Menu.Separator className="menu-separator" />
            <Menu.Item
              className="menu-item"
              onClick={() => {
                if (window.confirm('ログアウトしますか？ このページの未保存の入力は消えます。'))
                  void logout().then((ok) => {
                    if (!ok) window.alert('ログアウトできませんでした。もう一度お試しください。');
                  });
              }}
            >
              ログアウト
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export default function SiteHeader() {
  const { pathname } = useLocation();
  const { viewer } = useViewer();
  return (
    <header className="site-header">
      <div className="shell site-header-row">
        <Link to="/" className="brand">
          <span className="brand-icon" aria-hidden="true">
            k.
          </span>
          <span>
            Kobe Student Hub<small>知る。つくる。分かち合う。</small>
          </span>
        </Link>
        <nav aria-label="メイン" className="site-sections">
          {sections(authoringUiEnabled).map((section) => (
            <Link
              key={section.to}
              to={section.to}
              aria-current={section.match(pathname) ? 'page' : undefined}
            >
              {section.label}
            </Link>
          ))}
          {accountUiEnabled && !authoringUiEnabled && (
            <Link to="/account" aria-current={pathname === '/account' ? 'page' : undefined}>
              アカウント
            </Link>
          )}
        </nav>
        <div className="site-actions">
          {!authoringUiEnabled ? (
            <Link className="header-link" to="/about">
              このプレビューについて
            </Link>
          ) : viewer.status === 'signed-in' ? (
            <>
              {authoringUiEnabled && <WriteMenu />}
              <AccountMenu />
            </>
          ) : viewer.status === 'loading' ? (
            <span className="header-placeholder" aria-hidden="true" />
          ) : (
            <>
              <Link
                className="header-link"
                to="/login"
                aria-current={pathname === '/login' ? 'page' : undefined}
              >
                ログイン
              </Link>
              <Link className="header-cta" to="/signup">
                登録する
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
