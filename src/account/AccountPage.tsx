import { Link } from 'react-router-dom';
import { useCallback } from 'react';
import AccountSessionBoundary from './AccountSessionBoundary';
import AccountEnrollment from '../editor/AccountEnrollment';
import './account.css';
import { authoringUiEnabled } from './routes';
import PublicProfileSetup from '../editor/PublicProfileSetup';
import OwnPublications from '../editor/OwnPublications';
import { useUnsavedNavigation } from './useUnsavedNavigation';
export default function AccountPage() {
  const onNavigationRiskChange = useUnsavedNavigation(
    '未保存のプロフィール、または結果を確認中の操作があります。画面を離れると手元の入力は失われます。送信済みの操作は取り消せません。移動しますか？',
  );
  const profileRisk = useCallback(
    (risk: boolean) => onNavigationRiskChange(risk, 'profile'),
    [onNavigationRiskChange],
  );
  const publicationRisk = useCallback(
    (risk: boolean) => onNavigationRiskChange(risk, 'publication'),
    [onNavigationRiskChange],
  );
  return (
    <section className="account-page">
      <AccountSessionBoundary
        signedOutContent={
          <div className="account-signed-out">
            <Link className="primary" to="/login">
              ログインする
            </Link>
            <Link to="/signup">初めての方は学生として登録する</Link>
          </div>
        }
      >
        {({ csrfToken, fetcher }) => (
          <>
            {authoringUiEnabled && (
              <p className="account-drafts-link">
                <Link className="primary" to="/drafts">
                  下書きを書く・再開する
                </Link>
              </p>
            )}
            <AccountEnrollment csrfToken={csrfToken} fetcher={fetcher} />
            {authoringUiEnabled && (
              <>
                <div id="profile">
                  <PublicProfileSetup
                    csrfToken={csrfToken}
                    fetcher={fetcher}
                    surface="ordinary"
                    onNavigationRiskChange={profileRisk}
                  />
                </div>
                <div id="publications">
                  <OwnPublications
                    csrfToken={csrfToken}
                    fetcher={fetcher}
                    surface="ordinary"
                    onNavigationRiskChange={publicationRisk}
                  />
                </div>
              </>
            )}
          </>
        )}
      </AccountSessionBoundary>
      <p className="account-read-link">
        <Link to="/">記事・作品を読む</Link>
      </p>
    </section>
  );
}
