import { useEffect, useState } from 'react';
import { Button } from '@base-ui/react/button';

/** Anonymous reading never creates an account or sends session credentials. */
export function usePublicRead<T>(key: string, read: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<{ key: string; value: T | null; failed: boolean }>({
    key,
    value: null,
    failed: false,
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ key, value: null, failed: false });
    read(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setState({ key, value, failed: false });
      },
      () => {
        if (!controller.signal.aborted) setState({ key, value: null, failed: true });
      },
    );
    return () => controller.abort();
  }, [key, read, attempt]);
  return {
    value: state.key === key ? state.value : null,
    failed: state.key === key && state.failed,
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
