import { Link } from 'react-router-dom';
import ProjectSessionScope from '../editor/ProjectSessionScope';
import { ReportForm } from '../editor/ProjectReport';
import { createProfileReportClient } from '../editor/profile-report-client';
import '../editor/project-report.css';

/** Reading stays anonymous until the reader explicitly opens the report session. */
export default function ProfileReport({
  profileId,
  onNavigationRiskChange,
}: {
  profileId: string;
  onNavigationRiskChange?: (risk: boolean) => void;
}) {
  return (
    <section className="project-report-panel profile-report-panel" aria-label="プロフィールの通報">
      <h2>プロフィールの通報</h2>
      <ProjectSessionScope
        signedInMessage=""
        label="このプロフィールを通報する"
        signedOutMessage={
          <>
            通報するには<Link to="/login">ログイン</Link>
            してください。前の入力は引き継ぎません。
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
          />
        )}
      </ProjectSessionScope>
    </section>
  );
}
