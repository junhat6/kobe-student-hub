-- 公開プロフィールの外部リンク（#313、台帳 C27 条件2・3）。expand のみ：新しい表と、通報の記録への nullable の列。
-- 1プロフィールにつき X・GitHub・LinkedIn・Web サイトを各1つまで。本人が入れたものだけで、Google アカウントやメールからは入れない。
-- 値は Worker（ProfileLinkStore）が src/shared/profile-links.ts で正規化した URL。表の CHECK は、Worker を通らない書き込みでも
-- サービスごとの決まった接頭辞・200 字以内・https・空白や制御文字なし、に収める（形の細部は Worker と公開の読み取りが毎回確かめる）。
-- 公開の読み取りは /api/students と作者カードの判定（公開中の記事か作品がある）と同じ条件で絞る。
-- 1つ前の Worker はこの表と列を知らず、そのまま動く（通報の INSERT は列を書かず NULL＝「リンクは記録していない」になる）。
-- @statement
CREATE TABLE IF NOT EXISTS public_profile_links (
 public_profile_id TEXT NOT NULL REFERENCES public_profiles(id),
 service TEXT NOT NULL CHECK(service IN ('x','github','linkedin','website')),
 url TEXT NOT NULL CHECK(
  length(url) BETWEEN 10 AND 200 AND length(CAST(url AS BLOB))=length(url)
  AND url NOT GLOB '*[^!-~]*'
  AND ((service='x' AND substr(url,1,14)='https://x.com/')
   OR (service='github' AND substr(url,1,19)='https://github.com/')
   OR (service='linkedin' AND substr(url,1,28)='https://www.linkedin.com/in/')
   OR (service='website' AND substr(url,1,8)='https://'))
 ),
 updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer' AND updated_at_ms BETWEEN 0 AND 253402300799999),
 PRIMARY KEY(public_profile_id,service)
);
-- @statement
-- 書けるのは、active な本人のアカウントに結びついたサンプルでないプロフィールだけ（Worker の所有者・在籍の確認に重ねる）。
CREATE TRIGGER IF NOT EXISTS public_profile_links_insert BEFORE INSERT ON public_profile_links BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM public_profiles p JOIN account_public_profiles m ON m.public_profile_id=p.id JOIN private_accounts a ON a.id=m.owner_account_id AND a.status='active' WHERE p.id=NEW.public_profile_id AND p.is_sample=0)
 THEN RAISE(ABORT,'profile links unavailable') END;
END;
-- @statement
CREATE TRIGGER IF NOT EXISTS public_profile_links_update BEFORE UPDATE ON public_profile_links BEGIN
 SELECT CASE WHEN NEW.public_profile_id!=OLD.public_profile_id OR NEW.service!=OLD.service
  OR NOT EXISTS(SELECT 1 FROM public_profiles p JOIN account_public_profiles m ON m.public_profile_id=p.id JOIN private_accounts a ON a.id=m.owner_account_id AND a.status='active' WHERE p.id=NEW.public_profile_id AND p.is_sample=0)
 THEN RAISE(ABORT,'profile links unavailable') END;
END;
-- @statement
-- 通報の記録（スナップショット）に、通報した時点のリンクを JSON の配列で残す。NULL は「記録していない」（この migration 前の行と1つ前の Worker）。
ALTER TABLE profile_reports ADD COLUMN links_json TEXT CHECK(links_json IS NULL OR (json_valid(links_json) AND json_type(links_json)='array' AND length(CAST(links_json AS BLOB))<=2048));
-- @statement
-- 記録したリンクは、そのときの公開リンクと一致するものだけ（後から書き換えて証拠を消せないよう、列の UPDATE も拒む）。
CREATE TRIGGER IF NOT EXISTS profile_reports_links_snapshot BEFORE INSERT ON profile_reports
WHEN NEW.links_json IS NOT NULL
BEGIN
 SELECT CASE WHEN NEW.links_json IS NOT (SELECT COALESCE(json_group_array(json_object('service',service,'url',url)),'[]') FROM (SELECT service,url FROM public_profile_links WHERE public_profile_id=NEW.public_profile_id ORDER BY CASE service WHEN 'x' THEN 1 WHEN 'github' THEN 2 WHEN 'linkedin' THEN 3 ELSE 4 END))
 THEN RAISE(ABORT,'profile report unavailable') END;
END;
-- @statement
CREATE TRIGGER IF NOT EXISTS profile_reports_links_immutable BEFORE UPDATE OF links_json ON profile_reports BEGIN
 SELECT RAISE(ABORT,'profile report immutable');
END;
