import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@base-ui/react/button';
import { createProfileModerationClient } from '../editor/profile-report-client';
import type { ProfileReportCase, ProfileReportCaseSummary } from '../profile-report-types';

const stamp = (n: number) =>
  new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(n);

/** Operator read-only list of reported profiles. No decision is offered from this view yet. */
export default function ProfileReportCases({
  fetcher,
  initialCaseId,
}: {
  fetcher: typeof fetch;
  initialCaseId?: string | null;
}) {
  const client = useMemo(() => createProfileModerationClient(fetcher), [fetcher]);
  const generation = useRef(0),
    request = useRef<AbortController | null>(null);
  const [cases, setCases] = useState<ProfileReportCaseSummary[] | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<ProfileReportCase | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('確認待ちの一覧を取得しています…');
  async function load(id: string | null) {
    const run = ++generation.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setSelected(id);
    setDetail(null);
    setMessage(
      id ? '選択したプロフィールの通報を取得しています…' : '確認待ちの一覧を取得しています…',
    );
    try {
      const [list, one] = await Promise.all([
        client.queue(controller.signal),
        id ? client.readCase(id, controller.signal) : Promise.resolve(null),
      ]);
      if (run !== generation.current) return;
      setCases(list);
      setDetail(one);
      setMessage(
        one
          ? '通報内容を表示しました。この画面からはまだ判断を送信できません。'
          : list.length
            ? '対象を選ぶと、通報内容と通報時のプロフィールを確認できます。'
            : '確認待ちの通報はありません。',
      );
    } catch {
      if (run !== generation.current) return;
      setCases(null);
      setDetail(null);
      setMessage(
        '通報内容を確認できませんでした。運営用の権限・セッション・接続状態を確認してください。古い表示は残しません。',
      );
    } finally {
      if (run === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load(
      initialCaseId && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(initialCaseId)
        ? initialCaseId
        : null,
    );
    return () => {
      generation.current++;
      request.current?.abort();
    };
  }, [client]);
  return (
    <>
      <p className="moderation-message" aria-live="polite" aria-atomic="true">
        {message}
      </p>
      <Button disabled={busy} onClick={() => void load(selected)}>
        一覧を再確認
      </Button>
      <div className="moderation-layout">
        <section className="moderation-queue" aria-label="通報対象の一覧">
          <h2>対象一覧</h2>
          {cases && (
            <ul>
              {cases.map((item) => (
                <li key={item.profileId}>
                  <Button
                    disabled={busy}
                    aria-current={selected === item.profileId ? 'true' : undefined}
                    onClick={() => void load(item.profileId)}
                  >
                    <strong>{item.displayName}</strong>
                    <span>通報 {item.reportCount}件</span>
                    <small>最終受付 {stamp(item.latestReportAt)}</small>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {cases?.length === 0 && <p>対象はありません。</p>}
          <p className="moderation-limit">新しい受付から20件まで表示します。</p>
        </section>
        <section className="moderation-case" aria-label="選択した通報内容">
          {detail && (
            <>
              <div className="moderation-case-heading">
                <h2>{detail.profile.name}</h2>
                <Link to={'/students/' + detail.profile.id}>公開ページを開く</Link>
              </div>
              {(detail.profile.department || detail.profile.year) && (
                <p className="moderation-plain-text">
                  {[detail.profile.department, detail.profile.year].filter(Boolean).join(' · ')}
                </p>
              )}
              {detail.profile.bio && <p className="moderation-plain-text">{detail.profile.bio}</p>}
              <div className="moderation-notification">
                プロフィールは通報の件数で自動的に非公開になりません。通報時の表示名・紹介文も記録しています。
              </div>
              <ol className="moderation-reports">
                {detail.reports.map((report, index) => (
                  <li key={index}>
                    <h3>通報 {index + 1}</h3>
                    <p className="moderation-report-time">{stamp(report.receivedAt)} 受付</p>
                    <h4>理由</h4>
                    <p className="moderation-plain-text">{report.reason}</p>
                    <h4>詳しい説明</h4>
                    <p className="moderation-plain-text">
                      {report.detail || '詳細の入力はありません'}
                    </p>
                    <h4>通報時のプロフィール</h4>
                    <p className="moderation-plain-text">
                      {[report.reported.name, report.reported.department, report.reported.year]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {report.reported.bio && (
                      <p className="moderation-plain-text">{report.reported.bio}</p>
                    )}
                  </li>
                ))}
              </ol>
              {detail.reportsTruncated && (
                <p>新しい通報20件を表示しています。過去の通報記録も保持されています。</p>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
