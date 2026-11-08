import { Link } from 'react-router-dom';
import ProjectSessionScope from '../editor/ProjectSessionScope';
import ReportPanel from '../editor/ReportPanel';

/** Reading stays anonymous until the reader explicitly opens the report session. */
export default function OrdinaryArticleReport({
  contentId,
  onNavigationRiskChange,
}: {
  contentId: string;
  onNavigationRiskChange?: (risk: boolean) => void;
}) {
  return (
    <section className="report-panel" aria-label="記事の通報">
      <h2>記事の通報</h2>
      <ProjectSessionScope
        label="この記事を通報する"
        signedOutMessage={
          <>
            現在ログインしていません。前の入力・通報内容は閉じています。通報するには{' '}
            <Link to="/login">ログインしてください</Link>。
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
          />
        )}
      </ProjectSessionScope>
    </section>
  );
}
