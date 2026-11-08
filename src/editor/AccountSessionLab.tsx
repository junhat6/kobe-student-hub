import AccountSessionBoundary from '../account/AccountSessionBoundary';
import AccountEnrollment from './AccountEnrollment';
import OwnPublications from './OwnPublications';
import ProjectRegistration from './ProjectRegistration';
import DraftEditor from './DraftEditor';
import PublicProfileSetup from './PublicProfileSetup';
import './session-lab.css';

export default function AccountSessionLab() {
  return (
    <AccountSessionBoundary variant="lab">
      {({ csrfToken, fetcher }) => (
        <>
          <AccountEnrollment csrfToken={csrfToken} fetcher={fetcher} />
          <DraftEditor csrfToken={csrfToken} fetcher={fetcher} />
          <PublicProfileSetup csrfToken={csrfToken} fetcher={fetcher} />
          <ProjectRegistration csrfToken={csrfToken} fetcher={fetcher} />
          <OwnPublications csrfToken={csrfToken} fetcher={fetcher} />
        </>
      )}
    </AccountSessionBoundary>
  );
}
