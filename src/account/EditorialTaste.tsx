import { useEffect, useState } from 'react';
import {
  EDITORIAL_POINTS,
  EDITORIAL_REVIEW_RELEASE_ENABLED,
  decodeEditorialTasteSummary,
  type EditorialTasteSummary,
} from '../shared/editorial-review';
import './editorial-taste.css';

const VERDICT_LABELS = [
  ['good', '良い'],
  ['ok', 'ふつう'],
  ['bad', '合わない'],
] as const;
const strip = (line: string) => line.replace(/^- /, '');

/**
 * The operator's 好み (C22 condition 5): the operator ledger (writing and app lines), counts of
 * the operator's own reviews over 30 days, and the AI-draft difference once it can be counted.
 * The server answers everyone else with 404, and then this renders nothing. No note text exists
 * in the response, so none can be shown.
 */
export default function EditorialTaste({ fetcher }: { fetcher: typeof fetch }) {
  const [summary, setSummary] = useState<EditorialTasteSummary | null>(null);
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
  const { ledger, reviews } = summary;
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
      <h3>AI 下書きとの差</h3>
      <p className="editorial-taste-empty">
        まだ数えられません。AI
        が書いた版を残す仕組み（本人の台帳）が入ると、変更した行数と公開までの日数が出ます。
      </p>
    </section>
  );
}
