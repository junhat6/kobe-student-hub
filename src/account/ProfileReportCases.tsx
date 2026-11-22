import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@base-ui/react/button';
import { createProfileModerationClient } from '../editor/profile-report-client';
import { createModerationClient } from '../editor/moderation-client';
import type { ProfileReportCase, ProfileReportCaseSummary } from '../profile-report-types';

const stamp = (n: number) =>
  new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(n);

/** Operator list of reported profiles. The only decision is taking down the icon image. */
export default function ProfileReportCases({
  fetcher,
  initialCaseId,
}: {
  fetcher: typeof fetch;
  initialCaseId?: string | null;
}) {
  const client = useMemo(() => createProfileModerationClient(fetcher), [fetcher]);
  const session = useMemo(() => createModerationClient(fetcher), [fetcher]);
  const generation = useRef(0),
    request = useRef<AbortController | null>(null);
  const [cases, setCases] = useState<ProfileReportCaseSummary[] | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<ProfileReportCase | null>(null),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(''),
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
          ? '通報内容を表示しました。'
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
  async function removeAvatar(id: string, avatar: string) {
    const version = avatar.slice(-16);
    setBusy(true);
    setMessage('アイコン画像を外しています…');
    try {
      const csrf = await session.session();
      await client.removeAvatar(id, { avatar: version, reason }, csrf);
      setReason('');
      await load(id);
      setMessage('アイコン画像を外しました。本人のお知らせに理由が届きます。');
    } catch {
      // Unknown outcome: re-read instead of resending, so a second removal is never sent blindly.
      await load(id);
      setMessage(
        '外せたか確認できませんでした。表示を読み直しました。画像が残っていれば、もう一度判断してください。',
      );
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
              {detail.avatar ? (
                <form
                  className="moderation-avatar"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (reason.trim()) void removeAvatar(detail.profile.id, detail.avatar!);
                  }}
                >
                  <img src={detail.avatar} alt="いまのアイコン画像" width={96} height={96} />
                  <label>
                    外す理由（本人に届きます）
                    <textarea
                      value={reason}
                      maxLength={1000}
                      required
                      disabled={busy}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </label>
                  <Button type="submit" disabled={busy || !reason.trim()}>
                    アイコン画像を外す
                  </Button>
                </form>
              ) : (
                <p className="moderation-plain-text">アイコン画像は設定されていません。</p>
              )}
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
