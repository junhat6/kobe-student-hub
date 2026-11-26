-- media 照合の記録に「D1 に画像の本体（payload）が残る行の数」を足す（#305、#12 の確かめ方）。expand のみ。
-- Worker の定時処理が照合と同じ時刻に数え、release 列車はこの列を読む（リモート D1 に書かずに消去の進みを見る）。
-- 既存の行は NULL（未計測）のまま書き換えない。1つ前の Worker はこの列を書かないので NULL の行を足し続けても動く。
-- 数だけを持ち、id・key・所有者・本文は持たない。
ALTER TABLE media_object_audits ADD COLUMN retained INTEGER CHECK(retained IS NULL OR (typeof(retained)='integer' AND retained BETWEEN 0 AND total));
