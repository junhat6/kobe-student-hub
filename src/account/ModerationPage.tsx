import { Link, useLocation } from 'react-router-dom';
import { useCallback, useEffect, useRef } from 'react';
import { ModerationCases } from '../editor/ModerationLab';
import OperatorReadBoundary from '../editor/OperatorReadBoundary';
import { useUnsavedNavigation } from './useUnsavedNavigation';
import '../editor/moderation.css';
import EmailNotifications from './EmailNotifications';

export default function ModerationPage() {
  const { search } = useLocation();
  const initialCaseId = new URLSearchParams(search).get('case');
  const navigationRisk = useUnsavedNavigation(
    '未送信の判断理由、または結果不明の操作があります。画面を離れると手元の入力を失います。受け付けられた判断は取り消せません。移動しますか？',
  );
  const risk = useRef(false);
  const emailRisk = useRef(false);
  const onRiskChange = useCallback(
    (value: boolean) => {
      risk.current = value;
      navigationRisk(value || emailRisk.current);
    },
    [navigationRisk],
  );
  const onEmailRiskChange = useCallback(
    (value: boolean) => {
      emailRisk.current = value;
      navigationRisk(value || risk.current);
    },
    [navigationRisk],
  );
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (risk.current || emailRisk.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, []);
  return (
    <section className="shell moderation-lab moderation-page">
      <h1>通報の確認と判断</h1>
      <p>
        サーバーで指定された運営者だけが、通報内容を確認し、理由付きで復元・削除を判断できます。
      </p>
      <p>
        <Link to="/account">アカウントへ</Link>
      </p>
      <OperatorReadBoundary decisions>
        {(fetcher) => (
          <>
            <ModerationCases
              fetcher={fetcher}
              decisions
              notifications
              initialCaseId={initialCaseId}
              onRiskChange={onRiskChange}
            />
            <EmailNotifications fetcher={fetcher} onRiskChange={onEmailRiskChange} />
          </>
        )}
      </OperatorReadBoundary>
    </section>
  );
}
