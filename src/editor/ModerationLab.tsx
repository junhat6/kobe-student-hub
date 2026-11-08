import OperatorReadBoundary from './OperatorReadBoundary';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@base-ui/react/button';
import MarkdownRenderer from '../MarkdownRenderer';
import {
  createModerationClient,
  type ModerationCase,
  type ModerationSummary,
  type ModerationDecisionState,
  type ModerationDecisionReceipt,
} from './moderation-client';
import ModerationDecision from './ModerationDecision';
import './moderation.css';
class CaseBodyBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p>対象の文章を表示できませんでした。</p> : this.props.children;
  }
}
const stamp = (n: number) =>
  new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(n);
export function ModerationCases({
  fetcher,
  decisions = false,
  initialCaseId,
  notifications = false,
  onRiskChange,
  kind = 'article',
}: {
  fetcher: typeof fetch;
  kind?: 'article' | 'project';
  decisions?: boolean;
  initialCaseId?: string | null;
  notifications?: boolean;
  onRiskChange?: (risk: boolean) => void;
}) {
  const client = useMemo(() => createModerationClient(fetcher, kind), [fetcher, kind]);
  const project = kind === 'project';
  const targetLabel = project ? '作品' : '記事';
  const mediaFetcher = useMemo<typeof fetch>(
    () => (input, init) => {
      const path =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const match = /^\/api\/private\/media\/([0-9a-f-]{36})$/.exec(path);
      return fetcher(
        match && selectedRef.current
          ? '/api/private/moderation-media/' +
              (project ? 'projects' : 'articles') +
              '/' +
              selectedRef.current +
              '/' +
              match[1]
          : input,
        init,
      );
    },
    [fetcher, project],
  );
  const selectedRef = useRef<string | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const lock = useRef(false);
  const [cases, setCases] = useState<ModerationSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ModerationCase | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('確認待ちの一覧を取得しています…');
  const [failed, setFailed] = useState(false);
  const [decisionState, setDecisionState] = useState<ModerationDecisionState | null>(null);
  const [receipt, setReceipt] = useState<{
    title: string;
    value: ModerationDecisionReceipt;
  } | null>(null);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const risk = useRef(false);
  const openedInitialCase = useRef<string | null>(null);
  const riskChange = useCallback(
    (value: boolean) => {
      risk.current = value;
      onRiskChange?.(value);
    },
    [onRiskChange],
  );
  const busyChange = useCallback((value: boolean) => setDecisionBusy(value), []);
  function mayDiscard() {
    return (
      !risk.current ||
      window.confirm(
        '未送信の理由、または結果不明の判断があります。手元の入力を破棄して別の案件を確認しますか？受け付けられた判断は取り消せません。',
      )
    );
  }
  async function queue() {
    if (lock.current || decisionBusy || !mayDiscard()) return;
    lock.current = true;
    const request = ++generation.current;
    setBusy(true);
    setCases(null);
    setDetail(null);
    setSelected(null);
    setDecisionState(null);
    setReceipt(null);
    setFailed(false);
    setMessage('確認待ちの一覧を取得しています…');
    try {
      const result = await client.queue();
      if (mounted.current && generation.current === request) {
        setCases(result);
        setMessage(
          result.length
            ? decisions
              ? '対象を選び、本文と通報を確認して判断してください。'
              : '対象を選ぶと、通報内容を読み取り専用で確認できます。'
            : '確認待ちの通報はありません。',
        );
      }
    } catch {
      if (mounted.current && generation.current === request) {
        setFailed(true);
        setMessage(
          '一覧を確認できませんでした。運営用の権限・セッション・接続状態を確認してください。この画面でログインや権限付与は行いません。',
        );
      }
    } finally {
      lock.current = false;
      if (mounted.current && generation.current === request) setBusy(false);
    }
  }
  async function read(id: string) {
    if (lock.current || decisionBusy || !mayDiscard()) return;
    lock.current = true;
    const request = ++generation.current;
    setBusy(true);
    setSelected(id);
    selectedRef.current = id;
    setCases(null);
    setDetail(null);
    setFailed(false);
    setDecisionState(null);
    setReceipt(null);
    setMessage('選択した対象の通報を取得しています…');
    try {
      const before = decisions ? await client.decisionState(id) : null;
      const [freshQueue, result] = await Promise.all([client.queue(), client.readCase(id)]);
      const state = decisions ? await client.decisionState(id) : null;
      const stateKeys = ['contentId', 'round', 'version', 'status', 'reportCount'] as const;
      if (
        state &&
        (!before ||
          stateKeys.some((key) => state[key] !== before[key]) ||
          state.status !== result.status ||
          state.reportCount !== result.reportCount)
      )
        throw Error('Case changed');
      if (mounted.current && generation.current === request) {
        setCases(freshQueue);
        setDetail(result);
        setDecisionState(state);
        setMessage(
          decisions
            ? '本文と通報を表示しました。判断はまだ送信していません。'
            : '通報内容を表示しました。判断や通知メールの送信は行っていません。',
        );
      }
    } catch {
      if (mounted.current && generation.current === request) {
        setFailed(true);
        setCases(null);
        setDetail(null);
        setMessage(
          'この対象の通報内容を確認できませんでした。古い表示を残さず、未確認として扱います。',
        );
      }
    } finally {
      lock.current = false;
      if (mounted.current && generation.current === request) setBusy(false);
    }
  }
  async function resolved(value: ModerationDecisionReceipt) {
    const request = ++generation.current;
    lock.current = true;
    setBusy(true);
    setReceipt({ title: detail?.title ?? '選択した' + targetLabel, value });
    setDetail(null);
    setDecisionState(null);
    setSelected(null);
    setCases(null);
    riskChange(false);
    setMessage(
      value.action === 'hide'
        ? '作品を一時非公開にする判断記録を確認しました。本人のお知らせ欄で理由を確認できます。'
        : value.action === 'restore'
          ? notifications
            ? '復元の判断記録を確認しました。本人のお知らせ欄で理由を確認できます。'
            : '復元の判断記録を確認しました。通知の送信は未設定です。'
          : notifications
            ? '公開表示から削除する判断記録を確認しました。本人のお知らせ欄で理由を確認できます。'
            : '公開表示から削除する判断記録を確認しました。本文と通報記録は保持されています。通知の送信は未設定です。',
    );
    try {
      const next = await client.queue();
      if (mounted.current && generation.current === request) setCases(next);
    } catch {
      if (mounted.current && generation.current === request) {
        setFailed(true);
        setMessage(
          '判断の記録は確認しましたが、現在の一覧を再取得できませんでした。一覧を再確認してください。',
        );
      }
    } finally {
      lock.current = false;
      if (mounted.current && generation.current === request) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void queue();
    return () => {
      mounted.current = false;
      generation.current++;
      lock.current = false;
    };
  }, [client]);
  useEffect(() => {
    if (
      !initialCaseId ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(initialCaseId) ||
      openedInitialCase.current === initialCaseId ||
      cases === null ||
      busy ||
      decisionBusy
    )
      return;
    openedInitialCase.current = initialCaseId;
    void read(initialCaseId);
  }, [initialCaseId, cases, busy, decisionBusy]);
  return (
    <>
      <p className="moderation-message" aria-live="polite" aria-atomic="true">
        {message}
      </p>
      <Button disabled={busy || decisionBusy} onClick={() => void queue()}>
        一覧を再確認
      </Button>
      <div className="moderation-layout">
        <section className="moderation-queue" aria-label="通報対象の一覧">
          <h2>対象一覧</h2>
          {cases && (
            <ul>
              {cases.map((item) => (
                <li key={item.contentId}>
                  <Button
                    disabled={busy || decisionBusy}
                    aria-current={selected === item.contentId ? 'true' : undefined}
                    onClick={() => void read(item.contentId)}
                  >
                    <strong>{item.title || '無題の' + targetLabel}</strong>
                    <span>
                      {item.status === 'hidden'
                        ? '一時非公開'
                        : item.status === 'deleted'
                          ? '公開表示から削除済み'
                          : '公開中'}{' '}
                      · 通報 {item.reportCount}件
                    </span>
                    <small>最終受付 {stamp(item.latestReportAt)}</small>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {cases?.length === 0 && <p>対象はありません。</p>}
          <p className="moderation-limit">新しい確認待ちから20件まで表示します。</p>
        </section>
        <section className="moderation-case" aria-label="選択した通報内容">
          {receipt && (
            <section className="moderation-result" aria-label="判断結果">
              <h2>
                {receipt.value.action === 'hide'
                  ? '一時非公開の記録を確認しました'
                  : receipt.value.action === 'restore'
                    ? '復元の記録を確認しました'
                    : '削除の記録を確認しました'}
              </h2>
              <p>対象：{receipt.title}</p>
              <h3>判断の理由</h3>
              <p className="moderation-plain-text">{receipt.value.reason}</p>
              <p>
                {notifications
                  ? '本人のお知らせ欄に説明を記録しました。メールの受理・到達とは別の記録です。'
                  : '通知は未送信です。現在の状態は案件一覧を再取得して確認できます。'}
              </p>
            </section>
          )}
          {detail ? (
            <>
              <div className="moderation-case-heading">
                <h2>{detail.title || '無題の' + targetLabel}</h2>
                <span>
                  {detail.status === 'hidden'
                    ? '一時非公開'
                    : detail.status === 'deleted'
                      ? '公開表示から削除済み'
                      : '公開中'}
                </span>
              </div>
              <p>
                通報 {detail.reportCount}件 · 最終受付 {stamp(detail.latestReportAt)}
              </p>
              <div className="moderation-notification">
                {notifications
                  ? project
                    ? '作品は通報件数で自動非公開にしません。理由は本人のお知らせ欄に表示します。作品の通知メールは未設定です。'
                    : '判断の理由は本人のお知らせ欄に表示します。通報メールの状態は下の配送欄で確認できます。'
                  : decisions
                    ? '通知の送信は未設定です。ここで判断しても、メール送信済みとは扱いません。'
                    : '通知は確認待ちとして扱います。この画面からメール送信や運営判断は行いません。'}
              </div>
              <ol className="moderation-reports">
                {detail.reports.map((report, index) => (
                  <li key={index}>
                    <h3>通報 {index + 1}</h3>
                    <p className="moderation-report-time">{stamp(report.createdAt)} 受付</p>
                    <h4>理由</h4>
                    <p className="moderation-plain-text">{report.reason}</p>
                    <h4>詳しい説明</h4>
                    <p className="moderation-plain-text">
                      {report.detail || '詳細の入力はありません'}
                    </p>
                  </li>
                ))}
              </ol>
              {detail.reportsTruncated && (
                <p>新しい通報20件を表示しています。過去の通報記録も保持されています。</p>
              )}
              <details className="moderation-article">
                <summary>対象の{project ? '作品情報' : '記事本文'}を確認</summary>
                <CaseBodyBoundary key={detail.contentId}>
                  <MarkdownRenderer
                    body={detail.body}
                    privateMedia={
                      decisions ? { fetcher: mediaFetcher, scopeKey: detail.contentId } : undefined
                    }
                  />
                </CaseBodyBoundary>
              </details>
              {decisions && decisionState && (
                <ModerationDecision
                  key={detail.contentId + ':' + decisionState.round + ':' + decisionState.version}
                  client={client}
                  project={project}
                  notifications={notifications}
                  detail={detail}
                  state={decisionState}
                  onResolved={(value) => void resolved(value)}
                  onRiskChange={riskChange}
                  onBusyChange={busyChange}
                />
              )}
            </>
          ) : (
            <p>
              {receipt
                ? '一覧から次の対象を選べます。'
                : busy
                  ? '取得中です。前の対象の本文・通報は表示しません。'
                  : '一覧から対象を選んでください。'}
            </p>
          )}
          {failed && selected && !busy && (
            <Button onClick={() => void read(selected)}>この対象を再確認</Button>
          )}
        </section>
      </div>
    </>
  );
}
export default function ModerationLab() {
  return (
    <div className="moderation-lab">
      <header>
        <span>Kobe Student Hub</span>
        <strong>ローカル運営確認</strong>
      </header>
      <main>
        <h1>通報の確認待ち</h1>
        <p className="moderation-local-notice">
          架空のデータを使う読み取り専用のローカル画面です。サーバーで指定された運営用セッションだけが利用できます。ここからログインや権限付与は行いません。
        </p>
        <OperatorReadBoundary>
          {(fetcher) => <ModerationCases fetcher={fetcher} />}
        </OperatorReadBoundary>
        <section className="moderation-decision-gate" aria-label="未設定の運営機能">
          <h2>判断・連絡はまだ行えません</h2>
          <p>
            復元・削除・判断理由の登録・メール送信・本人への説明・異議申立ての窓口は未提供または未設定です。この画面には実行ボタンを置いていません。
          </p>
          <p>
            通知の確認待ちを「送信済み」や「対応済み」とは扱いません。実際の学生を受け入れる前に、運用と連絡先の検証が必要です。
          </p>
        </section>
      </main>
      <footer>
        ローカル専用 · 実際の学校ログイン・運営対応・本番接続・学生による価値検証は未実施です。
      </footer>
    </div>
  );
}
