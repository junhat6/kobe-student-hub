import PublicationStop from './PublicationStop';
import { publicPaths, type PublicSurface } from '../shared/public-paths';
import type { OwnPublicationSummary } from '../own-publication-types';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@base-ui/react/button';
import type { OwnPublications as PublicationList } from '../own-publication-types';
import { createOwnPublicationsClient } from './own-publications-client';
import './own-publications.css';
const stamp = (value: number) =>
  new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
export default function OwnPublications({
  fetcher = fetch,
  csrfToken,
  surface = 'lab',
  onNavigationRiskChange,
}: {
  fetcher?: typeof fetch;
  csrfToken: string;
  surface?: PublicSurface;
  onNavigationRiskChange?: (risk: boolean) => void;
}) {
  const client = useMemo(() => createOwnPublicationsClient(fetcher), [fetcher]),
    mounted = useRef(true),
    generation = useRef(0),
    lock = useRef(false),
    request = useRef<AbortController | null>(null);
  const [value, setValue] = useState<PublicationList | null>(null),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [message, setMessage] = useState(''),
    [selected, setSelected] = useState<OwnPublicationSummary | null>(null),
    [stopBusy, setStopBusy] = useState(false),
    [stopUncertain, setStopUncertain] = useState(false);
  const stopLock = useRef(false),
    refreshRef = useRef<() => Promise<void>>(async () => {});
  const pending = useCallback((value: boolean) => {
    stopLock.current = value;
    setStopBusy(value);
  }, []);
  const uncertain = useCallback((value: boolean) => setStopUncertain(value), []);
  const stopped = useCallback(() => {
    void refreshRef.current();
  }, []);
  async function refresh() {
    if (lock.current || stopLock.current) return;
    lock.current = true;
    const run = ++generation.current,
      controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setFailed(false);
    setValue(null);
    setMessage('自分の公開記録を確認しています…');
    try {
      const result = await client.read(controller.signal);
      if (mounted.current && run === generation.current) {
        setValue(result);
        setMessage(
          result.publications.length
            ? 'このアカウントの公開記録を読み込みました。'
            : 'このアカウントの公開記録はありません。',
        );
      }
    } catch {
      if (mounted.current && run === generation.current) {
        setFailed(true);
        setMessage(
          '公開記録を確認できませんでした。記録がないとは判断できません。古い一覧は表示していません。',
        );
      }
    } finally {
      if (mounted.current && run === generation.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  refreshRef.current = refresh;
  useLayoutEffect(
    () => onNavigationRiskChange?.(stopBusy || stopUncertain),
    [stopBusy, stopUncertain, onNavigationRiskChange],
  );
  useEffect(() => () => onNavigationRiskChange?.(false), [onNavigationRiskChange]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      generation.current++;
      request.current?.abort();
      lock.current = false;
    };
  }, [client]);
  const ordinary = surface === 'ordinary';
  return (
    <section className="own-publications" aria-label="自分の公開記録">
      <div className="own-publications-head">
        <h2>{ordinary ? '公開した記事・作品' : '自分の公開記録'}</h2>
        {/* Accessible names start with the visible words (WCAG 2.5.3 Label in Name). */}
        <Button
          className="text-button"
          disabled={busy || stopBusy}
          onClick={() => void refresh()}
          aria-label={ordinary ? '再読み込み：公開した記事・作品' : undefined}
        >
          {ordinary ? '再読み込み' : '自分の公開記録を更新'}
        </Button>
      </div>
      {!ordinary && (
        <p className="own-publications-local">
          架空データによるローカル限定の確認です。記事・画像なし作品の公開記録を合わせて、新しい初回公開時刻から最大20件表示します。
        </p>
      )}
      <p role="status" aria-live="polite" className={ordinary ? 'sr-only' : undefined}>
        {message}
      </p>
      {failed && (
        <p role="alert">
          読み込めませんでした。接続を確認して、もう一度「再読み込み」を押してください。
        </p>
      )}
      {value && ordinary && value.publications.length === 0 && (
        <div className="own-publications-empty">
          <p>まだ公開した記事・作品はありません。</p>
          <a className="primary" href="/drafts">
            最初の記事を書く
          </a>
        </div>
      )}
      {value && (
        <>
          {value.moreExists && (
            <p className="own-publications-partial">
              最新20件のみを表示しています。他にも公開記録があります。
            </p>
          )}
          {value.publications.length > 0 && (
            <ul>
              {value.publications.map((row) => {
                const href =
                  row.kind === 'article'
                    ? publicPaths(surface).article(row.publicId)
                    : (ordinary ? '/projects/' : '/lab/projects/') + row.publicId;
                return (
                  <li key={row.kind + ':' + row.publicId}>
                    <div className="own-publications-row">
                      <span className="own-publications-kind">
                        {row.kind === 'article' ? '記事' : '作品'}
                      </span>
                      <strong>
                        {ordinary && row.status === 'published' ? (
                          <a href={href}>{row.title}</a>
                        ) : (
                          row.title
                        )}
                      </strong>
                      <span
                        className={'own-publications-state own-publications-state-' + row.status}
                      >
                        {ordinary
                          ? row.status === 'hidden'
                            ? '一時非公開'
                            : row.status === 'deleted'
                              ? '公開停止済み'
                              : '公開中'
                          : row.status === 'hidden'
                            ? '一時非公開（記録上）'
                            : row.status === 'deleted'
                              ? '削除状態（記録上）'
                              : '公開中（記録上）'}
                      </span>
                    </div>
                    {ordinary ? (
                      <p className="own-publications-meta">
                        <time dateTime={new Date(row.publishedAt).toISOString()}>
                          {stamp(row.publishedAt)}
                        </time>{' '}
                        に公開
                      </p>
                    ) : (
                      <dl>
                        <div>
                          <dt>初回公開時刻</dt>
                          <dd>
                            <time dateTime={new Date(row.publishedAt).toISOString()}>
                              {stamp(row.publishedAt)}
                            </time>
                          </dd>
                        </div>
                        <div>
                          <dt>公開時の保存版</dt>
                          <dd>{row.sourceVersion}</dd>
                        </div>
                      </dl>
                    )}
                    <div className="own-publications-actions">
                      {row.status === 'published' && !ordinary && (
                        <a href={href} target="_blank" rel="noopener noreferrer">
                          読者表示を確認 ↗
                        </a>
                      )}
                      <Button
                        className={ordinary ? 'text-button' : undefined}
                        disabled={busy || stopBusy || stopUncertain}
                        aria-label={
                          (row.status === 'published' ? '公開停止を確認：' : '停止記録を確認：') +
                          row.title
                        }
                        onClick={() => {
                          setStopUncertain(false);
                          setSelected({ ...row });
                        }}
                      >
                        {row.status === 'published' ? '公開停止を確認' : '停止記録を確認'}
                        {!ordinary && '：' + row.title}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {selected && (
        <PublicationStop
          key={selected.kind + ':' + selected.publicId}
          record={selected}
          surface={surface}
          csrfToken={csrfToken}
          fetcher={fetcher}
          parentBusy={busy}
          onPending={pending}
          onUncertain={uncertain}
          onStopped={stopped}
        />
      )}
      {ordinary ? (
        <p className="own-publications-scope">
          内容を直すときは<a href="/drafts">下書き</a>で編集して、もう一度公開してください。
        </p>
      ) : (
        <p className="own-publications-scope">
          表示は保存された記録の状態です。理由・運営判断・通知・実際の配信結果を示しません。読者表示は別タブで確認でき、手元の編集はこのページに残ります。公開停止は選択した保存版の本人操作として確認します。編集・再公開・復元・削除・異議申立ての操作は提供していません。
        </p>
      )}
    </section>
  );
}
