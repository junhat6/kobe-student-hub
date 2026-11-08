import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@base-ui/react/button';
import type { OwnPublicationSummary } from '../own-publication-types';
import type { PublicationStopState } from '../publication-stop-types';
import { createPublicationStopClient } from './publication-stop-client';
import './publication-stop.css';
import { publicPaths, type PublicSurface } from '../shared/public-paths';
export default function PublicationStop({
  record,
  csrfToken,
  fetcher,
  parentBusy,
  onPending,
  onUncertain,
  onStopped,
  surface = 'lab',
}: {
  record: OwnPublicationSummary;
  csrfToken: string;
  fetcher: typeof fetch;
  parentBusy: boolean;
  onPending: (value: boolean) => void;
  onUncertain: (value: boolean) => void;
  onStopped: () => void;
  surface?: PublicSurface;
}) {
  const client = useMemo(() => createPublicationStopClient(fetcher), [fetcher]),
    mounted = useRef(true),
    generation = useRef(0),
    lock = useRef(false),
    request = useRef<AbortController | null>(null);
  const [value, setValue] = useState<PublicationStopState | null>(null),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    if (busy || uncertain) window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy, uncertain]);
  const matches =
    value?.kind === record.kind &&
    value.publicId === record.publicId &&
    value.sourceVersion === record.sourceVersion;
  async function run(action: (signal: AbortSignal, run: number) => Promise<boolean>) {
    if (lock.current || parentBusy) return;
    lock.current = true;
    setBusy(true);
    onPending(true);
    const run = generation.current,
      controller = new AbortController();
    request.current = controller;
    let refresh = false;
    try {
      refresh = await action(controller.signal, run);
    } finally {
      if (mounted.current && run === generation.current) {
        lock.current = false;
        setBusy(false);
        onPending(false);
        if (refresh) onStopped();
      }
    }
  }
  async function inspect() {
    setConfirmed(false);
    await run(async (signal, run) => {
      setMessage('選択した公開記録と本人の停止記録を確認しています…');
      setValue(null);
      try {
        const result = await client.read(record.kind, record.publicId, signal);
        if (!mounted.current || run !== generation.current) return false;
        setValue(result);
        if (result.sourceVersion !== record.sourceVersion) {
          setMessage('選択した公開時の保存版と一致しません。停止せず、一覧を確認してください。');
          return false;
        }
        setUncertain(false);
        onUncertain(false);
        if (record.status !== 'published' && result.status === 'published') {
          setMessage(
            '取得した状態が選択時と変わりました。記録確認からは停止できません。一覧を更新し、公開中の行から選び直してください。',
          );
          return true;
        }
        if (result.stopped) {
          setMessage(
            'このアカウントによる、選択した保存版の公開停止記録を確認しました。本文や下書きを消去した記録ではありません。',
          );
          return true;
        }
        setMessage(
          result.status === 'published'
            ? '現在公開中の保存版を確認しました。下の説明と対象を確認してから、停止操作を選んでください。'
            : 'この記録は現在公開中ではありません。本人の停止記録は確認できず、非公開・削除の理由は判断できません。',
        );
        return result.status !== 'published';
      } catch {
        if (mounted.current && run === generation.current)
          setMessage(
            '停止状態を確認できませんでした。未停止や成功とは判断せず、変更も自動再送しません。',
          );
        return false;
      }
    });
  }
  async function stop() {
    if (
      record.status !== 'published' ||
      !matches ||
      value?.status !== 'published' ||
      value.stopped ||
      uncertain ||
      !confirmed
    )
      return;
    setConfirmed(false);
    await run(async (signal, run) => {
      setMessage('確認した公開保存版の停止結果を確認しています…');
      try {
        const result = await client.stop(
          record.kind,
          record.publicId,
          record.sourceVersion,
          csrfToken,
          true,
          signal,
        );
        if (!mounted.current || run !== generation.current) return false;
        setValue(result);
        setUncertain(false);
        onUncertain(false);
        setMessage(
          'このアカウントによる、選択した保存版の公開停止記録を確認しました。本文や下書きを消去した記録ではありません。',
        );
        return true;
      } catch {
        if (mounted.current && run === generation.current) {
          setUncertain(true);
          onUncertain(true);
          setMessage(
            '公開停止の結果は未確定です。自動で再送せず、「選択した公開の停止記録を確認」で確認してください。',
          );
        }
        return false;
      }
    });
  }
  useEffect(() => {
    mounted.current = true;
    void inspect();
    return () => {
      mounted.current = false;
      generation.current++;
      request.current?.abort();
      lock.current = false;
      onPending(false);
    };
  }, [client, record]);
  return (
    <section className="publication-stop" aria-label="選択した公開の停止">
      <h3>選択した公開保存版の停止記録</h3>
      <p className="publication-stop-local">
        {surface === 'lab' ? '架空データによるローカル限定の操作です。' : ''}
        本人の公開停止と通報・運営判断は別です。
      </p>
      <dl>
        <div>
          <dt>公開参照</dt>
          <dd>
            {record.kind === 'article'
              ? publicPaths(surface).article(record.publicId)
              : (surface === 'ordinary' ? '/projects/' : '/lab/projects/') + record.publicId}
          </dd>
        </div>
        <div>
          <dt>対象</dt>
          <dd>
            {record.kind === 'article' ? '記事' : '作品'}：{record.title}
          </dd>
        </div>
        <div>
          <dt>初回公開時刻</dt>
          <dd>{new Date(record.publishedAt).toLocaleString('ja-JP')}</dd>
        </div>
        <div>
          <dt>公開時の保存版</dt>
          <dd>{record.sourceVersion}</dd>
        </div>
      </dl>
      <p role="status" aria-live="polite">
        {message}
      </p>
      <Button disabled={busy || parentBusy} onClick={() => void inspect()}>
        選択した公開の停止記録を確認
      </Button>
      {uncertain && (
        <p role="alert">
          結果は未確定です。対象の切替と再送はできません。記録を手動で確認してください。
        </p>
      )}
      <p>
        停止は、現在公開中のこの保存版を新たな読者表示から外す操作です。本文・下書きの消去や、既に読者が受信した内容の回収ではありません。この試作では再公開・復元を提供していません。手元の未保存の編集内容を停止対象へコピーしません。
      </p>
      <label className="publication-stop-confirm">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={
            busy ||
            parentBusy ||
            uncertain ||
            record.status !== 'published' ||
            !matches ||
            value?.status !== 'published' ||
            value.stopped
          }
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <span>
          現在公開中のこの保存版を停止します。本文・下書きの消去ではなく、再公開は提供されていないことを確認しました
        </span>
      </label>
      <Button
        disabled={
          busy ||
          parentBusy ||
          uncertain ||
          record.status !== 'published' ||
          !matches ||
          value?.status !== 'published' ||
          value.stopped ||
          !confirmed
        }
        onClick={() => void stop()}
      >
        確認した公開保存版を停止
      </Button>
    </section>
  );
}
