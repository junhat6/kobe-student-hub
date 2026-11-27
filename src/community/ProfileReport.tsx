import { Link } from 'react-router-dom';
import ProjectSessionScope from '../editor/ProjectSessionScope';
import { ReportForm } from '../editor/ProjectReport';
import { createProfileReportClient } from '../editor/profile-report-client';
import ReportMenu from './ReportMenu';
import '../editor/project-report.css';

/** Reading stays anonymous until the reader chooses 「…」 → 「通報する」. */
export default function ProfileReport({
  profileId,
  onNavigationRiskChange,
}: {
  profileId: string;
  onNavigationRiskChange?: (risk: boolean) => void;
}) {
  return (
    <ReportMenu subject="プロフィール" panelClass="project-report-panel">
      {(onSubmitted) => (
        <ProjectSessionScope
          initial
          inDialog
          surface="ordinary"
          signedInMessage=""
          label="このプロフィールを通報する"
          signedOutMessage={
            <>
              通報するには<Link to="/login">ログイン</Link>してください。
            </>
          }
        >
          {(session) => (
            <ReportForm
              projectId={profileId}
              csrf={session.csrf}
              fetcher={session.fetcher}
              subject="プロフィール"
              createClient={createProfileReportClient}
              onNavigationRiskChange={onNavigationRiskChange}
              onSubmitted={onSubmitted}
              surface="ordinary"
            />
          )}
        </ProjectSessionScope>
      )}
    </ReportMenu>
  );
}
