import { Link, useLocation } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import AccountSessionBoundary from './AccountSessionBoundary';
import AccountEnrollment from '../editor/AccountEnrollment';
import './account.css';
import { authoringUiEnabled } from './routes';
import PublicProfileSetup from '../editor/PublicProfileSetup';
import OwnPublications from '../editor/OwnPublications';
import OwnNotifications from './OwnNotifications';
import { useUnsavedNavigation } from './useUnsavedNavigation';
import { useViewer } from '../shell/viewer';
import { ParticipationNotice, writesClosed, type ParticipationState } from './participation';

function AccountSummary({
  csrfToken,
  participation,
}: {
  csrfToken: string;
  participation: ParticipationState;
}) {
  const { viewer, refresh } = useViewer();
  // Show a name only when it belongs to the session this page just confirmed.
  const matches = viewer.status === 'signed-in' && viewer.csrfToken === csrfToken;
  const stale = viewer.status === 'signed-in' && !matches;
  useEffect(() => {
    if (stale) refresh();
  }, [stale, refresh]);
  // The retry is pending until the viewer object is replaced by a new read.
  const [retryFrom, setRetryFrom] = useState<typeof viewer | null>(null);
  const retrying = retryFrom !== null && retryFrom === viewer;
  if (!matches) return <div className="account-summary" aria-busy="true" />;
  const profile = viewer.profile;
  return (
    <div className="account-summary">
      <div className="account-summary-who">
        <span className="account-summary-avatar" aria-hidden="true">
          {profile?.initials ?? '?'}
        </span>
        <div>
          <p className="account-summary-name">
            {profile
              ? profile.name
              : profile === null
                ? 'プロフィール未作成'
                : 'プロフィールを読み込めませんでした'}
          </p>
          {profile ? (
            <Link to={`/students/${profile.id}`}>公開プロフィールを見る →</Link>
          ) : profile === undefined ? (
            <button
              type="button"
              className="text-button"
              disabled={retrying}
              onClick={() => {
                setRetryFrom(viewer);
                refresh();
              }}
            >
              {retrying ? '読み込み中…' : 'もう一度読み込む'}
            </button>
          ) : (
            <a href="#profile">公開プロフィールを作ると、記事を公開できます</a>
          )}
        </div>
      </div>
      <div className="account-summary-actions">
        {writesClosed(participation) ? (
          <Link className="secondary" to="/drafts">
            下書きを確認・削除する
          </Link>
        ) : (
          <>
            <Link className="primary" to="/drafts">
              記事を書く
            </Link>
            <Link className="secondary" to="/works/new">
              作品を登録する
            </Link>
          </>
        )}
        <Link className="secondary" to="/history">
          閲覧履歴
        </Link>
      </div>
    </div>
  );
}
function AccountContent({
  csrfToken,
  fetcher,
  profileRisk,
  publicationRisk,
}: {
  csrfToken: string;
  fetcher: typeof fetch;
  profileRisk: (risk: boolean) => void;
  publicationRisk: (risk: boolean) => void;
}) {
  // Follows the enrollment panel, so a correction there updates the summary at once.
  const [participation, setParticipation] = useState<ParticipationState>('checking');
  return (
    <>
      {authoringUiEnabled && <AccountSummary csrfToken={csrfToken} participation={participation} />}
      {authoringUiEnabled && <ParticipationNotice participation={participation} place="account" />}
      {authoringUiEnabled && (
        <div id="publications" className="account-block">
          <OwnPublications
            csrfToken={csrfToken}
            fetcher={fetcher}
            surface="ordinary"
            onNavigationRiskChange={publicationRisk}
          />
        </div>
      )}
      {authoringUiEnabled && (
        <div id="profile" className="account-block">
          <h2 className="account-block-title">公開プロフィール</h2>
          <PublicProfileSetup
            csrfToken={csrfToken}
            fetcher={fetcher}
            surface="ordinary"
            onNavigationRiskChange={profileRisk}
          />
        </div>
      )}
      {authoringUiEnabled && (
        <div className="account-block">
          <OwnNotifications fetcher={fetcher} />
        </div>
      )}
      <div id="enrollment" className="account-block account-settings">
        <AccountEnrollment
          csrfToken={csrfToken}
          fetcher={fetcher}
          onParticipationChange={setParticipation}
        />
      </div>
    </>
  );
}
export default function AccountPage() {
  const hash = useLocation().hash;
  const authenticationFailed = hash === '#authentication-failed';
  // Set by the server only after a fully verified Google token from outside the school domain.
  const schoolAccountRequired = hash === '#school-account-required';
  // Route protection stays outside session visibility changes.
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
    <section className="account-page account-home">
      <AccountSessionBoundary
        title={authoringUiEnabled ? 'マイページ' : undefined}
        signedOutContent={
          <>
            {authenticationFailed && (
              <p className="account-message" role="alert">
                ログイン・登録を完了できませんでした。もう一度やり直してください。
              </p>
            )}
            {schoolAccountRequired && (
              <p className="account-message" role="alert">
                選んだGoogleアカウントは学校のアカウントではないため、ログイン・登録できません。学校メール（@st.kobedenshi.ac.jp）のGoogleアカウントを選んでやり直してください。
              </p>
            )}
            <div className="account-signed-out">
              <Link className="primary" to="/login">
                ログインする
              </Link>
              <Link to="/signup">初めての方は学生として登録する</Link>
            </div>
          </>
        }
      >
        {({ csrfToken, fetcher }) => (
          <AccountContent
            csrfToken={csrfToken}
            fetcher={fetcher}
            profileRisk={profileRisk}
            publicationRisk={publicationRisk}
          />
        )}
      </AccountSessionBoundary>
      {authoringUiEnabled && (
        <p className="account-read-link account-operator-link">
          <Link to="/moderation">運営者用画面</Link>
        </p>
      )}
    </section>
  );
}
