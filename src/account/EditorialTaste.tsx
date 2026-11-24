import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  EDITORIAL_POINTS,
  EDITORIAL_REVIEW_RELEASE_ENABLED,
  decodeEditorialTasteSummary,
  type EditorialTasteSummary,
} from '../shared/editorial-review';
import { TASTE_SHARING_RELEASE_ENABLED } from '../shared/agent-release';
import { decodeSharedTasteView, type TasteLine } from '../shared/taste-ledger';
import './editorial-taste.css';

const VERDICT_LABELS = [
  ['good', '良い'],
  ['ok', 'ふつう'],
  ['bad', '合わない'],
] as const;
const strip = (line: string) => line.replace(/^- /, '');

/**
 * The operator's 好み (C22 condition 5): the operator ledger (writing and app lines), counts of
 * the operator's own reviews over 30 days, and how the operator changed their own AI's drafts.
 * The server answers everyone else with 404, and then this renders nothing. No note text exists
 * in the response, so none can be shown.
 */
export default function EditorialTaste({ fetcher }: { fetcher: typeof fetch }) {
  const [summary, setSummary] = useState<EditorialTasteSummary | null>(null);
  const [shared, setShared] = useState<TasteLine[] | null>(null);
  useEffect(() => {
    if (!TASTE_SHARING_RELEASE_ENABLED) return;
    const controller = new AbortController();
    fetcher('/api/private/editorial-taste/shared', {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (v) => {
          if (!controller.signal.aborted)
            setShared(v === null ? null : (decodeSharedTasteView(v)?.lines ?? null));
        },
        () => {},
      );
    return () => controller.abort();
  }, [fetcher]);
  useEffect(() => {
    if (!EDITORIAL_REVIEW_RELEASE_ENABLED) return;
    const controller = new AbortController();
    fetcher('/api/private/editorial-taste', {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (v) => {
          if (!controller.signal.aborted)
            setSummary(v === null ? null : decodeEditorialTasteSummary(v));
        },
        () => {},
      );
    return () => controller.abort();
  }, [fetcher]);
  if (!summary) return null;
  const { ledger, reviews, aiDiff } = summary;
  const counted = EDITORIAL_POINTS.filter((p) => reviews.points[p.code] > 0).sort(
    (a, b) => reviews.points[b.code] - reviews.points[a.code],
  );
  return (
    <section id="taste" aria-labelledby="taste-title" className="account-block editorial-taste">
      <h2 id="taste-title">好み</h2>
      <p className="editorial-taste-lead">運営だけに表示。ひとことの本文は出しません。</p>
      <h3>執筆の行</h3>
      {ledger.taste.length ? (
        <ul className="editorial-taste-lines">
          {ledger.taste.map((line) => (
            <li key={line}>{strip(line)}</li>
          ))}
        </ul>
      ) : (
        <p className="editorial-taste-empty">まだありません。</p>
      )}
      <h3>アプリの行</h3>
      {ledger.product.length ? (
        <ul className="editorial-taste-lines">
          {ledger.product.map((line) => (
            <li key={line}>{strip(line)}</li>
          ))}
        </ul>
      ) : (
        <p className="editorial-taste-empty">
          まだありません。同じ向きの気づきが3件そろうと、editor ループが1行足します。
        </p>
      )}
      <p className="editorial-taste-updated">台帳の更新 {ledger.updated}</p>
      <h3>
        あなたのレビュー（直近{reviews.days}日・{reviews.total}本）
      </h3>
      <dl className="editorial-taste-verdicts">
        {VERDICT_LABELS.map(([code, label]) => (
          <div key={code} className={'is-' + code}>
            <dt>{label}</dt>
            <dd>{reviews.verdicts[code]}</dd>
          </div>
        ))}
      </dl>
      <p className="editorial-taste-meta">
        公開記事のレビューの数です。下書きのレビューは直近{reviews.days}日に {reviews.drafts}{' '}
        本です。
      </p>
      <nav className="editorial-taste-entries" aria-label="レビューする場所">
        <Link to="/drafts">
          下書きのプレビュー
          <small>下書きを開いて「プレビュー」を押すと、本文の下で記録できます</small>
        </Link>
        <Link to="/">
          公開記事のページ
          <small>記事を開くと、本文の下で記録できます</small>
        </Link>
      </nav>
      {counted.length ? (
        <ul className="editorial-taste-points" aria-label="評価項目ごとの件数">
          {counted.map((p) => (
            <li key={p.code} className={'is-' + p.tone}>
              {p.label}
              <span>{reviews.points[p.code]}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="editorial-taste-empty">評価項目の記録はまだありません。</p>
      )}
      {shared && (
        <>
          <h3>学生が見せた行</h3>
          {shared.length ? (
            <ul className="editorial-taste-lines" aria-label="学生が見せた好みの行">
              {shared.map((line, i) => (
                <li key={i + line.kind + line.text}>
                  {line.text}
                  <small className="editorial-taste-meta">
                    {line.kind === 'writing' ? '執筆' : 'アプリ'} · {line.date}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="editorial-taste-empty">まだありません。</p>
          )}
        </>
      )}
      <h3>AI 下書きとの差</h3>
      {aiDiff.drafts === 0 ? (
        <p className="editorial-taste-empty">
          直近{aiDiff.days}日に AI が書いた下書きはありません。
        </p>
      ) : (
        <>
          <dl className="editorial-taste-verdicts editorial-taste-ai-diff">
            <div>
              <dt>直した下書き</dt>
              <dd>
                {aiDiff.edited}
                <small>/{aiDiff.compared}</small>
              </dd>
            </div>
            <div>
              <dt>足した行</dt>
              <dd>{aiDiff.added}</dd>
            </div>
            <div>
              <dt>消した行</dt>
              <dd>{aiDiff.removed}</dd>
            </div>
            <div>
              <dt>公開までの日数</dt>
              <dd>{aiDiff.medianDaysToPublish === null ? '—' : aiDiff.medianDaysToPublish}</dd>
            </div>
          </dl>
          <p className="editorial-taste-meta">
            直近{aiDiff.days}日に AI が書いた下書き {aiDiff.drafts} 本
            {aiDiff.compared < aiDiff.drafts ? `のうち新しい ${aiDiff.compared} 本` : ''}
            を、公開した {aiDiff.published}{' '}
            本は公開版と、ほかは今の下書きと比べた数です。公開までの日数は中央値。
            {aiDiff.approximate ? '長い本文があるため、行数はおおよそです。' : ''}
          </p>
        </>
      )}
    </section>
  );
}
