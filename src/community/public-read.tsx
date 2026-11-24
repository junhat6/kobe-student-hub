import { useEffect, useState } from 'react';
import { Button } from '@base-ui/react/button';
import { Link } from 'react-router-dom';
import { publicReadMissing } from '../editor/anonymous-public-read';

/** Anonymous reading never creates an account or sends session credentials. */
export function usePublicRead<T>(key: string, read: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<{
    key: string;
    value: T | null;
    failed: boolean;
    missing: boolean;
  }>({ key, value: null, failed: false, missing: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ key, value: null, failed: false, missing: false });
    read(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setState({ key, value, failed: false, missing: false });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setState({ key, value: null, failed: true, missing: publicReadMissing(error) });
      },
    );
    return () => controller.abort();
  }, [key, read, attempt]);
  return {
    value: state.key === key ? state.value : null,
    failed: state.key === key && state.failed,
    /** The item is absent or not public; retrying will not help, so show a way back instead. */
    missing: state.key === key && state.missing,
    retry: () => setAttempt((value) => value + 1),
  };
}

export function ReadFailure({ subject, retry }: { subject: string; retry: () => void }) {
  return (
    <section className="empty" role="alert">
      <h1>{subject}を表示できませんでした</h1>
      <p>接続を確認して、もう一度お試しください。非公開の記事は表示されません。</p>
      <Button className="primary" onClick={retry}>
        もう一度読み込む
      </Button>
    </section>
  );
}

/** Absent or not public: distinct from a connection failure, and without saying why it is hidden. */
export function ReadMissing({
  subject,
  back = { to: '/', label: 'ホームへ戻る' },
}: {
  subject: string;
  back?: { to: string; label: string };
}) {
  return (
    <section className="shell empty">
      <h1>{subject}が見つかりません</h1>
      <p>削除されたか、いまは公開されていない可能性があります。</p>
      <Link className="primary" to={back.to}>
        {back.label}
      </Link>
    </section>
  );
}
