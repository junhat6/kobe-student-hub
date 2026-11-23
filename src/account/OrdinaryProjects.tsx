import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import AccountSessionBoundary from './AccountSessionBoundary';
import ProjectRegistration from '../editor/ProjectRegistration';
import { useUnsavedNavigation } from './useUnsavedNavigation';
import './account.css';
import './ordinary-drafts.css';
import ProfileFirst from './ProfileFirst';
import { ParticipationNotice, useOwnParticipation, writesClosed } from './participation';

function OwnProjects({
  csrfToken,
  fetcher,
  rescue,
  onNavigationRiskChange,
}: {
  csrfToken: string;
  fetcher: typeof fetch;
  rescue: Parameters<typeof ProjectRegistration>[0]['rescue'];
  onNavigationRiskChange: (risk: boolean) => void;
}) {
  const participation = useOwnParticipation(csrfToken, fetcher);
  return (
    <>
      <ParticipationNotice participation={participation} place="works" />
      <ProfileFirst csrfToken={csrfToken} bypass={writesClosed(participation)}>
        <ProjectRegistration
          csrfToken={csrfToken}
          fetcher={fetcher}
          surface="ordinary"
          writable={!writesClosed(participation)}
          onNavigationRiskChange={onNavigationRiskChange}
          rescue={rescue}
        />
      </ProfileFirst>
    </>
  );
}
export default function OrdinaryProjects() {
  const onNavigationRiskChange = useUnsavedNavigation(
    '未保存の作品、または結果を確認中の操作があります。この画面を離れると手元の入力は失われます。送信済みの操作は取り消せません。移動しますか？',
  );
  const onRescueChange = useCallback(
    (value: boolean) => onNavigationRiskChange(value, 'rescue'),
    [onNavigationRiskChange],
  );
  return (
    <section className="account-page account-page-wide">
      <AccountSessionBoundary
        variant="authoring"
        title="作品"
        onRescueChange={onRescueChange}
        signedOutContent={
          <div className="account-signed-out">
            <Link className="primary" to="/login">
              ログインする
            </Link>
            <Link to="/signup">初めての方は学生として登録する</Link>
          </div>
        }
      >
        {({ csrfToken, fetcher, rescue }) => (
          <OwnProjects
            csrfToken={csrfToken}
            fetcher={fetcher}
            rescue={rescue}
            onNavigationRiskChange={onNavigationRiskChange}
          />
        )}
      </AccountSessionBoundary>
    </section>
  );
}
