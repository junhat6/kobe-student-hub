import { Link } from 'react-router-dom';
import ProjectSessionScope from '../editor/ProjectSessionScope';
import ReportPanel from '../editor/ReportPanel';
import ReportMenu from './ReportMenu';

/** Reading stays anonymous until the reader chooses 「…」 → 「通報する」. */
export default function OrdinaryArticleReport({
  contentId,
  onNavigationRiskChange,
}: {
  contentId: string;
  onNavigationRiskChange?: (risk: boolean) => void;
}) {
  return (
    <ReportMenu subject="記事" panelClass="report-panel">
      {(onSubmitted) => (
        <ProjectSessionScope
          initial
          inDialog
          surface="ordinary"
          signedInMessage=""
          label="この記事を通報する"
          signedOutMessage={
            <>
              通報するには<Link to="/login">ログイン</Link>してください。
            </>
          }
        >
          {({ fetcher }) => (
            <ReportPanel
              contentId={contentId}
              surface="ordinary"
              fetcher={fetcher}
              embedded
              onNavigationRiskChange={onNavigationRiskChange}
              onSubmitted={onSubmitted}
            />
          )}
        </ProjectSessionScope>
      )}
    </ReportMenu>
  );
}
