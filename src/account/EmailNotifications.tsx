import { Link } from 'react-router-dom';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@base-ui/react/button';
import { createModerationClient, type EmailRetryInput } from '../editor/moderation-client';
import type { EmailDeliverySummary, EmailDeliveryState } from '../notification-types';
import './notifications.css';
const labels: Record<EmailDeliveryState, string> = {
  pending: '送信待ち',
  ready: '再送待ち',
  leased: '送信確認中',
  accepted: 'サービス受理・到達未確認',
  failed: '未受理',
  unknown: '結果不明・自動再送なし',
};
export default function EmailNotifications({
  fetcher,
  onRiskChange,
}: {
  fetcher: typeof fetch;
  onRiskChange?: (risk: boolean) => void;
}) {
  const client = useMemo(() => createModerationClient(fetcher), [fetcher]);
  const mounted = useRef(true),
    lock = useRef(false);
  const [items, setItems] = useState<EmailDeliverySummary[] | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(
      '通報メールの状態は、判断の受付やメールの到達とは別に確認します。',
    );
  const [command, setCommand] = useState<{ outboxId: string; input: EmailRetryInput } | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [unknown, setUnknown] = useState(false),
    [retrying, setRetrying] = useState(false);
  useLayoutEffect(() => onRiskChange?.(retrying || unknown), [retrying, unknown, onRiskChange]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      onRiskChange?.(false);
    };
  }, [onRiskChange]);
  async function load() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setItems(null);
    setMessage('配送状態を確認しています…');
    try {
      const value = await client.emailQueue();
      if (mounted.current) {
        setItems(value);
        if (
          command &&
          value.some(
            (v) =>
              v.outboxId === command.outboxId && v.retryCommandId === command.input.retryCommandId,
          )
        ) {
          setCommand(null);
          setUnknown(false);
          setConfirmed(false);
        }
        setMessage(
          value.length
            ? '新しい通知から20件まで表示しています。結果不明は配信記録との照合が必要です。'
            : '通報メールの記録はありません。',
        );
      }
    } catch {
      if (mounted.current)
        setMessage(
          '配送状態を確認できませんでした。送信・未送信を推測せず、もう一度確認してください。',
        );
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function retry() {
    if (!command || !confirmed || lock.current) return;
    lock.current = true;
    setBusy(true);
    setRetrying(true);
    setConfirmed(false);
    setMessage('確認した未受理の通知を再送待ちに戻しています…');
    try {
      const csrf = await client.session();
      const value = await client.retryEmail(command.outboxId, command.input, csrf);
      if (mounted.current) {
        setItems(
          (rows) => rows?.map((row) => (row.outboxId === value.outboxId ? value : row)) ?? [value],
        );
        setCommand(null);
        setUnknown(false);
        setMessage('再送待ちの記録を確認しました。メールの受理・到達はまだ確認していません。');
      }
    } catch {
      if (mounted.current) {
        setUnknown(true);
        setMessage(
          '再送待ちに戻せたか確認できませんでした。自動では再送しません。「配送状態を確認」で同じ操作の記録を確認してください。',
        );
      }
    } finally {
      lock.current = false;
      if (mounted.current) {
        setBusy(false);
        setRetrying(false);
      }
    }
  }
  return (
    <section aria-label="運営メールの配送" className="account-notifications">
      <h2>運営メールの配送</h2>
      <p role="status">{message}</p>
      <Button disabled={busy} onClick={() => void load()}>
        配送状態を確認
      </Button>
      {items && (
        <ul className="notification-list">
          {items.map((item) => (
            <li key={item.outboxId}>
              <strong>
                {item.event === 'temporarily_hidden'
                  ? '一時非公開の通知'
                  : `${item.reportCount}件目の通報通知`}
              </strong>
              <p>{item.title || '無題の記事'}</p>
              <time dateTime={new Date(item.createdAt).toISOString()}>
                {new Date(item.createdAt).toLocaleString('ja-JP')}
              </time>
              <p>
                {labels[item.state]} · 送信試行 {item.attempts}/3回
              </p>
              <Link to={'/moderation?case=' + encodeURIComponent(item.contentId)}>
                対象の案件を確認する
              </Link>
              {item.state === 'failed' && item.attempts < 3 && (
                <Button
                  disabled={busy || unknown || Boolean(command)}
                  onClick={() => {
                    setCommand({
                      outboxId: item.outboxId,
                      input: {
                        retryCommandId: crypto.randomUUID(),
                        expectedAttempts: item.attempts,
                        confirmRetry: true,
                      },
                    });
                    setConfirmed(false);
                  }}
                >
                  この未受理通知の再送を確認
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {command && (
        <div className="moderation-result">
          <p>
            {unknown
              ? '前の再送待ち操作の結果は不明です。新しい送信要求は行いません。'
              : 'サービスが受理していない通知を、もう一度だけ送信待ちに戻します。'}
          </p>
          {!unknown && (
            <>
              <label className="moderation-confirm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                この未受理通知を再送待ちに戻す
              </label>
              <Button disabled={busy || !confirmed} onClick={() => void retry()}>
                確認した通知を再送待ちに戻す
              </Button>
              <Button disabled={busy} onClick={() => setCommand(null)}>
                キャンセル
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
