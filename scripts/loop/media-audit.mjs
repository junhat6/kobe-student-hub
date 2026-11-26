// 本番の media 行と private R2 の照合の数を、release 列車が読む形にする（#249、#12 の contract の前提）。
//
// 本番 R2 は release の token では読めない（R2 の権限を持たない）。そこで Worker の定時処理が
// 読み取りだけで照合して数を D1 の media_object_audits に残し（worker/media-objects.ts）、
// deploy の後にその最新行をこの SQL で読む。ここでも書き込みはしない（SELECT だけ）。
// 記録に載せるのは数と測った時刻だけ。行にほかの列が増えても、決まった数の欄だけを拾う。
//
// retained は「D1 に画像の本体（payload）がまだ残る行」の数（#12 の contract 第4段の進み、#305）。
// cron が R2 と照合してから1行ずつ payload を消すので、0 になれば全行の本体が R2 だけにある。
// 照合と同じ定時処理・同じ時刻に Worker が数えて列に残す（migration 0054）。0054 より前の行や
// 1つ前の Worker が書いた行は NULL で、「未計測」として扱う（数が無いことを 0 と読まない）。

export const MEDIA_AUDIT_SQL =
  'SELECT measured_at_ms,total,pending,checked,missing,mismatched,complete,retained FROM media_object_audits ORDER BY measured_at_ms DESC LIMIT 1';

const COUNTS = ['total', 'pending', 'checked', 'missing', 'mismatched'];
const count = (v) => Number.isSafeInteger(v) && v >= 0;

/** `wrangler d1 execute --json` の結果から照合の数だけを取り出す。読めなければ error を返す。 */
export function parseMediaAudit(results) {
  const row = Array.isArray(results) ? results[0]?.results?.[0] : undefined;
  if (!row) return { error: 'まだ照合の記録がありません' };
  const consistent =
    count(row.measured_at_ms) &&
    row.measured_at_ms <= 253402300799999 &&
    COUNTS.every((k) => count(row[k])) &&
    row.pending <= row.total &&
    row.checked <= row.total &&
    row.missing + row.mismatched <= row.checked &&
    (row.retained === null || (count(row.retained) && row.retained <= row.total));
  if (!consistent) return { error: '照合の記録の形が読めません' };
  return {
    measuredAt: new Date(row.measured_at_ms).toISOString(),
    ...Object.fromEntries(COUNTS.map((k) => [k, row[k]])),
    complete: row.complete === 1,
    retained: row.retained,
  };
}

/** release-log の表の1欄。数だけを書く。retained が null なら未計測、キーの無い古い記録はその欄を出さない。 */
export function formatMediaAudit(a) {
  if (!a) return undefined;
  if (a.error) return `照合できず（${String(a.error).slice(0, 80)}）`;
  const ok = a.pending === 0 && a.missing === 0 && a.mismatched === 0 && a.complete;
  const at = new Date(a.measuredAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  return [
    `${ok ? '一致' : '不一致あり'}：行 ${a.total}・未写し ${a.pending}・R2 欠落 ${a.missing}・size/sha256 不一致 ${a.mismatched}`,
    count(a.retained)
      ? `・D1 に本体が残る行 ${a.retained}`
      : a.retained === null
        ? '・D1 に本体が残る行 未計測'
        : '',
    `（確かめた行 ${a.checked}${a.complete ? '' : '、一部のみ'}、${at} JST 測定）`,
  ].join('');
}
