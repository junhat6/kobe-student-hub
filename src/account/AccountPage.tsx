import { Link } from 'react-router-dom';
import AccountSessionBoundary from './AccountSessionBoundary';
import AccountEnrollment from '../editor/AccountEnrollment';
import './account.css';
import { authoringUiEnabled } from './routes';
export default function AccountPage() {
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
          </>
        )}
      </AccountSessionBoundary>
      <p className="account-read-link">
        <Link to="/">記事・作品を読む</Link>
      </p>
    </section>
  );
}
