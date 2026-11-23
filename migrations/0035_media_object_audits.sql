-- media 行と private R2 の照合結果（#249、#12 の contract の前提）。expand のみ。
-- Worker の定時処理が読み取りだけで数え、数だけをここに残す。release 列車は本番 R2 を読めないので、
-- deploy の後にこの表の最新行を読んで release-log に載せる。id・key・所有者・本文は持たない。
-- 古い行は記録のたびに消し、直近の数件だけを残す。
CREATE TABLE media_object_audits (
 measured_at_ms INTEGER NOT NULL PRIMARY KEY CHECK(typeof(measured_at_ms)='integer' AND measured_at_ms BETWEEN 0 AND 253402300799999),
 total INTEGER NOT NULL CHECK(typeof(total)='integer' AND total>=0),
 pending INTEGER NOT NULL CHECK(typeof(pending)='integer' AND pending BETWEEN 0 AND total),
 checked INTEGER NOT NULL CHECK(typeof(checked)='integer' AND checked BETWEEN 0 AND total),
 missing INTEGER NOT NULL CHECK(typeof(missing)='integer' AND missing BETWEEN 0 AND checked),
 mismatched INTEGER NOT NULL CHECK(typeof(mismatched)='integer' AND mismatched BETWEEN 0 AND checked),
 complete INTEGER NOT NULL CHECK(complete IN (0,1))
);
