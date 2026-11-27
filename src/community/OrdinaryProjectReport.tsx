import { Link } from 'react-router-dom';
import ProjectSessionScope from '../editor/ProjectSessionScope';
import { ReportForm } from '../editor/ProjectReport';
import ReportMenu from './ReportMenu';
import '../editor/project-report.css';

/** Reading stays anonymous until the reader chooses 「…」 → 「通報する」. */
export default function OrdinaryProjectReport({
  projectId,
  onNavigationRiskChange,
}: {
  projectId: string;
  onNavigationRiskChange?: (risk: boolean) => void;
}) {
  return (
    <ReportMenu subject="作品" panelClass="project-report-panel">
      {(onSubmitted) => (
        <ProjectSessionScope
          initial
          inDialog
          surface="ordinary"
          signedInMessage=""
          label="この作品を通報する"
          signedOutMessage={
            <>
              通報するには<Link to="/login">ログイン</Link>してください。
            </>
          }
        >
          {(session) => (
            <ReportForm
              projectId={projectId}
              csrf={session.csrf}
              fetcher={session.fetcher}
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
