import { Link, useLocation } from 'react-router-dom';
import { useCallback, useRef, useState } from 'react';
import AccountSessionBoundary from './AccountSessionBoundary';
import AccountEnrollment from '../editor/AccountEnrollment';
import './account.css';
import { authoringUiEnabled } from './routes';
import ProfileEditor, { type ProfileState } from './ProfileEditor';
import Icon from '../shared/Icon';
import Breadcrumbs, { MY_PAGE_TRAIL } from '../shell/Breadcrumbs';
import OwnPublications from '../editor/OwnPublications';
import OwnNotifications from './OwnNotifications';
import EditorialTaste from './EditorialTaste';
import AgentConnections from '../agent/AgentConnections';
import { AGENT_MCP_RELEASE_ENABLED, TASTE_SHARING_RELEASE_ENABLED } from '../shared/agent-release';
import OwnTaste from './OwnTaste';
import { useUnsavedNavigation } from './useUnsavedNavigation';
import { useViewer } from '../shell/viewer';
import ActivityGrass from '../community/ActivityGrass';
import ReceivedLikes from '../community/ReceivedLikes';
import { ParticipationNotice, writesClosed, type ParticipationState } from './participation';
import { useHashLanding } from './useHashLanding';

const LANDING_SECTIONS = ['publications', 'enrollment', 'notifications'] as const;

/**
 * #174: the article a reader wanted to like before making a profile. Only router state
 * from our own like button sets it, and only an article path is accepted, so a link from
 * elsewhere cannot turn this page into a redirect.
 */
function returnArticle(state: unknown): string | null {
  const value = (state as { returnTo?: unknown } | null)?.returnTo;
  return typeof value === 'string' && /^\/articles\/[A-Za-z0-9_-]{1,128}$/.test(value)
    ? value
    : null;
}

function AccountActions({ participation }: { participation: ParticipationState }) {
  return (
    <nav className="account-actions" aria-label="マイページの操作">
      {/* #270: this is where drafts and published articles are listed, so it is named after
          that screen rather than 「記事を書く」, which hid that the draft list lives there. */}
      {writesClosed(participation) ? (
        <Link className="account-action" to="/drafts">
          <Icon name="doc" />
          記事の管理
        </Link>
      ) : (
        <>
          <Link className="account-action account-action-main" to="/drafts">
            <Icon name="doc" />
            記事の管理
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
  const locationState: unknown = useLocation().state;
  // 「プロフィールを編集」 on the author page lands here with the form already open (as on GitHub).
  const editProfile = (locationState as { editProfile?: unknown } | null)?.editProfile === true;
  const returnTo = returnArticle(locationState);
  const ownProfileId = viewer.status === 'signed-in' ? viewer.profile?.id : undefined;
  // Follows the enrollment panel, so a correction there updates the page at once.
  const [participation, setParticipation] = useState<ParticipationState>('checking');
  const [profileState, setProfileState] = useState<ProfileState>('loading');
  // 書き手の導線（docs/loop/GROWTH.md §10）：登録してプロフィールをつくった直後は、
  // 次の一手（最初の記事）を1つだけ見せる。「記事の管理」は0本の人には書く入口に見えなかった。
  const [justCreated, setJustCreated] = useState(false);
  const lastProfileState = useRef<ProfileState>('loading');
  const onProfileState = useCallback((next: ProfileState) => {
    if (lastProfileState.current === 'none' && next === 'exists') setJustCreated(true);
    lastProfileState.current = next;
    setProfileState(next);
  }, []);
  // A public profile comes first: until it exists, the page is only about making one.
  // Graduated students keep their tidy-up tools even without one.
  const ready =
    profileState === 'exists' || profileState === 'unknown' || writesClosed(participation);
  // #263: once the profile exists, a wide screen puts the person on the left and their
  // activity on the right (as on GitHub and /students/:id). Making a profile stays one column.
  const split = authoringUiEnabled && profileState === 'exists';
  // 作成直後は上に「最初の記事を書く」を出す。その間、下の空の公開記録には同じ入口を重ねない。
  const showFirstArticle =
    !returnTo && justCreated && profileState === 'exists' && !writesClosed(participation);
  useHashLanding(LANDING_SECTIONS);
  return (
    <div className={'account-layout' + (split ? ' account-layout-split' : '')}>
      <div className="account-side">
        {authoringUiEnabled && (
          <div id="profile" className="account-block">
            <ProfileEditor
              csrfToken={csrfToken}
              fetcher={fetcher}
              onStateChange={onProfileState}
              onSaved={refresh}
              onRiskChange={profileRisk}
              startEditing={editProfile}
            />
            {returnTo && profileState === 'exists' && (
              <Link className="primary account-return" to={returnTo}>
                記事に戻っていいねする
                <Icon name="arrowRight" size={18} />
              </Link>
            )}
            {showFirstArticle && (
              <Link className="primary account-return" to="/drafts">
                <Icon name="doc" size={18} />
                最初の記事を書く
              </Link>
            )}
          </div>
        )}
        {authoringUiEnabled && ready && <AccountActions participation={participation} />}
      </div>
      <div className="account-main">
        {authoringUiEnabled && (
          <ParticipationNotice participation={participation} place="account" />
        )}
        {authoringUiEnabled && ready && <ActivityGrass id={ownProfileId} own fetcher={fetcher} />}
        {authoringUiEnabled && ready && <ReceivedLikes id={ownProfileId} />}
        {authoringUiEnabled && ready && (
          <div id="publications" className="account-block" tabIndex={-1}>
            <OwnPublications
              csrfToken={csrfToken}
              fetcher={fetcher}
              surface="ordinary"
              emptyEntry={!showFirstArticle}
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
      </div>
    </div>
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
      {authoringUiEnabled && <Breadcrumbs items={[MY_PAGE_TRAIL[0], { label: 'マイページ' }]} />}
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
