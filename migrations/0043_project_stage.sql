-- 作品の「制作中／完成」（#275）。expand のみ。
-- 状態は公開スナップショットの1列で、公開時に本人が選び、公開後も本人だけが切り替えられる（worker の ProjectStore.setStage）。
-- 既存の行と、この列を知らない1つ前の Worker が書く行は 'complete'（完成）になり、表示は今と変わらない。
-- 0038 の不変 trigger は列を名指しで守っているので、この列の UPDATE は止めない。公開停止・削除された行は worker が触らない。
-- @statement
ALTER TABLE project_publications ADD COLUMN stage TEXT NOT NULL DEFAULT 'complete' CHECK(stage IN ('in_progress','complete'));
