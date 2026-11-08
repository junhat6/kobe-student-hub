import { useEffect, useRef, useState } from 'react';
import { Button } from '@base-ui/react/button';
import {
  createModerationClient,
  validDecisionInput,
  type ModerationCase,
  type ModerationDecisionInput,
  type ModerationDecisionReceipt,
  type ModerationDecisionState,
} from './moderation-client';

export default function ModerationDecision({
  client,
  detail,
  state,
  onResolved,
  onRiskChange,
  onBusyChange,
  notifications = false,
  project = false,
}: {
  client: ReturnType<typeof createModerationClient>;
  detail: ModerationCase;
  state: ModerationDecisionState;
  onResolved: (receipt: ModerationDecisionReceipt) => void;
  onRiskChange: (risk: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  notifications?: boolean;
  project?: boolean;
}) {
  const [reason, setReason] = useState('');
  const [phase, setPhase] = useState<'editing' | 'confirming' | 'sending' | 'unknown'>('editing');
  const [confirmed, setConfirmed] = useState(false);
  const [command, setCommand] = useState<ModerationDecisionInput | null>(null);
  const [message, setMessage] = useState(
    '本文と通報を確認してから、判断の理由を入力してください。',
  );
  const [latest, setLatest] = useState<ModerationDecisionState | null>(null);
  const mounted = useRef(true),
    lock = useRef(false),
    confirmationHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    onRiskChange(!!reason || phase !== 'editing');
  }, [reason, phase, onRiskChange]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      onRiskChange(false);
      onBusyChange(false);
    };
  }, [onRiskChange, onBusyChange]);
  useEffect(() => {
    if (phase === 'confirming') confirmationHeading.current?.focus();
  }, [phase]);
  function prepare(action: 'hide' | 'restore' | 'delete') {
    const input = {
      decisionId: crypto.randomUUID(),
      expectedRound: state.round,
      expectedVersion: state.version,
      action,
      reason,
    };
    if (!validDecisionInput(input, project)) {
      setMessage('理由を1〜1000文字、4000バイト以内で入力してください。');
      return;
    }
    setCommand(input);
    setConfirmed(false);
    setPhase('confirming');
    setMessage('対象・理由・変更内容を確認してください。まだ送信していません。');
  }
  async function send() {
    if (!command || !confirmed || lock.current) return;
    lock.current = true;
    onBusyChange(true);
    setPhase('sending');
    setMessage('判断を送信しています。画面を閉じても、受け付けられた操作は取り消せません。');
    try {
      const csrf = await client.session();
      const result = await client.decide(detail.contentId, command, csrf, true);
      if (mounted.current) onResolved(result);
    } catch {
      if (mounted.current) {
        setPhase('unknown');
        setConfirmed(false);
        setMessage(
          '判断の結果を確認できません。対象と理由を保持しています。自動再送はしません。まず判断の記録を再確認してください。',
        );
      }
    } finally {
      lock.current = false;
      if (mounted.current) onBusyChange(false);
    }
  }
  async function reconcile() {
    if (!command || lock.current) return;
    lock.current = true;
    onBusyChange(true);
    try {
      const result = await client.readDecision(detail.contentId, command);
      if (mounted.current) onResolved(result);
    } catch {
      if (mounted.current)
        setMessage(
          'この判断の記録は確認できませんでした。未受付とは断定できません。理由を保持したまま、現在の案件の状態を確認できます。',
        );
    } finally {
      lock.current = false;
      if (mounted.current) onBusyChange(false);
    }
  }
  async function refreshState() {
    if (lock.current) return;
    lock.current = true;
    onBusyChange(true);
    try {
      const value = await client.decisionState(detail.contentId);
      if (mounted.current) setLatest(value);
    } catch {
      if (mounted.current)
        setMessage('現在の案件の状態を確認できませんでした。判断の結果は不明のままです。');
    } finally {
      lock.current = false;
      if (mounted.current) onBusyChange(false);
    }
  }
  return (
    <section className="moderation-decision" aria-label="運営判断">
      <h3>この案件を判断する</h3>
      <p className="moderation-message" role="status">
        {message}
      </p>
      {phase === 'editing' ? (
        <>
          <label htmlFor="moderation-decision-reason">判断の理由 必須</label>
          <textarea
            id="moderation-decision-reason"
            value={reason}
            maxLength={2000}
            onChange={(event) => setReason(event.target.value)}
            aria-describedby="moderation-reason-help"
          />
          <p id="moderation-reason-help" className="moderation-limit">
            {notifications
              ? '1000文字以内。理由は運営の記録に保存し、対象の本人にも表示します。'
              : '1000文字以内。理由は運営の判断記録に保存されます。'}
          </p>
          <div className="moderation-actions">
            {project && (
              <Button disabled={state.status !== 'published'} onClick={() => prepare('hide')}>
                一時非公開を確認
              </Button>
            )}
            <Button disabled={state.status !== 'hidden'} onClick={() => prepare('restore')}>
              復元を確認
            </Button>
            <Button disabled={state.status === 'deleted'} onClick={() => prepare('delete')}>
              削除を確認
            </Button>
          </div>
        </>
      ) : (
        command && (
          <>
            <h4 ref={confirmationHeading} tabIndex={-1}>
              対象：{detail.title || (project ? '無題の作品' : '無題の記事')}
            </h4>
            <p>
              {command.action === 'hide'
                ? '作品を一時非公開にします。保存版・画像・通報記録は保持します。'
                : project && command.action === 'restore'
                  ? '作品の保存済み公開版を公開に戻します。通報記録は残します。本人が公開停止した作品は復元できません。'
                  : project && command.action === 'delete'
                    ? '作品を公開表示から削除します。保存版・画像・通報記録の物理消去ではありません。'
                    : command.action === 'restore'
                      ? '一時非公開の記事を公開に戻します。過去の通報を残し、新しい通報受付を始めます。本人が公開停止した記事は復元できません。'
                      : '記事を公開表示から削除します。本文・下書き・通報記録は消去しません。'}
            </p>
            <h4>登録する理由</h4>
            <p className="moderation-plain-text">{command.reason}</p>
            {phase === 'unknown' && (
              <>
                <div className="moderation-actions">
                  <Button disabled={lock.current} onClick={() => void reconcile()}>
                    判断の記録を再確認
                  </Button>
                  <Button disabled={lock.current} onClick={() => void refreshState()}>
                    現在の案件の状態を確認
                  </Button>
                </div>
                {latest && (
                  <p>
                    現在の保存状態：
                    {latest.status === 'published'
                      ? '公開中'
                      : latest.status === 'hidden'
                        ? '一時非公開'
                        : '削除済み'}
                    。この表示だけでは、この判断が受け付けられたとは断定しません。
                  </p>
                )}
              </>
            )}
            <label className="moderation-confirm">
              <input
                type="checkbox"
                disabled={phase === 'sending'}
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                {phase === 'unknown'
                  ? '前の結果が不明であることを理解し、同じ対象と理由で再送します'
                  : 'この対象・理由・変更内容を確認しました'}
              </span>
            </label>
            <div className="moderation-actions">
              <Button disabled={!confirmed || phase === 'sending'} onClick={() => void send()}>
                {phase === 'unknown'
                  ? '同じ判断を再送'
                  : command.action === 'hide'
                    ? '確認した内容で一時非公開'
                    : command.action === 'restore'
                      ? '確認した内容で復元'
                      : '確認した内容で削除'}
              </Button>
              {phase === 'confirming' && (
                <Button
                  onClick={() => {
                    setCommand(null);
                    setPhase('editing');
                    setConfirmed(false);
                  }}
                >
                  理由の入力に戻る
                </Button>
              )}
            </div>
          </>
        )
      )}
      <p className="moderation-limit">
        {notifications
          ? '本人への説明記録とメールの受理・到達は別に扱います。'
          : '通知の送信は未設定です。判断の受付を、メールの送信完了として扱いません。'}
      </p>
    </section>
  );
}
