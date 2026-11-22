import { useCallback, useEffect, useRef } from 'react';
import { Link, useBlocker } from 'react-router-dom';
import AccountSessionBoundary from './AccountSessionBoundary';
import DraftEditor from '../editor/DraftEditor';
import './account.css';
import './ordinary-drafts.css';
import ProfileFirst from './ProfileFirst';
import { ParticipationNotice, useOwnParticipation, writesClosed } from './participation';

function OwnDrafts({
  csrfToken,
  fetcher,
  rescue,
  onNavigationRiskChange,
}: {
  csrfToken: string;
  fetcher: typeof fetch;
  rescue: Parameters<typeof DraftEditor>[0]['rescue'];
  onNavigationRiskChange: (value: boolean) => void;
}) {
  const participation = useOwnParticipation(csrfToken, fetcher);
  return (
    <>
      <ParticipationNotice participation={participation} place="drafts" />
      <ProfileFirst csrfToken={csrfToken} bypass={writesClosed(participation)}>
        <DraftEditor
          variant="ordinary"
          csrfToken={csrfToken}
          fetcher={fetcher}
          rescue={rescue}
          writable={!writesClosed(participation)}
          onNavigationRiskChange={onNavigationRiskChange}
        />
      </ProfileFirst>
    </>
  );
}
/** Route protection belongs to the ordinary data router, outside session visibility changes. */
export default function OrdinaryDrafts() {
  const risk = useRef(false),
    rescueRisk = useRef(false);
  const onNavigationRiskChange = useCallback((value: boolean) => {
    risk.current = value;
  }, []);
  const onRescueChange = useCallback((value: boolean) => {
    rescueRisk.current = value;
  }, []);
  const blocker = useBlocker(useCallback(() => risk.current || rescueRisk.current, []));
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (
      window.confirm(
        '未保存の編集、または結果を確認中の操作があります。この画面を離れると手元の編集は失われます。送信済みの保存・作成は取り消せません。送信済みの削除も取り消せません。移動しますか？',
      )
    )
      blocker.proceed();
    else blocker.reset();
  }, [blocker]);
  return (
    <section className="ordinary-drafts">
      <AccountSessionBoundary
        variant="authoring"
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
          <OwnDrafts
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
