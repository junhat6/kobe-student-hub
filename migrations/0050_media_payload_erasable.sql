-- 既存行の画像 BLOB（payload）を消せるようにする（#12 の contract の第3段。DECISIONS 2026-11-22 の5）。expand のみ。
-- 0045 は payload を NULL 可にしたが、media_assets_content_immutable が payload の UPDATE をすべて拒むので、
-- R2 に写した既存行も payload を持ったままになっている。この migration はその trigger を作り直し、次の1つの UPDATE だけを通す：
--   payload を NULL にする（別の値に変える・NULL から戻すことはできない）。行が R2 に写したと記録され（object_stored_at_ms あり）、
--   size の列が今の payload の長さと同じ。id・mime・width・height・sha256・created_at_ms・bytes・object_stored_at_ms は変えない。
-- それ以外の UPDATE（今までどおり拒んでいたもの）は同じ 'immutable media' で拒む。trigger の名前・列の並びは 0020／0045 と同じ。
-- R2 の object が本当にあるか・sha256 が合うかは DB からは確かめられない。消す前に R2 の head と sha256 で照合するのは Worker の
-- 役目（worker/media-objects.ts 冒頭の手順）で、消す Worker はこの migration が本番に当たった後の別の便で出す。
-- 1つ前の Worker（payload を UPDATE しない）はこの trigger でそのまま動き、rollback で困らない。
-- @statement
DROP TRIGGER media_assets_content_immutable;
-- @statement
CREATE TRIGGER media_assets_content_immutable BEFORE UPDATE OF id,mime,width,height,payload,sha256,created_at_ms ON media_assets WHEN NOT (OLD.payload IS NOT NULL AND NEW.payload IS NULL AND OLD.object_stored_at_ms IS NOT NULL AND OLD.bytes IS length(OLD.payload) AND NEW.id IS OLD.id AND NEW.mime IS OLD.mime AND NEW.width IS OLD.width AND NEW.height IS OLD.height AND NEW.sha256 IS OLD.sha256 AND NEW.created_at_ms IS OLD.created_at_ms AND NEW.bytes IS OLD.bytes AND NEW.object_stored_at_ms IS OLD.object_stored_at_ms) BEGIN SELECT RAISE(ABORT,'immutable media'); END;
