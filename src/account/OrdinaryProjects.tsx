import { Link } from 'react-router-dom';
import AccountSessionBoundary from './AccountSessionBoundary';
import ProjectRegistration from '../editor/ProjectRegistration';
import { useUnsavedNavigation } from './useUnsavedNavigation';

export default function OrdinaryProjects() {
  const onNavigationRiskChange = useUnsavedNavigation(
    '未保存の作品、または結果を確認中の操作があります。この画面を離れると手元の入力は失われます。送信済みの操作は取り消せません。移動しますか？',
  );
  return (
    <section className="account-page">
      <AccountSessionBoundary
        variant="authoring"
        signedOutContent={
          <p>
            <Link to="/login">ログインする</Link> ·{' '}
            <Link to="/signup">初めての方は学生として登録する</Link>
          </p>
        }
      >
        {({ csrfToken, fetcher }) => (
          <ProjectRegistration
            csrfToken={csrfToken}
            fetcher={fetcher}
            surface="ordinary"
            onNavigationRiskChange={onNavigationRiskChange}
          />
        )}
      </AccountSessionBoundary>
      <p className="account-read-link">
        <Link to="/account">アカウントへ戻る</Link>
      </p>
    </section>
  );
}
