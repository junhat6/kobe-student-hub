import { Link, useLocation } from 'react-router-dom';
import { useCallback, useState } from 'react';
import AccountSessionBoundary from './AccountSessionBoundary';
import AccountEnrollment from '../editor/AccountEnrollment';
import './account.css';
import { authoringUiEnabled } from './routes';
import ProfileEditor, { type ProfileState } from './ProfileEditor';
import Icon from '../shared/Icon';
import OwnPublications from '../editor/OwnPublications';
import OwnNotifications from './OwnNotifications';
import EditorialTaste from './EditorialTaste';
import AgentConnections from '../agent/AgentConnections';
import { AGENT_MCP_RELEASE_ENABLED, TASTE_SHARING_RELEASE_ENABLED } from '../shared/agent-release';
import OwnTaste from './OwnTaste';
import { useUnsavedNavigation } from './useUnsavedNavigation';
import { useViewer } from '../shell/viewer';
import ActivityGrass from '../community/ActivityGrass';
import { ParticipationNotice, writesClosed, type ParticipationState } from './participation';
import { useHashLanding } from './useHashLanding';

const LANDING_SECTIONS = ['publications', 'enrollment'] as const;

function AccountActions({ participation }: { participation: ParticipationState }) {
  return (
    <nav className="account-actions" aria-label="マイページの操作">
      {writesClosed(participation) ? (
        <Link className="account-action" to="/drafts">
          <Icon name="doc" />
          下書き
        </Link>
      ) : (
        <>
          <Link className="account-action account-action-main" to="/drafts">
            <Icon name="pencil" />
            記事を書く
          </Link>
          <Link className="account-action" to="/works/new">
            <Icon name="cube" />
            作品を登録
          </Link>
        </>
      )}
      <Link className="account-action" to="/history">
        <Icon name="clock" />
        閲覧履歴
      </Link>
    </nav>
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
  const { refresh, viewer } = useViewer();
  // 「プロフィールを編集」 on the author page lands here with the form already open (as on GitHub).
  const editProfile =
    (useLocation().state as { editProfile?: unknown } | null)?.editProfile === true;
  const ownProfileId = viewer.status === 'signed-in' ? viewer.profile?.id : undefined;
  // Follows the enrollment panel, so a correction there updates the page at once.
  const [participation, setParticipation] = useState<ParticipationState>('checking');
  const [profileState, setProfileState] = useState<ProfileState>('loading');
  // A public profile comes first: until it exists, the page is only about making one.
  // Graduated students keep their tidy-up tools even without one.
  const ready =
    profileState === 'exists' || profileState === 'unknown' || writesClosed(participation);
  useHashLanding(LANDING_SECTIONS);
  return (
    <>
      {authoringUiEnabled && (
        <div id="profile" className="account-block">
          <ProfileEditor
            csrfToken={csrfToken}
            fetcher={fetcher}
            onStateChange={setProfileState}
            onSaved={refresh}
            onRiskChange={profileRisk}
            startEditing={editProfile}
          />
        </div>
      )}
      {authoringUiEnabled && ready && <ActivityGrass id={ownProfileId} own fetcher={fetcher} />}
      {authoringUiEnabled && ready && <AccountActions participation={participation} />}
      {authoringUiEnabled && <ParticipationNotice participation={participation} place="account" />}
      {authoringUiEnabled && ready && (
        <div id="publications" className="account-block" tabIndex={-1}>
          <OwnPublications
            csrfToken={csrfToken}
            fetcher={fetcher}
            surface="ordinary"
            onNavigationRiskChange={publicationRisk}
          />
        </div>
      )}
      {authoringUiEnabled && ready && <OwnNotifications fetcher={fetcher} />}
      {authoringUiEnabled && <EditorialTaste fetcher={fetcher} />}
      {authoringUiEnabled && TASTE_SHARING_RELEASE_ENABLED && (
        <OwnTaste csrfToken={csrfToken} fetcher={fetcher} />
      )}
      {authoringUiEnabled && AGENT_MCP_RELEASE_ENABLED && (
        <AgentConnections csrfToken={csrfToken} fetcher={fetcher} />
      )}
      <div id="enrollment" className="account-block account-settings" tabIndex={-1}>
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
    </section>
  );
}
